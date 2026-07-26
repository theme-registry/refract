/**
 * Guided raw-theme generator (Node-only, pure) — the engine behind `refract create`.
 *
 * Turns a seed colour plus a handful of answers into a complete `RawTheme`. Deliberately split from
 * the prompting (`cli.ts`) and from the file writing (`createCommand.ts`) so the whole generator is
 * testable without a TTY and reusable programmatically.
 *
 * The governing rule for what lands in the output:
 *
 *   **Bake a literal** where the value came from an opinion the engine does not hold — the harmony
 *   rotation, the contrast nudge, the leading/tracking curves. Those are this module's taste, and a
 *   scaffolded theme is a style guide the user then owns, so it must hold still.
 *
 *   **Write the declaration** where the engine already synthesizes — `fontSize.ratio`,
 *   `layout.spacing.step`. Baking those would throw the intent away: re-tuning a scale should stay a
 *   one-word edit, not a regeneration of eight numbers.
 *
 * Nothing here changes the palette model. It calls the colour helpers the package already ships
 * (`rotateHue`/`darken`, and `audit` for the contrast gate) and writes down what they return, once.
 * Callers who want a companion that *re-derives* on `override()` should use `colors.harmony` instead —
 * that is the other tool, for the other job.
 */

import type { RawTheme } from "../core";
import { createTheme } from "../core/createTheme";
import { createNoopAdapter } from "../core/noopAdapter";
import { audit } from "../subsystems/colors/audit";
import type { WcagLevel } from "../subsystems/colors/audit";
import { darken, rotateHue, parseColor, convertRgbToHex, rgbToOklch } from "../subsystems/colors/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Tunable constants — the generator's opinions, deliberately in the open.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Leading falls as size grows: `LEADING_AT_BASE × (BASE_PX / size) ^ LEADING_EXPONENT`, clamped.
 * Fitted to land on conventional values at 16px (1.50) and to tighten a display line enough that a
 * dramatic ratio doesn't ship a 67px headline set at 1.5. Another designer would pick differently.
 */
const LEADING_AT_BASE = 1.5;
const LEADING_EXPONENT = 0.22;
const LEADING_MIN = 1.1;
const LEADING_MAX = 1.7;

/**
 * Tracking crosses from positive (small text wants air) to negative (display text wants tightening):
 * `TRACKING_NUMERATOR / size − TRACKING_OFFSET`, in em. Zero at 16px by construction.
 */
const TRACKING_NUMERATOR = 0.36;
const TRACKING_OFFSET = 0.0225;

/** The reference size both curves are anchored at. */
const CURVE_ANCHOR_PX = 16;

/** The engine's default `fontSize` step names and their exponent off `base`. Mirrors typography. */
const TYPE_STEPS: ReadonlyArray<readonly [string, number]> = [
  ["xs", -2], ["sm", -1], ["md", 0], ["lg", 1],
  ["xl", 2], ["2xl", 3], ["3xl", 4], ["4xl", 5],
];

/** Numeric value of each named type ratio. Mirrors `TYPOGRAPHY_RATIOS` in the typography subsystem. */
const RATIO_VALUES: Readonly<Record<string, number>> = {
  "minor-second": 1.067, "major-second": 1.125, "minor-third": 1.2, "major-third": 1.25,
  "perfect-fourth": 1.333, "augmented-fourth": 1.414, "perfect-fifth": 1.5, golden: 1.618,
};

/**
 * Hue rotations per scheme. Aligned with the colours subsystem's own `HARMONY_SCHEMES` where they
 * overlap, so a scaffolded literal and an authored `harmony:` key agree. `pentadic` is local — the
 * subsystem has no five-way scheme, and the scaffolder needs one to reach five brand colours.
 */
const SCHEME_ROTATIONS: Readonly<Record<string, readonly number[]>> = {
  complement: [180],
  analogous: [-30, 30],
  "split-complement": [150, 210],
  triadic: [120, 240],
  tetradic: [90, 180, 270],
  pentadic: [72, 144, 216, 288],
};

/** Ordinal names for the generated brand palettes. Rename freely — it's your file. */
const BRAND_NAMES = ["primary", "secondary", "tertiary", "quaternary", "quinary"] as const;

/**
 * Semantic colours start from fixed hue anchors, NOT from a rotation off the seed. Rotating would
 * make "danger" whatever hue lands at +150° — from a red seed you'd get a green danger, which is
 * worse than useless. These are conventional anchors; the contrast pass then adapts their lightness.
 */
const SEMANTIC_ANCHORS: ReadonlyArray<readonly [string, string, string]> = [
  ["success", "#2f9e44", "#ffffff"],
  ["info", "#1c7ed6", "#ffffff"],
  ["warning", "#e89012", "#1f2733"],
  ["danger", "#e03131", "#ffffff"],
];

/** The neutral seed and the shadow ink. Both are deliberately cool — they sit under everything. */
const NEUTRAL_SEED = "#6b7280";
const SHADOW_INK = "#18274b";

/** The absolute lightness ladder every palette carries. `L = (1000 − label) / 10`. */
const LADDER: readonly number[] = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];

/** Alpha levels for the shadow tints, matched to the three elevation levels. */
const SHADOW_ALPHAS: readonly number[] = [8, 14, 22];

/** How many times the contrast pass may darken a failing palette before giving up. */
const MAX_CONTRAST_ITERATIONS = 40;

// ─────────────────────────────────────────────────────────────────────────────
// "Overall feel" presets — type family, density and corners move together.
// Choosing them separately is how you end up with an incoherent system.
// ─────────────────────────────────────────────────────────────────────────────

export type Feel = "neutral" | "compact" | "editorial" | "technical";

interface FeelPreset {
  readonly label: string;
  readonly blurb: string;
  /** `fontFamily` base + the `mono` variant (system stacks only — a CLI can't install fonts). */
  readonly fontFamily: { readonly base: string; readonly mono: string };
  /** Multiplier map for the linear spacing curve (`step: 4`). */
  readonly spacing: Readonly<Record<string, number>>;
  /** Radius base + variants. */
  readonly radius: { readonly base: number; readonly variants: Readonly<Record<string, number | string>> };
  /** Suggested type ratio when the user takes the default. */
  readonly ratio: string;
}

const SYSTEM_SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const SYSTEM_MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
const SYSTEM_SERIF = "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif";

export const FEEL_PRESETS: Readonly<Record<Feel, FeelPreset>> = {
  neutral: {
    label: "Neutral",
    blurb: "system type, comfortable spacing, soft corners",
    fontFamily: { base: SYSTEM_SANS, mono: SYSTEM_MONO },
    spacing: { xs: 1, sm: 2, md: 4, lg: 6, xl: 8, "2xl": 12 },
    radius: { base: 8, variants: { none: 0, sm: 4, lg: 14, pill: "9999px" } },
    ratio: "major-third",
  },
  compact: {
    label: "Compact",
    blurb: "dense UI, tight scale, small radius",
    fontFamily: { base: SYSTEM_SANS, mono: SYSTEM_MONO },
    spacing: { xs: 1, sm: 2, md: 3, lg: 4, xl: 6, "2xl": 8 },
    radius: { base: 4, variants: { none: 0, sm: 2, lg: 8, pill: "9999px" } },
    ratio: "major-second",
  },
  editorial: {
    label: "Editorial",
    blurb: "serif display, spacious, generous leading",
    fontFamily: { base: SYSTEM_SERIF, mono: SYSTEM_MONO },
    spacing: { xs: 2, sm: 4, md: 6, lg: 8, xl: 12, "2xl": 16 },
    radius: { base: 2, variants: { none: 0, sm: 1, lg: 4, pill: "9999px" } },
    ratio: "perfect-fourth",
  },
  technical: {
    label: "Technical",
    blurb: "mono accents, compact, sharp corners",
    fontFamily: { base: SYSTEM_MONO, mono: SYSTEM_MONO },
    spacing: { xs: 1, sm: 2, md: 3, lg: 4, xl: 6, "2xl": 8 },
    radius: { base: 0, variants: { none: 0, sm: 0, lg: 2, pill: "9999px" } },
    ratio: "minor-third",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Answers
// ─────────────────────────────────────────────────────────────────────────────

export type BrandScheme = keyof typeof SCHEME_ROTATIONS;
export type ResetPreset = "preflight" | "normalize" | "none";
export type ContrastTarget = "AA" | "AAA" | "none";

export interface ScaffoldAnswers {
  /** The seed colour — any form `parseColor` accepts (hex, `rgb()`, `oklch()`). */
  readonly seed: string;
  /** `auto` derives colours 2…N by hue rotation; `manual` takes them verbatim from `extraColors`. */
  readonly mode?: "auto" | "manual";
  /** Total brand colours including the primary, 1–5. Default 2. */
  readonly brandCount?: number;
  /** Which rotation set to use. Ignored unless `mode: "auto"`; defaulted from `brandCount`. */
  readonly scheme?: BrandScheme;
  /** `mode: "manual"` — the colours after the primary, in order. */
  readonly extraColors?: readonly string[];
  /** Add success / info / warning / danger. Default true. */
  readonly semantics?: boolean;
  /** Add the neutral ramp. Default true. */
  readonly neutral?: boolean;
  /** Add shadow ink + alpha tints, and the effects ramp that references them. Default true. */
  readonly shadows?: boolean;
  /** Contrast bar for the text-on-base pass. Default `"AA"`; `"none"` skips the pass entirely. */
  readonly contrast?: ContrastTarget;
  /** Base font size in px. Default 16. */
  readonly baseFontSize?: number;
  /** Named type ratio. Defaults to the feel preset's suggestion. */
  readonly ratio?: string;
  /** Type family + density + corners, moved together. Default `"neutral"`. */
  readonly feel?: Feel;
  /** Which normalization layer `globals.preset` gets. Default `"preflight"`. */
  readonly reset?: ResetPreset;
}

/** What the contrast pass did to one palette — surfaced so the CLI can report it honestly. */
export interface ContrastAdjustment {
  readonly name: string;
  /** The colour before the pass. */
  readonly seed: string;
  /** The colour written to the file. */
  readonly final: string;
  /** OKLCH lightness points removed (0 when untouched). */
  readonly nudge: number;
  /** Ratio before, and after. */
  readonly ratioBefore: number;
  readonly ratioAfter: number;
  readonly levelAfter: WcagLevel;
  /** True when the pass ran out of room without reaching the bar. */
  readonly unresolved: boolean;
}

export interface ScaffoldReport {
  /** The seed's OKLCH lightness, 0–100. */
  readonly seedLightness: number;
  /** The ladder label the seed sits nearest — `base` stays canonical, this is orientation only. */
  readonly nearestStep: number;
  /** Brand palettes in order, with the hue rotation that produced each (0 for the primary/manual). */
  readonly brand: ReadonlyArray<{ readonly name: string; readonly hex: string; readonly rotation: number }>;
  /** Every palette the contrast pass looked at. Empty when `contrast: "none"`. */
  readonly contrast: readonly ContrastAdjustment[];
  /** Derived per-step leading and tracking, for the CLI's summary line. */
  readonly type: ReadonlyArray<{ readonly step: string; readonly px: number; readonly leading: number; readonly tracking: string }>;
  /** The resolved spacing ramp in px, for the CLI's summary line. */
  readonly spacing: ReadonlyArray<{ readonly step: string; readonly px: number }>;
}

export interface ScaffoldResult {
  readonly raw: RawTheme;
  readonly report: ScaffoldReport;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const round = (n: number, places: number): number => Number(n.toFixed(places));

/** Normalize any accepted colour input to a `#rrggbb` literal, so the written file is uniform. */
const toHex = (value: string): string => convertRgbToHex(parseColor(value).rgb);

/** Leading for a size, from the curve above. */
export const deriveLeading = (sizePx: number): number =>
  round(
    Math.min(LEADING_MAX, Math.max(LEADING_MIN, LEADING_AT_BASE * Math.pow(CURVE_ANCHOR_PX / sizePx, LEADING_EXPONENT))),
    2,
  );

/** Tracking (em) for a size, from the curve above. */
export const deriveTracking = (sizePx: number): string =>
  `${round(TRACKING_NUMERATOR / sizePx - TRACKING_OFFSET, 3)}em`;

/**
 * The ladder label a colour's lightness sits nearest. `base` stays the brand colour — this exists so
 * the CLI can tell you which stops are your hover and active shades without moving the hex you typed.
 */
export const nearestLadderStep = (lightness: number): number => {
  const label = 1000 - lightness * 10;
  let best = LADDER[0];
  for (const stop of LADDER) if (Math.abs(stop - label) < Math.abs(best - label)) best = stop;
  return best;
};

/** Which scheme a brand count implies when the caller doesn't name one. */
export const defaultSchemeFor = (brandCount: number): BrandScheme | undefined => {
  if (brandCount <= 1) return undefined;
  if (brandCount === 2) return "complement";
  if (brandCount === 3) return "triadic";
  if (brandCount === 4) return "tetradic";
  return "pentadic";
};

/** Schemes that produce exactly `brandCount − 1` members — the valid choices at that count. */
export const schemesFor = (brandCount: number): readonly BrandScheme[] =>
  (Object.keys(SCHEME_ROTATIONS) as BrandScheme[]).filter(
    (s) => SCHEME_ROTATIONS[s].length === brandCount - 1,
  );

/**
 * The contrast gate. Builds the palette set, audits every text-on-base pairing, and walks the
 * lightness of each failing colour down one OKLCH point at a time until it clears the bar.
 *
 * Iterative rather than closed-form because the ratio is not monotonic in a way worth inverting, and
 * because `audit` owns the thresholds — re-running it is how the generator stays honest about what
 * the library considers a pass.
 */
function applyContrastPass(
  palettes: ReadonlyArray<{ name: string; base: string; text: string }>,
  bar: Exclude<ContrastTarget, "none">,
): { palettes: Array<{ name: string; base: string; text: string }>; adjustments: ContrastAdjustment[] } {
  const current = palettes.map((p) => ({ ...p }));
  const nudges = new Map<string, number>(current.map((p) => [p.name, 0]));
  const firstRatio = new Map<string, number>();

  const scoreAll = (): Map<string, { ratio: number; level: WcagLevel; pass: boolean }> => {
    const colors: Record<string, unknown> = {};
    for (const p of current) colors[p.name] = { base: p.base, text: p.text };
    const theme = createTheme({ colors } as RawTheme, { adapter: createNoopAdapter() });
    const result = audit(theme, { minWcag: bar, includeRecipes: false });
    const out = new Map<string, { ratio: number; level: WcagLevel; pass: boolean }>();
    for (const pairing of result.pairings) {
      // A pairing whose fg/bg isn't a derivable colour is reported as `skipped` with no score. It
      // can't be nudged toward a bar it was never measured against, so leave it out entirely.
      if (pairing.skipped || pairing.wcagRatio === undefined) continue;
      const name = pairing.label.replace(/^colors\./, "");
      out.set(name, {
        ratio: pairing.wcagRatio,
        level: pairing.wcagLevel ?? "fail",
        pass: pairing.pass ?? false,
      });
    }
    return out;
  };

  let scores = scoreAll();
  for (const [name, s] of scores) if (!firstRatio.has(name)) firstRatio.set(name, s.ratio);

  for (let i = 0; i < MAX_CONTRAST_ITERATIONS; i++) {
    const failing = current.filter((p) => scores.get(p.name) && !scores.get(p.name)!.pass);
    if (!failing.length) break;
    for (const p of failing) {
      p.base = toHex(darken(p.base, 1));
      nudges.set(p.name, (nudges.get(p.name) ?? 0) + 1);
    }
    scores = scoreAll();
  }

  const adjustments: ContrastAdjustment[] = current.map((p, idx) => {
    const s = scores.get(p.name);
    return {
      name: p.name,
      seed: palettes[idx].base,
      final: p.base,
      nudge: nudges.get(p.name) ?? 0,
      ratioBefore: round(firstRatio.get(p.name) ?? 0, 2),
      ratioAfter: round(s?.ratio ?? 0, 2),
      levelAfter: s?.level ?? "fail",
      unresolved: !!s && !s.pass,
    };
  });

  return { palettes: current, adjustments };
}

// ─────────────────────────────────────────────────────────────────────────────
// The generator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a complete `RawTheme` from the interview answers. Pure — no filesystem, no prompting, no
 * randomness — so the same answers always produce the same theme.
 */
export function scaffoldTheme(answers: ScaffoldAnswers): ScaffoldResult {
  const mode = answers.mode ?? "auto";
  const feel = FEEL_PRESETS[answers.feel ?? "neutral"];
  const brandCount = Math.min(5, Math.max(1, answers.brandCount ?? 2));
  const baseFontSize = answers.baseFontSize ?? CURVE_ANCHOR_PX;
  const ratioName = answers.ratio ?? feel.ratio;
  const ratioValue = RATIO_VALUES[ratioName];
  if (!ratioValue) {
    throw new Error(`Unknown type ratio "${ratioName}". Use one of: ${Object.keys(RATIO_VALUES).join(", ")}.`);
  }

  // ── brand colours ──────────────────────────────────────────────────────────
  const seedHex = toHex(answers.seed);
  const brand: Array<{ name: string; hex: string; rotation: number }> = [
    { name: BRAND_NAMES[0], hex: seedHex, rotation: 0 },
  ];

  if (mode === "manual") {
    (answers.extraColors ?? []).slice(0, BRAND_NAMES.length - 1).forEach((c, i) => {
      brand.push({ name: BRAND_NAMES[i + 1], hex: toHex(c), rotation: 0 });
    });
  } else if (brandCount > 1) {
    const scheme = answers.scheme ?? defaultSchemeFor(brandCount)!;
    const rotations = SCHEME_ROTATIONS[scheme];
    if (!rotations) throw new Error(`Unknown harmony scheme "${scheme}".`);
    rotations.slice(0, brandCount - 1).forEach((deg, i) => {
      brand.push({ name: BRAND_NAMES[i + 1], hex: toHex(rotateHue(seedHex, deg)), rotation: deg });
    });
  }

  // ── the contrast gate ──────────────────────────────────────────────────────
  const contrastTarget = answers.contrast ?? "AA";
  const candidates: Array<{ name: string; base: string; text: string }> = [
    ...brand.map((b) => ({ name: b.name, base: b.hex, text: "#ffffff" })),
    ...(answers.semantics === false ? [] : SEMANTIC_ANCHORS.map(([n, base, text]) => ({ name: n, base, text }))),
    ...(answers.neutral === false ? [] : [{ name: "neutral", base: NEUTRAL_SEED, text: "#ffffff" }]),
  ];

  const { palettes, adjustments } =
    contrastTarget === "none"
      ? { palettes: candidates, adjustments: [] as ContrastAdjustment[] }
      : applyContrastPass(candidates, contrastTarget);

  // ── colors ─────────────────────────────────────────────────────────────────
  const colors: Record<string, unknown> = {};
  for (const p of palettes) colors[p.name] = { base: p.base, text: p.text, steps: [...LADDER] };
  if (answers.shadows !== false) {
    const variants: Record<string, unknown> = {};
    for (const a of SHADOW_ALPHAS) variants[`a${String(a).padStart(2, "0")}`] = { modifiers: [{ alpha: a }] };
    colors.shadow = { base: SHADOW_INK, variants };
  }

  // ── typography ─────────────────────────────────────────────────────────────
  // `fontSize` is a DECLARATION — the engine synthesizes xs…4xl from base + ratio. Leading and
  // tracking are baked, because the curves are this module's opinion, and they're named after the
  // size step they were tuned for so the pairing documents itself without a recipe.
  const sizes = TYPE_STEPS.map(([step, exp]) => ({ step, px: round(baseFontSize * Math.pow(ratioValue, exp), 2) }));
  const leading: Record<string, number> = {};
  const tracking: Record<string, string> = {};
  for (const { step, px } of sizes) {
    if (step === "md") continue; // md === base; the base value covers it
    leading[step] = deriveLeading(px);
    tracking[step] = deriveTracking(px);
  }
  tracking.caps = "0.06em"; // caps always want more air than the curve gives

  const typography = {
    fontFamily: { base: feel.fontFamily.base, variants: { mono: feel.fontFamily.mono } },
    fontWeight: { base: 400, variants: { medium: 500, semibold: 600, bold: 700 } },
    fontSize: { base: baseFontSize, ratio: ratioName },
    lineHeight: { base: deriveLeading(baseFontSize), variants: leading },
    letterSpacing: { base: "0em", variants: tracking },
  };

  // ── layout ─────────────────────────────────────────────────────────────────
  // The LINEAR curve, not the geometric one: `step: 4` keeps every stop on a 4px grid, where
  // `ratio: 1.5` would give 8·12·18·27·40.5·60.75. Geometric is right for type and wrong for space.
  const layout = { spacing: { base: 4, step: 4, steps: { ...feel.spacing } } };

  // ── borders · effects · animation · globals ────────────────────────────────
  const borders = {
    width: { base: 1, variants: { thick: 2 } },
    style: { base: "solid" },
    radius: { base: feel.radius.base, variants: { ...feel.radius.variants } },
  };

  const effects = answers.shadows === false
    ? undefined
    : {
        shadow: {
          offsetY: 1, blur: 3, color: "colors.shadow.a08",
          variants: {
            md: { offsetY: 6, blur: 16, color: "colors.shadow.a14" },
            lg: { offsetY: 14, blur: 34, color: "colors.shadow.a22" },
            none: "none",
          },
        },
      };

  // No `keyframes`: one would only pay off with a recipe to reference it, and the scaffold writes
  // no recipes — so generating one would ship dead CSS.
  const animation = {
    duration: { base: 200, variants: { fast: 120, slow: 400 } },
    easing: { base: "cubic-bezier(.2,.7,.3,1)", variants: { out: "cubic-bezier(.16,.84,.44,1)" } },
  };

  const raw = {
    colors,
    typography,
    layout,
    borders,
    ...(effects ? { effects } : {}),
    animation,
    ...(answers.reset === "none" ? {} : { globals: { preset: answers.reset ?? "preflight" } }),
  } as RawTheme;

  const seedLightness = round(rgbToOklch(parseColor(seedHex).rgb).L, 1);

  return {
    raw,
    report: {
      seedLightness,
      nearestStep: nearestLadderStep(seedLightness),
      brand: brand.map((b) => {
        const adjusted = adjustments.find((a) => a.name === b.name);
        return { name: b.name, hex: adjusted?.final ?? b.hex, rotation: b.rotation };
      }),
      contrast: adjustments,
      type: sizes.map(({ step, px }) => ({
        step, px, leading: deriveLeading(px), tracking: deriveTracking(px),
      })),
      spacing: Object.entries(feel.spacing).map(([step, mult]) => ({ step, px: mult * 4 })),
    },
  };
}
