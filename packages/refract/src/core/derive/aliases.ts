/**
 * Raw-theme aliases — post-build pass.
 *
 * A plain `{ ref }` in a raw theme (no `modifiers`) means "this value IS that token". Normalize turns
 * it into a model `Ref` that carries only `ref` (a property base, a variant base, a mode field or a
 * responsive override field). This pass runs once the full token map exists and fills each alias's
 * resolved `value` — plus the target's `unit` (lengths) or `struct` (shadows / transitions) — so
 * adapters that need literals (SCSS, styled-components, JSON, `theme.tokens`) have them. The `ref`
 * stays the alias's DIRECT target, so the CSS adapter can write a live `var(--target)`.
 *
 * Checks, collected rather than thrown so an invalid theme reports every problem at once:
 * - the target exists;
 * - the target holds the same kind of value (colour → colour, length → length, …), where both kinds
 *   are known.
 * A cycle of aliases throws `REFRACT_E_CYCLE`.
 *
 * Immutable: a Model with no alias is returned by reference (goldens byte-identical).
 */
import type { Literal, Ref, ThemeModel, PropertyModel, VariantModel } from "../model";
import type { PropertyOverride } from "../model/model";
import { buildTokenMap } from "../model";
import { RefractError } from "../errors";
import { resolveToken, type DerivationRegistry } from "./resolveTokens";

/** A model `Ref` that is a plain alias: a `ref` with no derivation chain and no external passthrough. */
export const isAliasRef = (ref: Ref | undefined): ref is Ref & { ref: string } =>
  !!ref &&
  ref.ref !== undefined &&
  ref.fn === undefined &&
  (ref.modifiers === undefined || ref.modifiers.length === 0) &&
  ref.external === undefined;

/** The kind of value a token property holds, by `<subsystem>.<property>`; `undefined` = not checked. */
const PROPERTY_KINDS: Record<string, string> = {
  "typography.fontSize": "length",
  "typography.letterSpacing": "length",
  "typography.fontWeight": "number",
  "typography.fontFamily": "text",
  "layout.spacing": "length",
  "layout.gutters": "length",
  "layout.sizes": "length",
  "effects.shadow": "shadow",
  "effects.transitions": "transition",
  "effects.opacity": "number",
  "effects.zIndex": "number",
  "effects.blur": "length",
  "borders.width": "length",
  "borders.offset": "length",
  "borders.radius": "length",
  "borders.style": "text",
  "animation.duration": "duration",
  "animation.delay": "duration",
  "animation.easing": "text",
};

const kindOf = (path: string): string | undefined => {
  const [subsystem, property] = path.split(".");
  if (subsystem === "colors") return "colour";
  return PROPERTY_KINDS[`${subsystem}.${property}`];
};

type Context = {
  tokens: Record<string, Ref>;
  registry: DerivationRegistry;
  cache: Map<string, Literal>;
  errors: string[];
};

/**
 * Fill one alias `Ref` owned by `owner` (a token path, or a mode / responsive location label) from
 * its target. Returns the alias unchanged when the target is missing or a different kind (an error is
 * recorded); the caller's validation step turns the errors into one `REFRACT_E_VALIDATION`.
 */
const fillAlias = (alias: Ref & { ref: string }, ownerPath: string, where: string, ctx: Context): Ref => {
  const targetPath = alias.ref;
  if (!(targetPath in ctx.tokens)) {
    ctx.errors.push(`${where}: alias { ref: "${targetPath}" } points at a token that doesn't exist`);
    return alias;
  }

  const ownerKind = kindOf(ownerPath);
  const targetKind = kindOf(targetPath);
  if (ownerKind && targetKind && ownerKind !== targetKind) {
    ctx.errors.push(
      `${where}: alias { ref: "${targetPath}" } points at a ${targetKind} token, but ${ownerPath} holds a ${ownerKind}`,
    );
    return alias;
  }

  // Follow the alias chain to the terminal token (cycle-safe), then copy its resolved value.
  const seen: string[] = [ownerPath];
  let path = targetPath;
  let terminal = ctx.tokens[path];
  while (isAliasRef(terminal)) {
    if (seen.includes(path)) {
      throw new RefractError("REFRACT_E_CYCLE", `Cyclic alias: ${[...seen, path].join(" -> ")}`);
    }
    seen.push(path);
    path = terminal.ref;
    terminal = ctx.tokens[path];
    if (!terminal) {
      ctx.errors.push(`${where}: alias chain reaches "${path}", which doesn't exist`);
      return alias;
    }
  }
  if (seen.includes(path)) {
    throw new RefractError("REFRACT_E_CYCLE", `Cyclic alias: ${[...seen, path].join(" -> ")}`);
  }

  const filled: Ref = { ref: targetPath };
  if (terminal.struct !== undefined) {
    filled.struct = terminal.struct;
  } else if (terminal.external !== undefined) {
    filled.value = `var(${terminal.external})`;
  } else {
    filled.value =
      terminal.value !== undefined ? terminal.value : resolveToken(ctx.tokens, ctx.registry, path, ctx.cache);
    if (terminal.unit !== undefined) filled.unit = terminal.unit;
  }
  return filled;
};

/** Fill every alias in a `field → Ref` map. Returns undefined when nothing changed. */
const fillFields = (
  fields: Record<string, Ref>,
  ownerPath: (field: string) => string,
  where: string,
  ctx: Context,
): Record<string, Ref> | undefined => {
  let next: Record<string, Ref> | undefined;
  for (const [field, ref] of Object.entries(fields)) {
    if (!isAliasRef(ref)) continue;
    next = next ?? { ...fields };
    next[field] = fillAlias(ref, ownerPath(field), `${where}.${field}`, ctx);
  }
  return next;
};

const fillProperty = (pm: PropertyModel, owner: string, ctx: Context): PropertyModel | undefined => {
  let next: PropertyModel | undefined;
  const edit = (): PropertyModel => (next = next ?? { ...pm });

  if (isAliasRef(pm.base)) edit().base = fillAlias(pm.base, owner, owner, ctx);

  if (pm.variants) {
    let variants: Record<string, VariantModel> | undefined;
    for (const [name, variant] of Object.entries(pm.variants)) {
      const path = `${owner}.${name}`;
      const base = isAliasRef(variant.base) ? fillAlias(variant.base, path, path, ctx) : variant.base;
      const extras = variant.extras ? fillFields(variant.extras, f => `${path}.${f}`, path, ctx) : undefined;
      if (base === variant.base && !extras) continue;
      variants = variants ?? { ...pm.variants };
      variants[name] = { ...variant, base, ...(extras ? { extras } : {}) };
    }
    if (variants) edit().variants = variants;
  }

  const fillOverrides = (list: PropertyOverride[] | undefined, label: (o: PropertyOverride) => string): PropertyOverride[] | undefined => {
    if (!list) return undefined;
    let out: PropertyOverride[] | undefined;
    list.forEach((entry, i) => {
      if (!entry.overrides) return;
      const targetPath = entry.target ? `${owner}.${entry.target}` : owner;
      const fields = fillFields(entry.overrides, f => (f === "base" ? targetPath : `${targetPath}.${f}`), label(entry), ctx);
      if (!fields) return;
      out = out ?? [...list];
      out[i] = { ...entry, overrides: fields };
    });
    return out;
  };

  const modes = fillOverrides(pm.modes, e => `${owner}.modes.${e.mode}`);
  if (modes) edit().modes = modes;
  const responsive = fillOverrides(pm.responsive, e => `${owner}.responsive.${e.breakpoint}`);
  if (responsive) edit().responsive = responsive;

  return next;
};

/**
 * Fill every raw-theme alias in the Model from its target. Returns the (possibly) new Model and the
 * collected errors (missing targets, kind mismatches) for the caller's validation step.
 */
export const resolveAliases = (
  model: ThemeModel,
  registry: DerivationRegistry,
): { model: ThemeModel; errors: string[] } => {
  const ctx: Context = { tokens: buildTokenMap(model), registry, cache: new Map(), errors: [] };
  let changed = false;
  const subsystems: ThemeModel["subsystems"] = {};

  for (const [subKey, sub] of Object.entries(model.subsystems)) {
    let props: Record<string, PropertyModel> | undefined;
    for (const [name, pm] of Object.entries(sub.properties ?? {})) {
      // Structural config tokens (`layout.container--inset`) are built with internal `{ ref }` links to a
      // scale step; they aren't authored aliases, so they keep their existing handling.
      if (name.includes("--")) continue;
      const next = fillProperty(pm, `${subKey}.${name}`, ctx);
      if (!next) continue;
      props = props ?? { ...sub.properties };
      props[name] = next;
    }
    subsystems[subKey] = props ? { ...sub, properties: props } : sub;
    if (props) changed = true;
  }

  return { model: changed ? { ...model, subsystems } : model, errors: ctx.errors };
};
