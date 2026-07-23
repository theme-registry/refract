/**
 * Effects value coercion (§15) — parse/validate authored shadow / transition leaves into the
 * canonical, **format-neutral** Model form.
 *
 * Modeled on `colors/utils.ts`: a single boundary that runs at normalize time (via the subsystem's
 * `coerceValue`) and turns the ergonomic authoring shapes — a flat single leaf or an array of leaves
 * — into ONE canonical representation the Model carries on `Ref.struct`:
 *
 * - **shadow** → {@link ShadowLayer}`[]` (always an array, even single-layer); `color` kept as its
 *   `colors.*` token-path string (never an embedded `rgba()` — §15.1), resolved late by the adapter.
 *   A translucent shadow references a translucent colour (an `alpha` colour variant — §13.3).
 * - **transitions** → {@link TransitionPart}`[]`; `duration`/`delay` in ms.
 *
 * **Structured-only (§15.2, amended 2026-07-16):** raw CSS strings are REJECTED — the ONLY accepted
 * string is the keyword `"none"` (no shadow / no transition). Every other string throws a path-labelled
 * error. Serialization to CSS text stays in the adapter; this module holds structure, not format. Its
 * only core dependency is the shared length parser (`parseLength`, §21) — so a pinned geometry string
 * (`offsetY: "1px"`) is parsed by the same grammar every length uses, rather than a duplicate here.
 */

import { RefractError } from "../../core/errors";
import type { ShadowLayer, TransitionPart } from "../../core/model";
import { parseLength, type ShadowDimension } from "../../core/units";

/** A single authored shadow layer (flat leaf object) — geometry as a bare number (deferred, resolved by
 * the §21 unit pass) or a pinned length string (`"1px"`, `"0.5rem"`) + a `colors.*` color ref
 * (translucency comes from an `alpha` colour variant, not a shadow field). */
export type ShadowLayerInput = {
  offsetX?: number | string;
  offsetY?: number | string;
  blur?: number | string;
  spread?: number | string;
  color?: string;
  inset?: boolean;
};

/** An authored shadow value: a flat single layer, an array of layers, or the `"none"` keyword. */
export type ShadowInput = "none" | ShadowLayerInput | ShadowLayerInput[];

/** A single authored transition part — `property` (required) + ms durations + timing keyword. */
export type TransitionPartInput = {
  property?: string;
  duration?: number;
  timingFunction?: string;
  delay?: number;
};

/** An authored transition value: a flat single part, an array of parts, or the `"none"` keyword. */
export type TransitionInput = "none" | TransitionPartInput | TransitionPartInput[];

/** The canonical Model form of a shadow value — an array of layers, or the `"none"` keyword. */
export type ShadowCanonical = "none" | ShadowLayer[];

/** The canonical Model form of a transition value — an array of parts, or the `"none"` keyword. */
export type TransitionCanonical = "none" | TransitionPart[];

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Assert a leaf field is a number (or absent), with a path-labelled friendly error. */
const numberField = (value: unknown, label: string): number | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new RefractError("REFRACT_E_EFFECTS", `${label} must be a number, received ${JSON.stringify(value)}.`);
  }
  return value;
};

/**
 * A shadow-geometry length field (§21/§22) — a bare number stays **deferred** (the unit pass resolves
 * it against the `effects.shadow` role); a `<number><unit>` string is **pinned** (`"1px"` → `{value,unit}`,
 * trusted verbatim). A bare numeric string is deferred. Functions/keywords (no unit grammar) throw.
 */
const dimensionField = (value: unknown, label: string): ShadowDimension | undefined => {
  if (value === undefined) return undefined;
  if (typeof value === "number") {
    if (Number.isNaN(value)) throw new RefractError("REFRACT_E_EFFECTS", `${label} must be a number or length string, received ${JSON.stringify(value)}.`);
    return value;
  }
  if (typeof value === "string") {
    const parsed = parseLength(value);
    if ("raw" in parsed) {
      throw new RefractError("REFRACT_E_EFFECTS", `${label} must be a number or a <number><unit> length (received ${JSON.stringify(value)}).`);
    }
    return parsed.unit === undefined ? parsed.value : { value: parsed.value, unit: parsed.unit };
  }
  throw new RefractError("REFRACT_E_EFFECTS", `${label} must be a number or length string, received ${JSON.stringify(value)}.`);
};

// ---------------------------------------------------------------------------
// Shadow
// ---------------------------------------------------------------------------

const SHADOW_FIELDS: ReadonlySet<string> = new Set([
  "offsetX",
  "offsetY",
  "blur",
  "spread",
  "color",
  "inset",
]);

/** Validate + normalize one authored shadow layer into a canonical {@link ShadowLayer}. */
const coerceShadowLayer = (layer: ShadowLayerInput, label: string): ShadowLayer => {
  if (!isPlainObject(layer)) {
    throw new RefractError("REFRACT_E_EFFECTS", `${label} must be a shadow-layer object, received ${JSON.stringify(layer)}.`);
  }
  for (const key of Object.keys(layer)) {
    if (!SHADOW_FIELDS.has(key)) {
      throw new RefractError(
        "REFRACT_E_EFFECTS",
        `${label} has unknown shadow field "${key}" (allowed: ${[...SHADOW_FIELDS].join(", ")}).`,
      );
    }
  }

  const out: ShadowLayer = {};
  const offsetX = dimensionField(layer.offsetX, `${label}.offsetX`);
  const offsetY = dimensionField(layer.offsetY, `${label}.offsetY`);
  const blur = dimensionField(layer.blur, `${label}.blur`);
  const spread = dimensionField(layer.spread, `${label}.spread`);
  if (offsetX !== undefined) out.offsetX = offsetX;
  if (offsetY !== undefined) out.offsetY = offsetY;
  if (blur !== undefined) out.blur = blur;
  if (spread !== undefined) out.spread = spread;
  if (layer.color !== undefined) {
    if (typeof layer.color !== "string" || !layer.color) {
      throw new RefractError("REFRACT_E_EFFECTS", `${label}.color must be a "colors.*" token-path string.`);
    }
    out.color = layer.color;
  }
  if (layer.inset !== undefined) {
    if (typeof layer.inset !== "boolean") {
      throw new RefractError("REFRACT_E_EFFECTS", `${label}.inset must be a boolean.`);
    }
    if (layer.inset) out.inset = true;
  }
  return out;
};

/**
 * Coerce an authored shadow value into its canonical Model form. A string passes through (escape
 * hatch); a flat leaf becomes a one-element `ShadowLayer[]`; an array becomes a multi-layer
 * `ShadowLayer[]`. `label` is the property path for friendly errors.
 */
export const coerceShadowValue = (input: ShadowInput, label = "effects.shadow"): ShadowCanonical => {
  if (typeof input === "string") {
    if (input === "none") return "none";
    throw new RefractError(
      "REFRACT_E_EFFECTS",
      `${label} must be structured shadow layer(s) or "none" — raw CSS strings are not accepted (received ${JSON.stringify(input)}).`,
    );
  }
  if (Array.isArray(input)) {
    if (!input.length) throw new RefractError("REFRACT_E_EFFECTS", `${label} is an empty shadow-layer array.`);
    return input.map((layer, i) => coerceShadowLayer(layer, `${label}[${i}]`));
  }
  return [coerceShadowLayer(input, label)];
};

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

const TRANSITION_FIELDS: ReadonlySet<string> = new Set([
  "property",
  "duration",
  "timingFunction",
  "delay",
]);

/** Validate + normalize one authored transition part into a canonical {@link TransitionPart}. */
const coerceTransitionPart = (part: TransitionPartInput, label: string): TransitionPart => {
  if (!isPlainObject(part)) {
    throw new RefractError("REFRACT_E_EFFECTS", `${label} must be a transition-part object, received ${JSON.stringify(part)}.`);
  }
  for (const key of Object.keys(part)) {
    if (!TRANSITION_FIELDS.has(key)) {
      throw new RefractError(
        "REFRACT_E_EFFECTS",
        `${label} has unknown transition field "${key}" (allowed: ${[...TRANSITION_FIELDS].join(", ")}).`,
      );
    }
  }
  if (typeof part.property !== "string" || !part.property) {
    throw new RefractError("REFRACT_E_EFFECTS", `${label}.property is required (the CSS property to transition).`);
  }

  const out: TransitionPart = { property: part.property };
  const duration = numberField(part.duration, `${label}.duration`);
  const delay = numberField(part.delay, `${label}.delay`);
  if (duration !== undefined) out.duration = duration;
  if (part.timingFunction !== undefined) {
    if (typeof part.timingFunction !== "string" || !part.timingFunction) {
      throw new RefractError("REFRACT_E_EFFECTS", `${label}.timingFunction must be a keyword or cubic-bezier(...) string.`);
    }
    out.timingFunction = part.timingFunction;
  }
  if (delay !== undefined) out.delay = delay;
  return out;
};

/**
 * Coerce an authored transition value into its canonical Model form. A string passes through; a flat
 * part becomes a one-element `TransitionPart[]`; an array becomes a multi-part `TransitionPart[]`.
 */
export const coerceTransitionValue = (
  input: TransitionInput,
  label = "effects.transitions",
): TransitionCanonical => {
  if (typeof input === "string") {
    if (input === "none") return "none";
    throw new RefractError(
      "REFRACT_E_EFFECTS",
      `${label} must be structured transition part(s) or "none" — raw CSS strings are not accepted (received ${JSON.stringify(input)}).`,
    );
  }
  if (Array.isArray(input)) {
    if (!input.length) throw new RefractError("REFRACT_E_EFFECTS", `${label} is an empty transition-part array.`);
    return input.map((part, i) => coerceTransitionPart(part, `${label}[${i}]`));
  }
  return [coerceTransitionPart(input, label)];
};
