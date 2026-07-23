/**
 * Length units as a property of the value (§21).
 *
 * A length's unit belongs to the value, not to one global adapter switch. This module owns the whole
 * length-unit story: the CSS unit set, parsing an authored length input into a canonical dimension,
 * the three-layer role resolution, and the format-neutral **Model pass** that bakes a fully-resolved
 * `{ value, unit }` onto every length leaf. Adapters downstream only stringify (`value + unit`).
 *
 * Resolution order for a length leaf's unit (most-specific wins):
 *   ① value-level unit  — the token pinned `"1px"`; trusted verbatim, never converted
 *   ② role default      — `units["<sub>.<prop>"]` → `units["<sub>"]` → `units.default`
 *   ③ built-in seed     — length subsystems seed `px`; `lineHeight` → none; `letterSpacing` → em
 *
 * A bare number is **deferred** (px-intended magnitude, unit resolved by ②/③); `rem` is the one unit
 * whose resolution divides (`value ÷ baseFontSize`). An explicit unit is **pinned** — passed through.
 * Functions / keywords (`calc(…)`, `clamp(…)`, `var(…)`, `none`) are raw-string escapes, never parsed.
 */

import type { PropertyModel, Ref, ShadowLayer, SubsystemModel, ThemeModel, VariantModel } from "./model";
import { RefractError } from "./errors";

// ---------------------------------------------------------------------------
// Unit set
// ---------------------------------------------------------------------------

/**
 * The CSS length / relative unit set we parse + validate (§21 D2 — support every unit, exclude only
 * functions). A `<number><unit>` whose suffix is here becomes a pinned dimension; an unknown suffix is
 * an authoring error; anything with parens / whitespace / no digits is a raw-string escape.
 */
export const CSS_UNITS = [
  // absolute
  "px", "cm", "mm", "q", "in", "pc", "pt",
  // font-relative
  "rem", "em", "ex", "cap", "ch", "ic", "lh", "rlh",
  // percentage
  "%",
  // viewport
  "vw", "vh", "vi", "vb", "vmin", "vmax",
  "svw", "svh", "lvw", "lvh", "dvw", "dvh",
  // container-query
  "cqw", "cqh", "cqi", "cqb", "cqmin", "cqmax",
] as const;

export type Unit = (typeof CSS_UNITS)[number];

/** A resolved role: a concrete unit, or `"none"` (a length leaf that stays unit-less, e.g. lineHeight). */
export type RoleUnit = Unit | "none";

const UNIT_SET: ReadonlySet<string> = new Set(CSS_UNITS);

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

/** A parsed length: a magnitude + optional unit (absent ⇒ deferred), or a raw escape string. */
export type ParsedLength = { value: number; unit?: Unit } | { raw: string };

const NUMERIC_RE = /^-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?$/i;
const LENGTH_RE = /^(-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?)([a-z%]+)$/i;

/**
 * Parse one authored length input into a {@link ParsedLength}. A number, or a bare numeric string, is
 * deferred (`{ value }`). A `<number><unit>` with a known CSS unit is pinned (`{ value, unit }`). A
 * `<number><unknown>` is an authoring error (a typo — real functions/keywords carry parens or letters
 * with no leading number and fall through to `{ raw }`).
 */
export const parseLength = (input: number | string): ParsedLength => {
  if (typeof input === "number") return { value: input };
  const trimmed = input.trim();
  if (NUMERIC_RE.test(trimmed)) return { value: Number(trimmed) };
  const m = LENGTH_RE.exec(trimmed);
  if (m) {
    const unit = m[2].toLowerCase();
    if (UNIT_SET.has(unit)) return { value: Number(m[1]), unit: unit as Unit };
    throw new RefractError(
      "REFRACT_E_UNITS",
      `Unknown length unit "${m[2]}" in "${input}". Use a CSS unit, or wrap functions/keywords ` +
        `(calc(), clamp(), var(), a keyword) — those pass through as raw strings.`,
    );
  }
  return { raw: input };
};

// ---------------------------------------------------------------------------
// Role resolution
// ---------------------------------------------------------------------------

/**
 * The build/theme-level unit config (§21 D3). Keys are token-path prefixes — `units.default` (global),
 * `units["<subsystem>"]` (subsystem grain), `units["<subsystem>.<property>"]` (property grain). Values
 * are a concrete unit or `"none"`. Most-specific wins; falls back to the built-in seed, then `px`.
 */
export type UnitsConfig = { default?: RoleUnit } & Record<string, RoleUnit | undefined>;

export type UnitResolutionConfig = {
  units?: UnitsConfig;
  /** Divisor for a deferred magnitude resolving to `rem` (matches typography + media). Default `16`. */
  baseFontSize?: number;
};

export const DEFAULT_BASE_FONT_SIZE = 16;

/**
 * The built-in seed (§21 D1) — the zero-config role default per length path. Length subsystems seed
 * `px` (the implicit fallback below, so they need no entry); the only entries are the two exceptions
 * whose natural unit differs: `lineHeight` is unit-less, `letterSpacing` is font-relative. Keeping the
 * px subsystems un-seeded is what makes default output byte-identical to the pre-§21 px-everywhere path.
 */
const SEED: Record<string, RoleUnit> = {
  "typography.lineHeight": "none",
  "typography.letterSpacing": "em",
};

/**
 * Resolve the role unit for a length leaf at `pathKey` (`"typography.letterSpacing"`). Precedence is
 * by **grain**, most-specific first, with the built-in property-grain seed slotted at its own grain —
 * so `SEED["typography.lineHeight"] = "none"` beats a blunt subsystem-grain `units.typography = "rem"`
 * (§21 D1: property grain beats subsystem grain), while a user can still force it with the property key.
 */
export const resolveRoleUnit = (pathKey: string, units: UnitsConfig | undefined): RoleUnit => {
  const subsystem = pathKey.slice(0, pathKey.indexOf("."));
  return (
    units?.[pathKey] ?? // ① user property grain
    SEED[pathKey] ?? //     ② built-in property grain
    units?.[subsystem] ?? // ③ user subsystem grain
    units?.default ?? //    ④ user global
    "px" //                 ⑤ built-in fallback
  );
};

/** Round a rem conversion to 4 dp, trailing zeros trimmed (matches the pre-§21 `formatLength`). */
const roundRem = (value: number, baseFontSize: number): number =>
  Number((value / baseFontSize).toFixed(4));

/**
 * Resolve a deferred magnitude against its role unit → a concrete `{ value, unit? }`. `"none"` keeps
 * the value unit-less; `rem` divides by `baseFontSize`; every other unit is a straight tag.
 */
const resolveDeferred = (
  value: number,
  role: RoleUnit,
  baseFontSize: number,
): { value: number; unit?: Unit } => {
  if (role === "none") return { value };
  if (role === "rem") return { value: roundRem(value, baseFontSize), unit: "rem" };
  return { value, unit: role };
};

// ---------------------------------------------------------------------------
// Leaf resolution
// ---------------------------------------------------------------------------

/**
 * Resolve one length leaf {@link Ref} against its role. A pure token reference (`{ ref }`, no baked
 * value) is left untouched (its unit resolves at its own address). A **derived** length leaf
 * (`{ ref, fn, arg, value }` — §10.6 scale steps) carries its own baked `value`, emitted as a literal,
 * so its unit IS resolved here. A numeric or numeric-string value is deferred → resolved via the role;
 * a `<number><unit>` string is pinned → carried verbatim onto `{ value, unit }`; a raw escape
 * (`calc()`, keyword) is left as its string value. Returns a NEW ref when anything changed, else the
 * original (structural sharing preserved for byte-identical untouched branches).
 */
export const resolveLengthRef = (
  ref: Ref,
  role: RoleUnit,
  baseFontSize: number,
): Ref => {
  if (ref.unit !== undefined) return ref; // already resolved (idempotent — `override` re-runs the pass)
  if (ref.ref !== undefined && ref.value === undefined) return ref; // pure alias — resolved at its own token
  const v = ref.value;

  if (typeof v === "number") {
    const { value, unit } = resolveDeferred(v, role, baseFontSize);
    return unit === undefined ? ref : { ...ref, value, unit };
  }

  if (typeof v === "string") {
    const parsed = parseLength(v);
    if ("raw" in parsed) return ref; // keyword / function — untouched
    if (parsed.unit !== undefined) return { ...ref, value: parsed.value, unit: parsed.unit }; // pinned
    const { value, unit } = resolveDeferred(parsed.value, role, baseFontSize); // numeric string → deferred
    return unit === undefined ? { ...ref, value } : { ...ref, value, unit };
  }

  return ref;
};

/** Resolve every geometry field of a structured shadow layer (§15) against the `effects.shadow` role. */
const resolveShadowLayer = (
  layer: ShadowLayer,
  role: RoleUnit,
  baseFontSize: number,
): ShadowLayer => {
  const out: ShadowLayer = { ...layer };
  let changed = false;
  for (const field of ["offsetX", "offsetY", "blur", "spread"] as const) {
    const dim = layer[field];
    if (dim === undefined) continue;
    const resolved = resolveShadowDimension(dim, role, baseFontSize);
    if (resolved !== dim) {
      out[field] = resolved;
      changed = true;
    }
  }
  return changed ? out : layer;
};

/**
 * Resolve one shadow geometry field — a bare number (deferred) or a `{ value, unit }` (pinned, e.g.
 * authored `"1px"`). Deferred resolves via the role; pinned passes through. Mirrors {@link resolveLengthRef}
 * for the struct case, where the field is a {@link ShadowDimension} rather than a {@link Ref}.
 */
const resolveShadowDimension = (
  dim: ShadowDimension,
  role: RoleUnit,
  baseFontSize: number,
): ShadowDimension => {
  if (typeof dim === "number") {
    const { value, unit } = resolveDeferred(dim, role, baseFontSize);
    return unit === undefined ? dim : { value, unit };
  }
  return dim; // already a pinned { value, unit }
};

/** A shadow geometry field after §21 widening — a deferred magnitude or a pinned `{ value, unit }`. */
export type ShadowDimension = number | { value: number; unit: Unit };

// ---------------------------------------------------------------------------
// Length-field registry
// ---------------------------------------------------------------------------

/** How a length-bearing property carries its value: a scalar leaf, or the shadow struct geometry. */
export type LengthKind = "length" | "shadow";

/**
 * The length-field declaration (formalizes the scattered `PX_*_KEYS` of §16). Which `<subsystem>.<property>`
 * tokens are length-valued, and how they carry it. Anything absent (opacity, zIndex, aspectRatio, easing,
 * durations) is left untouched by the resolver. `lineHeight` is a length that seeds to `none` — listed so a
 * theme CAN opt it into a unit, resolving to unit-less by default.
 */
export const LENGTH_REGISTRY: Record<string, Record<string, LengthKind>> = {
  typography: { fontSize: "length", letterSpacing: "length", lineHeight: "length" },
  layout: { spacing: "length", gutters: "length", sizes: "length" },
  borders: { width: "length", offset: "length", radius: "length" },
  effects: { blur: "length", shadow: "shadow" },
};

// ---------------------------------------------------------------------------
// Model pass
// ---------------------------------------------------------------------------

/**
 * Map a `field → Ref` record, returning the SAME reference when no entry changed (so an already-resolved
 * branch preserves object identity — `override`'s structural-sharing guarantee survives the re-run).
 */
const mapRefs = (record: Record<string, Ref>, map: (ref: Ref) => Ref): Record<string, Ref> => {
  let changed = false;
  const out: Record<string, Ref> = {};
  for (const [key, ref] of Object.entries(record)) {
    const next = map(ref);
    if (next !== ref) changed = true;
    out[key] = next;
  }
  return changed ? out : record;
};

/** dec.3 — map a property's variants (`variant → { base, extras }`), preserving identity when unchanged. */
const mapVariants = (
  variants: Record<string, VariantModel>,
  map: (ref: Ref) => Ref,
): Record<string, VariantModel> => {
  let changed = false;
  const out: Record<string, VariantModel> = {};
  for (const [key, v] of Object.entries(variants)) {
    const base = map(v.base);
    const extras = v.extras ? mapRefs(v.extras, map) : undefined;
    if (base !== v.base || extras !== v.extras) changed = true;
    out[key] = extras ? { base, extras } : { base };
  }
  return changed ? out : variants;
};

/** Map a property's appearance modes (`mode → field → Ref`), preserving identity when nothing changed. */
const mapModes = (
  modes: PropertyModel["modes"] & {},
  map: (ref: Ref) => Ref,
): PropertyModel["modes"] => {
  let changed = false;
  const next = modes.map(entry => {
    if (!entry.overrides) return entry;
    const overrides = mapRefs(entry.overrides, map);
    if (overrides === entry.overrides) return entry;
    changed = true;
    return { ...entry, overrides };
  });
  return changed ? next : modes;
};

/** Map a property's responsive overrides through `map`, preserving identity when nothing changed. */
const mapResponsive = (
  model: PropertyModel,
  map: (ref: Ref) => Ref,
): PropertyModel["responsive"] => {
  if (!model.responsive) return undefined;
  let changed = false;
  const next = model.responsive.map(entry => {
    if (!entry.overrides) return entry;
    const overrides = mapRefs(entry.overrides, map);
    if (overrides === entry.overrides) return entry;
    changed = true;
    return { ...entry, overrides };
  });
  return changed ? next : model.responsive;
};

/**
 * Apply a per-leaf `Ref → Ref` map across a property's leaves (base / variants / extras / modes /
 * responsive), returning the SAME `PropertyModel` when no leaf changed. Both the scalar-length and the
 * shadow-struct passes share this walk — they differ only in the leaf map (`scalar` vs `struct`).
 */
const mapPropertyLeaves = (
  model: PropertyModel,
  map: (ref: Ref) => Ref,
  includeExtras: boolean,
): PropertyModel => {
  const base = map(model.base);
  const variants = model.variants ? mapVariants(model.variants, map) : undefined;
  const extras = includeExtras && model.extras ? mapRefs(model.extras, map) : model.extras;
  const modes = model.modes ? mapModes(model.modes, map) : undefined;
  const responsive = mapResponsive(model, map);

  if (
    base === model.base &&
    variants === model.variants &&
    extras === model.extras &&
    modes === model.modes &&
    responsive === model.responsive
  ) {
    return model;
  }
  const out: PropertyModel = { ...model, base };
  if (variants !== undefined) out.variants = variants;
  if (extras !== undefined) out.extras = extras;
  if (modes !== undefined) out.modes = modes;
  if (responsive !== undefined) out.responsive = responsive;
  return out;
};

/** Resolve a whole `PropertyModel`'s length leaves — scalar leaves, or a shadow's struct geometry. */
const resolvePropertyModel = (
  model: PropertyModel,
  kind: LengthKind,
  role: RoleUnit,
  baseFontSize: number,
): PropertyModel => {
  const map =
    kind === "shadow"
      ? (ref: Ref): Ref => {
          if (!ref.struct) return ref;
          const layers = ref.struct as ShadowLayer[];
          let changed = false;
          const struct = layers.map(layer => {
            const next = resolveShadowLayer(layer, role, baseFontSize);
            if (next !== layer) changed = true;
            return next;
          });
          return changed ? { ...ref, struct } : ref;
        }
      : (ref: Ref): Ref => resolveLengthRef(ref, role, baseFontSize);
  // Shadow struct never lives in `extras`; scalar length extras are meaningless — skip extras for both.
  return mapPropertyLeaves(model, map, false);
};

/**
 * Resolve every length leaf in the {@link ThemeModel} to a concrete `{ value, unit }` (§21 D3). Pure and
 * **reference-preserving**: a subsystem / property / leaf that gains no unit keeps its object identity, so
 * the default px path stays byte-identical AND `override`'s structural sharing survives the re-run
 * (already-resolved parent branches are returned as-is). The single point where `units` is consulted.
 */
export const resolveModelUnits = (model: ThemeModel, config: UnitResolutionConfig = {}): ThemeModel => {
  const baseFontSize = config.baseFontSize ?? DEFAULT_BASE_FONT_SIZE;
  let anySubChanged = false;
  const subsystems: Record<string, SubsystemModel> = {};
  for (const [subKey, subModel] of Object.entries(model.subsystems)) {
    const fields = LENGTH_REGISTRY[subKey];
    if (!fields || !subModel.properties) {
      subsystems[subKey] = subModel;
      continue;
    }
    let anyPropChanged = false;
    const properties: Record<string, PropertyModel> = {};
    for (const [prop, pm] of Object.entries(subModel.properties)) {
      const kind = fields[prop];
      if (!kind) {
        properties[prop] = pm;
        continue;
      }
      const role = resolveRoleUnit(`${subKey}.${prop}`, config.units);
      const next = resolvePropertyModel(pm, kind, role, baseFontSize);
      if (next !== pm) anyPropChanged = true;
      properties[prop] = next;
    }
    if (anyPropChanged) {
      subsystems[subKey] = { ...subModel, properties };
      anySubChanged = true;
    } else {
      subsystems[subKey] = subModel;
    }
  }
  return anySubChanged ? { ...model, subsystems } : model;
};
