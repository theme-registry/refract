/**
 * dec.4 — cross-property derivation resolve pass.
 *
 * A variant / mode value may derive from ANOTHER property (`surface.modes.dark =
 * { ref: "colors.brand", modifiers: [{ adjust: { l: 12 } }] }`). Colours bakes derivations one
 * property at a time, so a cross-property source isn't available at bake time — the owning subsystem
 * emits such a derivation **unbaked** (a `Ref` carrying `ref` + `modifiers`/`fn` but no cached
 * `value`). This post-build pass runs once the full `path -> Ref` token map exists and fills each
 * cross-property derived `Ref`'s `.value` by resolving its source and folding its chain.
 *
 * - **Variants** are addressable tokens, so their source resolves through `resolveToken` (which itself
 *   follows the ref + folds modifiers across the whole map — chains of cross-property derivations
 *   resolve for free, no ordering needed).
 * - **Modes are NOT tokens** (they're emit-only), so a mode's source is resolved via `resolveToken`
 *   on its `ref` and the chain folded here by hand, rather than through a mode token that doesn't exist.
 *
 * The pass is **structural, not value-based**: it re-bakes any derived Ref whose source property
 * differs from the owner, regardless of whether a value is already present. That makes it correct on
 * `override()` too — re-running it against the merged token map re-derives a child's cross-property
 * values when the source changed, exactly like intra-property derivations. It rebuilds immutably
 * (new `Ref`s only where it re-bakes; every untouched branch keeps its reference), so a shared parent
 * Model is never mutated, and a Model with no cross-property derivation is returned by reference
 * (goldens byte-identical).
 */
import type { Literal, Ref, ThemeModel, PropertyModel, VariantModel } from "../model";
import { buildTokenMap } from "../model";
import { RefractError } from "../errors";
import { resolveToken, type DerivationRegistry } from "./resolveTokens";

/** The `<subsystem>.<property>` prefix of a token path (the first two dotted segments). */
const propertyPrefix = (path: string): string => {
  const [seg0, seg1] = path.split(".");
  return `${seg0}.${seg1}`;
};

/** A derived Ref (carries `ref` + a chain) whose source lives in a DIFFERENT property than `owner`. */
const isCrossPropertyDerived = (ref: Ref | undefined, owner: string): boolean => {
  if (!ref?.ref) return false;
  if (ref.modifiers === undefined && ref.fn === undefined) return false; // a plain alias, not a derivation
  return propertyPrefix(ref.ref) !== owner;
};

/**
 * Re-bake one cross-property derived Ref: resolve its source value against the token map, fold its
 * modifier chain (or legacy `fn`/`arg`), and return a fresh Ref carrying the baked `.value`. The
 * derivation metadata (`ref` + chain) is preserved so `override()` re-derives it again.
 */
const rebake = (
  ref: Ref,
  tokens: Record<string, Ref>,
  registry: DerivationRegistry,
  cache: Map<string, Literal>,
  where: string,
): Ref => {
  let value: Literal;
  try {
    value = resolveToken(tokens, registry, ref.ref as string, cache);
  } catch {
    throw new RefractError(
      "REFRACT_E_VALIDATION",
      `${where}: cross-property derivation references unknown token '${ref.ref}'.`,
    );
  }
  const apply = (fn: string, arg: unknown): Literal => {
    const derive = registry[fn];
    if (!derive) {
      throw new RefractError("REFRACT_E_VALIDATION", `${where}: unknown derivation fn '${fn}'.`);
    }
    return derive(value, arg);
  };
  if (ref.modifiers !== undefined) {
    for (const mod of ref.modifiers) value = apply(mod.fn, mod.arg);
  } else if (ref.fn !== undefined) {
    value = apply(ref.fn, ref.arg);
  }
  return { ...ref, value };
};

/** Re-bake any cross-property derived Ref in a `field -> Ref` map (mode fields / variant extras). */
const rebakeFields = (
  fields: Record<string, Ref>,
  owner: string,
  tokens: Record<string, Ref>,
  registry: DerivationRegistry,
  cache: Map<string, Literal>,
  where: string,
): Record<string, Ref> | undefined => {
  let next: Record<string, Ref> | undefined;
  for (const [name, ref] of Object.entries(fields)) {
    if (!isCrossPropertyDerived(ref, owner)) continue;
    next = next ?? { ...fields };
    next[name] = rebake(ref, tokens, registry, cache, `${where}.${name}`);
  }
  return next;
};

/** Re-bake a property's cross-property variants (base + extras). Returns undefined when none changed. */
const rebakeVariants = (
  variants: Record<string, VariantModel>,
  owner: string,
  tokens: Record<string, Ref>,
  registry: DerivationRegistry,
  cache: Map<string, Literal>,
): Record<string, VariantModel> | undefined => {
  let next: Record<string, VariantModel> | undefined;
  for (const [name, variant] of Object.entries(variants)) {
    const at = `${owner}.variants.${name}`;
    const base = isCrossPropertyDerived(variant.base, owner)
      ? rebake(variant.base, tokens, registry, cache, at)
      : variant.base;
    const extras = variant.extras
      ? rebakeFields(variant.extras, owner, tokens, registry, cache, `${at} extra`)
      : undefined;
    if (base === variant.base && !extras) continue;
    next = next ?? { ...variants };
    next[name] = extras ? { base, extras } : { ...variant, base };
  }
  return next;
};

/** Re-bake a single property's cross-property variants + modes. Returns undefined when none changed. */
const rebakeProperty = (
  pm: PropertyModel,
  owner: string,
  tokens: Record<string, Ref>,
  registry: DerivationRegistry,
  cache: Map<string, Literal>,
): PropertyModel | undefined => {
  const variants = pm.variants
    ? rebakeVariants(pm.variants, owner, tokens, registry, cache)
    : undefined;

  let modes: PropertyModel["modes"] | undefined;
  if (pm.modes) {
    for (let i = 0; i < pm.modes.length; i++) {
      const entry = pm.modes[i];
      if (!entry.overrides) continue;
      const nextFields = rebakeFields(entry.overrides, owner, tokens, registry, cache, `${owner}.modes.${entry.mode}`);
      if (!nextFields) continue;
      modes = modes ?? [...pm.modes];
      modes[i] = { ...entry, overrides: nextFields };
    }
  }

  if (!variants && !modes) return undefined;
  const next: PropertyModel = { ...pm };
  if (variants) next.variants = variants;
  if (modes) next.modes = modes;
  return next;
};

/**
 * Fill every cross-property derived variant / mode Ref's `.value` against the Model's token map.
 * Immutable — returns the Model by reference when nothing is cross-property (byte-identical output).
 */
export const bakeCrossPropertyDerivations = (
  model: ThemeModel,
  registry: DerivationRegistry,
): ThemeModel => {
  const tokens = buildTokenMap(model);
  const cache = new Map<string, Literal>();
  let modelChanged = false;
  const nextSubsystems: ThemeModel["subsystems"] = {};

  for (const [subKey, sub] of Object.entries(model.subsystems)) {
    let subChanged = false;
    let nextProps: Record<string, PropertyModel> | undefined;
    for (const [propName, pm] of Object.entries(sub.properties ?? {})) {
      const owner = `${subKey}.${propName}`;
      const nextPm = rebakeProperty(pm, owner, tokens, registry, cache);
      if (!nextPm) continue;
      nextProps = nextProps ?? { ...sub.properties };
      nextProps[propName] = nextPm;
      subChanged = true;
    }
    if (subChanged) {
      nextSubsystems[subKey] = { ...sub, properties: nextProps };
      modelChanged = true;
    } else {
      nextSubsystems[subKey] = sub;
    }
  }

  return modelChanged ? { ...model, subsystems: nextSubsystems } : model;
};
