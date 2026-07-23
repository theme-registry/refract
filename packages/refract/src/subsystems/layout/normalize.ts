/**
 * Layout's `normalizeProperty` hook — numeric scale synthesis (§10.6) + the forced `none` variant.
 *
 * `spacing` / `gutters` / `sizes` can synthesize their variant ramp from a base + a curve, the same
 * way colors generates tonal steps and typography the type scale:
 *  - **geometric** (`ratio`) — `base × ratio^n`, `steps` an ordered name array (index = exponent);
 *  - **linear** (`step`) — `step × n`, `steps` a name→multiplier map (the 4/8-pt grid).
 *
 * Each synthesized step is stored as a **derived** variant (`{ base, derive:{ ref, fn:"scaleStep",
 * arg } }`) so the Model carries it as a re-resolving `Ref` — `override()` of the base re-synthesizes
 * every step (mirror colors, NOT typography's frozen literals). A ramp entry inside a property's
 * `responsive` list (D6) regenerates the WHOLE named scale at that breakpoint, expanding into one
 * `target` override per step — the already-existing responsive channel, no new Model member.
 *
 * Synthesis is **opt-in + additive**: absent a `ratio`/`step`, behaviour is byte-identical to before
 * (spacing/gutters still get the forced `none`; sizes/aspectRatio pass through). Authored `variants`
 * always win over synthesized ones — the way sizes' semantic caps (`prose`) and pinned values
 * (`full: "100%"`, no magnitude → never synthesized) coexist with the ramp.
 */

import type { NormalizedPropertyValue } from "../../core/normalize";
import type { Literal } from "../../core/model";
import { RefractError } from "../../core/errors";

/** Layout properties eligible for scale synthesis (`aspectRatio` is not a length ramp). */
const SCALE_PROPERTIES: ReadonlySet<string> = new Set(["spacing", "gutters", "sizes"]);

/** Properties that always expose a `none` variant (`base: 0`), synthesized or not. */
const FORCE_NONE_PROPERTIES: ReadonlySet<string> = new Set(["spacing", "gutters"]);

/** Decimal places every synthesized step is rounded to — fixed so `scaleStep` re-derives exactly. */
const SCALE_PRECISION = 4;

/** The default step ladder used when a curve is declared without an explicit `steps`. */
const DEFAULT_LADDER: readonly string[] = ["xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl"];

const round = (n: number): number => Number(n.toFixed(SCALE_PRECISION));

/**
 * The `scaleStep` derivation fn (registered by the layout subsystem). Re-derives a synthesized step
 * from its curve config: **geometric** `base × ratio^exp` (from the resolved base token, so an
 * `override()` of the base rescales it), **linear** `step × mult` (a fixed grid, self-contained in
 * `arg`). A responsive ramp step with an explicit breakpoint base carries it on `arg.base`, so it
 * derives from its own breakpoint base (precedent: colors' appearance modes). Mirrors the way the
 * derivation registry hands every fn `(resolvedValue, arg)`.
 */
export const scaleStep = (value: Literal, arg?: unknown): Literal => {
  const a = (arg ?? {}) as {
    curve?: string;
    ratio?: number;
    exp?: number;
    step?: number;
    mult?: number;
    base?: number;
  };
  if (a.curve === "linear") {
    return round(Number(a.step) * Number(a.mult));
  }
  const base = a.base !== undefined ? Number(a.base) : Number(value);
  return round(base * Math.pow(Number(a.ratio), Number(a.exp)));
};

/** One synthesized step's position — `exp` (ordinal, geometric exponent), `mult` (linear multiplier). */
type StepSpec = { name: string; exp: number; mult?: number };

/** The resolved curve for a property — its kind, its parameters, and the ordered step list. */
type ScaleConfig =
  | { curve: "geometric"; ratio: number; specs: StepSpec[] }
  | { curve: "linear"; step: number; specs: StepSpec[] };

/**
 * Read the top-level curve config off a normalized property. `ratio` selects geometric, `step`
 * selects linear (never both). `steps` is the naming source — an ordered name array for geometric,
 * a name→multiplier map for linear — falling back to {@link DEFAULT_LADDER} when omitted. Returns
 * `undefined` when no curve is declared (the additive, byte-identical path).
 */
const readScaleConfig = (
  propertyKey: string,
  normalized: NormalizedPropertyValue<unknown>,
): ScaleConfig | undefined => {
  const n = normalized as Record<string, unknown>;
  const hasRatio = n.ratio !== undefined;
  const hasStep = n.step !== undefined;
  if (!hasRatio && !hasStep) return undefined;
  if (hasRatio && hasStep) {
    throw new RefractError(
      "REFRACT_E_LAYOUT",
      `layout.${propertyKey}: declare only one of "ratio" (geometric) or "step" (linear) scale, not both.`,
    );
  }
  const steps = n.steps;

  if (hasRatio) {
    let names: readonly string[];
    if (steps === undefined) names = DEFAULT_LADDER;
    else if (Array.isArray(steps)) names = steps.map(String);
    else {
      throw new RefractError(
        "REFRACT_E_LAYOUT",
        `layout.${propertyKey}: a geometric scale ("ratio") needs "steps" as an ordered name array, e.g. ["sm","md","lg"].`,
      );
    }
    const specs = names.map((name, i): StepSpec => ({ name, exp: i }));
    return { curve: "geometric", ratio: Number(n.ratio), specs };
  }

  let specs: StepSpec[];
  if (steps === undefined) {
    specs = DEFAULT_LADDER.map((name, i): StepSpec => ({ name, exp: i, mult: i + 1 }));
  } else if (Array.isArray(steps) || typeof steps !== "object" || steps === null) {
    throw new RefractError(
      "REFRACT_E_LAYOUT",
      `layout.${propertyKey}: a linear scale ("step") needs "steps" as a name→multiplier map, e.g. { sm:1, md:2, lg:3 }.`,
    );
  } else {
    specs = Object.entries(steps as Record<string, unknown>).map(
      ([name, mult], i): StepSpec => ({ name, exp: i, mult: Number(mult) }),
    );
  }
  return { curve: "linear", step: Number(n.step), specs };
};

/** Build the derived variant refs for a curve's steps — each a `{ base, derive }` re-resolving step. */
const synthesizeVariants = (
  propertyKey: string,
  base: unknown,
  config: ScaleConfig,
): Record<string, { base: Literal; derive: { ref: string; fn: string; arg: unknown } }> => {
  const ref = `layout.${propertyKey}`;
  const out: Record<string, { base: Literal; derive: { ref: string; fn: string; arg: unknown } }> = {};
  for (const spec of config.specs) {
    if (config.curve === "geometric") {
      const value = round(Number(base) * Math.pow(config.ratio, spec.exp));
      out[spec.name] = {
        base: value,
        derive: { ref, fn: "scaleStep", arg: { curve: "geometric", ratio: config.ratio, exp: spec.exp } },
      };
    } else {
      const value = round(config.step * (spec.mult as number));
      out[spec.name] = {
        base: value,
        derive: { ref, fn: "scaleStep", arg: { curve: "linear", step: config.step, mult: spec.mult } },
      };
    }
  }
  return out;
};

/**
 * Expand ramp entries in a property's `responsive` list (D6). A responsive entry carrying `ratio`
 * (geometric) or `step` (linear) regenerates the whole named scale at that breakpoint, emitting one
 * `target` override per synthesized step — each a derived `{ base, derive }` so the JSON/DTCG output
 * carries the recipe and `override()` re-runs the ramp. Non-ramp entries (plain value / variant /
 * target swaps) pass through untouched. A geometric ramp uses each step's ordinal exponent (so a
 * `ratio:1` flattens every step to the base); a linear ramp needs the base scale's multipliers.
 */
const expandResponsive = (
  propertyKey: string,
  propBase: unknown,
  responsive: NormalizedPropertyValue<unknown>["responsive"],
  config: ScaleConfig | undefined,
): NormalizedPropertyValue<unknown>["responsive"] => {
  if (!responsive?.length) return responsive;
  const ref = `layout.${propertyKey}`;

  const out: Record<string, unknown>[] = [];
  let expandedAny = false;

  for (const entry of responsive) {
    const e = entry as Record<string, unknown>;
    const isRamp = e.ratio !== undefined || e.step !== undefined;
    if (!isRamp) {
      out.push(e);
      continue;
    }
    expandedAny = true;
    if (e.ratio !== undefined && e.step !== undefined) {
      throw new RefractError(
        "REFRACT_E_LAYOUT",
        `layout.${propertyKey}: a responsive ramp entry may set only "ratio" or "step", not both.`,
      );
    }
    if (!config) {
      throw new RefractError(
        "REFRACT_E_LAYOUT",
        `layout.${propertyKey}: a responsive ramp entry needs a base scale — declare a top-level "ratio"/"step" (+ "steps") first.`,
      );
    }

    const { breakpoint, query, orientation } = e;
    const geometric = e.ratio !== undefined;

    for (const spec of config.specs) {
      let value: number;
      let arg: Record<string, unknown>;
      if (geometric) {
        const ratio = Number(e.ratio);
        const hasBase = e.base !== undefined;
        const b = hasBase ? Number(e.base) : Number(propBase);
        value = round(b * Math.pow(ratio, spec.exp));
        arg = { curve: "geometric", ratio, exp: spec.exp, ...(hasBase ? { base: b } : {}) };
      } else {
        if (spec.mult === undefined) {
          throw new RefractError(
            "REFRACT_E_LAYOUT",
            `layout.${propertyKey}: a linear responsive ramp ("step") requires a linear base scale (a name→multiplier "steps").`,
          );
        }
        const step = Number(e.step);
        value = round(step * spec.mult);
        arg = { curve: "linear", step, mult: spec.mult };
      }
      const expanded: Record<string, unknown> = {
        breakpoint,
        query,
        target: spec.name,
        base: value,
        derive: { ref, fn: "scaleStep", arg },
      };
      if (orientation !== undefined) expanded.orientation = orientation;
      out.push(expanded);
    }
  }

  return (expandedAny ? out : responsive) as NormalizedPropertyValue<unknown>["responsive"];
};

/** Strip the curve-config keys off a normalized property so they never leak as Model extras. */
const stripScaleKeys = (
  normalized: NormalizedPropertyValue<unknown>,
): NormalizedPropertyValue<unknown> => {
  const { ratio, step, steps, ...rest } = normalized as Record<string, unknown>;
  void ratio;
  void step;
  void steps;
  return rest as unknown as NormalizedPropertyValue<unknown>;
};

/**
 * @param propertyKey The layout property being normalized.
 * @param normalized  The property after the shared property normalize pass.
 */
export const finalizeLayoutNormalization = (
  propertyKey: string,
  normalized: NormalizedPropertyValue<unknown>,
): NormalizedPropertyValue<unknown> => {
  if (!SCALE_PROPERTIES.has(propertyKey)) return normalized;

  const config = readScaleConfig(propertyKey, normalized);

  // Additive: no curve declared → the exact legacy behaviour (byte-identical goldens).
  if (!config) {
    return FORCE_NONE_PROPERTIES.has(propertyKey) ? forceNoneVariant(normalized) : normalized;
  }

  // Synthesized steps are the base layer; authored `variants` win on name collision (sizes' semantic
  // caps / pinned `%` ride here); the forced `none` (spacing/gutters) wins over everything.
  const synthesized = synthesizeVariants(propertyKey, normalized.base, config);
  const authored = normalized.variants ?? {};
  let variants: Record<string, unknown> = { ...synthesized, ...authored };
  if (FORCE_NONE_PROPERTIES.has(propertyKey)) variants = { ...variants, none: { base: 0 } };

  const responsive = expandResponsive(propertyKey, normalized.base, normalized.responsive, config);

  return stripScaleKeys({
    ...normalized,
    variants,
    responsive,
  } as unknown as NormalizedPropertyValue<unknown>);
};

/** Force a `none` variant (`base: 0`) onto the property, overriding any author-declared `none`. */
const forceNoneVariant = (
  normalized: NormalizedPropertyValue<unknown>,
): NormalizedPropertyValue<unknown> => {
  const variants = normalized.variants ?? {};
  return {
    ...normalized,
    variants: {
      ...variants,
      none: { base: 0 },
    },
  } as unknown as NormalizedPropertyValue<unknown>;
};
