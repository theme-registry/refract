/**
 * Property normalization — the entry point that turns any authored property value
 * into the canonical {@link NormalizedPropertyValue} shape.
 *
 * Collapses the three authoring forms (a bare value, or an extended object with
 * `base` / `variants` / `responsive`, plus subsystem `extra` fields) into one shape:
 * a resolved `base`, a normalized `variants` map, and a normalized `responsive` list.
 */

import {
  ExtendedProperty,
  ModeDerivation,
  ModeOverride,
  NormalizedModeValue,
  NormalizedModeOverride,
  NormalizedPropertyValue,
  NormalizedVariantValue,
  PropertyNormalizationOptions,
  PropertyValue,
  VariantValue,
} from "./types";
import { normalizeResponsiveOverrides } from "./responsive";
import { RefractError } from "../errors";

/** dec.2 — a `{ ref?, modifiers }` derivation (vs a literal or a multi-field mode object). */
const isModeDerivation = (value: unknown): value is ModeDerivation =>
  typeof value === "object" &&
  value !== null &&
  Array.isArray((value as { modifiers?: unknown }).modifiers);

/**
 * dec.2 — parse an authored `modifiers` chain of single-key `{ [fn]: args }` dials into the
 * canonical `{ fn, arg }[]` the subsystem hook folds. Each element must have exactly one key (the
 * fn name), its value the arg (`{ darken: 10 }` → `{ fn: "darken", arg: 10 }`).
 */
const parseModifiers = (modifiers: unknown, path: string): Array<{ fn: string; arg?: unknown }> => {
  if (!Array.isArray(modifiers) || modifiers.length === 0) {
    throw new RefractError("REFRACT_E_VARIANT", `Derivation "${path}" needs a non-empty "modifiers" array.`);
  }
  return modifiers.map((m, i) => {
    if (typeof m !== "object" || m === null || Array.isArray(m)) {
      throw new RefractError("REFRACT_E_VARIANT", `Modifier ${i} of "${path}" must be a single-key object like { darken: 10 }.`);
    }
    const keys = Object.keys(m as Record<string, unknown>);
    if (keys.length !== 1) {
      throw new RefractError("REFRACT_E_VARIANT", `Modifier ${i} of "${path}" must have exactly one fn key; got [${keys.join(", ")}].`);
    }
    return { fn: keys[0], arg: (m as Record<string, unknown>)[keys[0]] };
  });
};

/**
 * Normalize one authored appearance-mode override ENTRY (§10.3) into a {@link NormalizedModeOverride}.
 * An entry is `{ mode, target?, …value }`: the `mode` name (WHEN) + optional `target` (WHERE) are
 * peeled off, and the value payload (WHAT) is normalized like a variant — a `{ ref?, modifiers }`
 * derivation (dec.2, unbaked by core), a flat object-leaf (§15), or a `{ base?, …extra }` object.
 */
const normalizeMode = <TValue, TExtra extends Record<string, unknown>, TBreakpoint extends string>(
  entry: ModeOverride<TValue, TExtra>,
  options: PropertyNormalizationOptions<TValue, TBreakpoint>,
): NormalizedModeOverride<TValue, TExtra> => {
  const { mode: name, target, ...value } = entry as { mode: string; target?: string } & Record<string, unknown>;
  const modePath = options.propertyPath ? `${options.propertyPath}.modes.${name}` : `modes.${name}`;

  const normalizedValue = ((): NormalizedModeValue<TValue, TExtra> => {
    // §15: object-leaf subsystems — a flat leaf object (no `base` key, not a derivation) assembles its
    // leaf fields into the base; an explicit `base:` (incl. a multi-layer array) passes through below.
    if (options.leafFields?.length && !("base" in value) && !isModeDerivation(value)) {
      const { base: assembled, extra } = partitionLeafBase(value, options.leafFields);
      if (assembled !== undefined) {
        const normalized: NormalizedModeValue<TValue, TExtra> = { ...(extra as Partial<TExtra>) };
        normalized.base = options.coerceValue ? options.coerceValue(assembled as TValue) : (assembled as TValue);
        return normalized;
      }
    }
    // dec.2 — `{ ref?, modifiers, …extra }` derivation → derived base (unbaked by core) + literal extras.
    if (isModeDerivation(value)) {
      const { ref, modifiers, ...rest } = value as ModeDerivation & Record<string, unknown>;
      const normalized: NormalizedModeValue<TValue, TExtra> = { ...(rest as Partial<TExtra>) };
      normalized.derive = {
        ...(ref !== undefined ? { ref } : {}),
        modifiers: parseModifiers(modifiers, modePath),
      };
      return normalized;
    }
    // Multi-field object: literal `base` (or a struct array) + literal extras.
    const { base, ...rest } = value as { base?: TValue } & Record<string, unknown>;
    const normalized: NormalizedModeValue<TValue, TExtra> = { ...(rest as Partial<TExtra>) };
    if (base !== undefined) {
      normalized.base = Array.isArray(base) || !options.coerceValue ? (base as TValue) : options.coerceValue(base as TValue);
    }
    if (normalized.base === undefined && !normalized.derive && !Object.keys(rest).length) {
      throw new RefractError("REFRACT_E_MODE", `Appearance mode "${modePath}" overrides nothing.`);
    }
    return normalized;
  })();

  return { mode: name, ...(target !== undefined ? { target } : {}), ...normalizedValue };
};

/** Build the ` for "<path>"` suffix used in error messages (empty when no path is known). */
const formatPropertyLabel = (path?: string): string =>
  path ? ` for "${path}"` : "";

/** Condition axes on a property responsive override (everything else is a value / leaf / extra field). */
const RESPONSIVE_CONDITION_KEYS: ReadonlySet<string> = new Set([
  "breakpoint",
  "query",
  "ref", // dec.5 — swap source (was `variant`)
  "modifiers", // dec.5 — derivation chain on `ref` (subsystem bakes it; never a plain field)
  "mode", // dec.9 — appearance-mode condition
  "target",
  "orientation",
]);

/** Discriminate the extended object form (`{ base, … }`) from a bare property value. */
const isExtendedProperty = <
  TValue,
  TExtra extends Record<string, unknown>,
  TBreakpoint extends string,
>(value: PropertyValue<TValue, TExtra, TBreakpoint>): value is ExtendedProperty<TValue, TExtra, TBreakpoint> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Resolve a property's base value, falling back `providedBase → fallback →
 * options.fallbackBase`, applying `coerceValue` if provided. Throws when none resolve.
 */
const resolveBaseValue = <TValue, TBreakpoint extends string>(
  providedBase: TValue | undefined,
  fallback: TValue | undefined,
  options: PropertyNormalizationOptions<TValue, TBreakpoint>,
): TValue => {
  const candidate = providedBase ?? fallback ?? options.fallbackBase;

  if (candidate === undefined) {
    throw new RefractError("REFRACT_E_PROPERTY", `Unable to resolve base value${formatPropertyLabel(options.propertyPath)}.`);
  }

  return options.coerceValue ? options.coerceValue(candidate) : candidate;
};

/**
 * Partition an object into its assembled leaf-base value + remaining `TExtra` siblings (§15). When
 * `leafFields` carries at least one key present in `source`, those keys are collected into a base
 * object and the rest returned as `extra`; otherwise `base` is `undefined` (no leaf fields → the
 * caller uses the normal base path). Never fires without `leafFields` (scalar subsystems untouched).
 */
const partitionLeafBase = (
  source: Record<string, unknown>,
  leafFields: readonly string[],
): { base: Record<string, unknown> | undefined; extra: Record<string, unknown> } => {
  const leafSet = new Set(leafFields);
  const base: Record<string, unknown> = {};
  const extra: Record<string, unknown> = {};
  let hasLeaf = false;
  for (const [key, value] of Object.entries(source)) {
    if (leafSet.has(key)) {
      base[key] = value;
      hasLeaf = true;
    } else {
      extra[key] = value;
    }
  }
  return { base: hasLeaf ? base : undefined, extra };
};

/**
 * Resolve a base value honoring the §15 leaf-field escape hatch. An explicit `base` wins (coerced
 * via {@link resolveBaseValue}); otherwise, when `options.leafFields` is set and `rest` carries leaf
 * fields, the base is assembled from them (coerced) and the remaining keys returned as `extra`.
 * With no `leafFields` (scalar subsystems) this is exactly `resolveBaseValue` + `rest` as extra.
 */
const resolveBaseAndExtra = <TValue, TBreakpoint extends string>(
  base: TValue | undefined,
  rest: Record<string, unknown>,
  fallback: TValue | undefined,
  options: PropertyNormalizationOptions<TValue, TBreakpoint>,
): { base: TValue; extra: Record<string, unknown> } => {
  if (base === undefined && options.leafFields?.length) {
    const partitioned = partitionLeafBase(rest, options.leafFields);
    if (partitioned.base !== undefined) {
      const assembled = partitioned.base as TValue;
      return {
        base: options.coerceValue ? options.coerceValue(assembled) : assembled,
        extra: partitioned.extra,
      };
    }
  }
  return { base: resolveBaseValue(base, fallback, options), extra: rest };
};

/**
 * Assemble an object-leaf subsystem's responsive override (§15). A responsive entry that carries leaf
 * fields (or an explicit `base`) REPLACES the property's value at that breakpoint — its leaf fields
 * are assembled + coerced into `base` (whole-value replacement, like a variant swap sets the var). A
 * pure condition entry (a `variant`/`target` swap with no leaf fields) is returned untouched. Only
 * runs for `leafFields` subsystems; scalar subsystems keep their responsive entries verbatim.
 */
const assembleResponsiveLeaf = <TValue, TBreakpoint extends string>(
  entry: Record<string, unknown>,
  options: PropertyNormalizationOptions<TValue, TBreakpoint>,
): Record<string, unknown> => {
  const condition: Record<string, unknown> = {};
  const others: Record<string, unknown> = {};
  let explicitBase: TValue | undefined;
  for (const [key, value] of Object.entries(entry)) {
    if (RESPONSIVE_CONDITION_KEYS.has(key)) condition[key] = value;
    else if (key === "base") explicitBase = value as TValue;
    else others[key] = value;
  }

  const hasLeaf = options.leafFields!.some(field => field in others);
  if (explicitBase === undefined && !hasLeaf) return entry; // pure swap / condition — nothing to assemble

  const { base: assembled, extra } = resolveBaseAndExtra(explicitBase, others, undefined, options);
  return { ...condition, ...extra, base: assembled };
};

/**
 * Normalize one named variant into `{ base, …extra }`. Accepts both the bare form
 * (`muted: "#999"`) and the extended form (`muted: { base: "#999", … }`). dec.3 — `fallbackBase`
 * is the property's own base: a variant that omits `base` (overriding only an extra) INHERITS it.
 */
const normalizeVariant = <
  TValue,
  TExtra extends Record<string, unknown>,
  TBreakpoint extends string,
>(
  name: string,
  variant: VariantValue<TValue, TExtra, TBreakpoint>,
  options: PropertyNormalizationOptions<TValue, TBreakpoint>,
  fallbackBase?: TValue,
): NormalizedVariantValue<TValue, TExtra, TBreakpoint> => {
  const variantPath = options.propertyPath
    ? `${options.propertyPath}.variants.${name}`
    : `variants.${name}`;

  const extended = isExtendedProperty<TValue, TExtra, TBreakpoint>(variant)
    ? variant
    : ({ base: variant } as ExtendedProperty<TValue, TExtra, TBreakpoint>);

  const { base, ...rest } = extended;
  const { base: resolvedBase, extra } = resolveBaseAndExtra(
    base,
    rest as Record<string, unknown>,
    fallbackBase, // dec.3 — inherit the property base when the variant omits its own.
    { ...options, propertyPath: variantPath },
  );

  return {
    ...(extra as unknown as TExtra),
    base: resolvedBase,
  };
};

/**
 * Normalize any authored property value into the canonical {@link NormalizedPropertyValue}.
 *
 * @param value   A bare value or an extended `{ base, variants?, responsive?, …extra }` object.
 * @param options `propertyPath` (error labels), `fallbackBase`, `coerceValue`, and
 *   `allowedBreakpoints` (responsive breakpoint validation).
 * @returns `{ base, responsive, variants?, …extra }` — `responsive` always an array,
 *   each entry with its `query` defaulted; `variants` normalized or `undefined`.
 * @throws If no base value can be resolved, or a responsive entry fails validation.
 */
export const normalizePropertyValue = <
  TValue,
  TExtra extends Record<string, unknown> = Record<string, never>,
  TBreakpoint extends string = string,
>(
  value: PropertyValue<TValue, TExtra, TBreakpoint>,
  options: PropertyNormalizationOptions<TValue, TBreakpoint> = {},
): NormalizedPropertyValue<TValue, TExtra, TBreakpoint> => {
  const extended = isExtendedProperty<TValue, TExtra, TBreakpoint>(value)
    ? value
    : ({ base: value } as ExtendedProperty<TValue, TExtra, TBreakpoint>);

  const { base, responsive, variants, modes, ...rest } = extended;
  const { base: resolvedBase, extra } = resolveBaseAndExtra(
    base,
    rest as Record<string, unknown>,
    options.fallbackBase,
    options,
  );
  const normalizedVariants = variants
    ? Object.fromEntries(
        Object.entries(variants).map(([name, definition]) => [
          name,
          normalizeVariant(name, definition, options, resolvedBase), // dec.3 — property base = variant fallback.
        ]),
      )
    : undefined;
  const normalizedModes = modes ? modes.map(entry => normalizeMode(entry, options)) : undefined;
  const responsiveContext = {
    propertyPath: options.propertyPath,
    allowedBreakpoints: options.allowedBreakpoints,
  } as const;
  const normalizedResponsive = normalizeResponsiveOverrides(responsive, responsiveContext);
  // §15: object-leaf subsystems assemble a responsive entry's inline leaf fields into a `base` value
  // (whole-value replacement). Gated on `leafFields`, so scalar subsystems keep entries verbatim.
  const finalResponsive = options.leafFields?.length
    ? normalizedResponsive.map(
        entry =>
          assembleResponsiveLeaf(entry as Record<string, unknown>, options) as typeof entry,
      )
    : normalizedResponsive;

  return {
    ...(extra as unknown as TExtra),
    base: resolvedBase,
    responsive: finalResponsive,
    variants: normalizedVariants,
    modes: normalizedModes,
  };
};
