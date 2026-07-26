/**
 * The `refract create` interview (Node-only) — the question flow, separated from both CLIs that run it.
 *
 * `refract create` asks it to write a theme into an existing project; `create-refract-theme` asks it
 * while scaffolding a whole new package. Two entry points, one script of questions — because an
 * interview duplicated across two packages is an interview that drifts.
 *
 * Every answer can be supplied up front (a flag, or a caller's default), and every prompt is
 * non-interactive-safe, so the same function serves a human at a terminal and a scripted run.
 */
import type { Prompter } from "./prompt";
import { dim, green, swatch, yellow } from "./prompt";
import {
  FEEL_PRESETS,
  defaultSchemeFor,
  nearestLadderStep,
  schemesFor,
  type BrandScheme,
  type ContrastTarget,
  type Feel,
  type ResetPreset,
  type ScaffoldAnswers,
} from "./scaffold";
import type { CreateResult, RawFormat } from "./createCommand";
import { convertRgbToHex, parseColor, rgbToOklch, rotateHue } from "../subsystems/colors/utils";

/**
 * The hues a scheme derives from a seed — the same rotations the generator will bake, so the
 * preview beside each option is the palette you'd actually get, not an illustration.
 */
const SCHEME_ROTATIONS: Readonly<Record<string, readonly number[]>> = {
  complement: [180],
  analogous: [-30, 30],
  "split-complement": [150, 210],
  triadic: [120, 240],
  tetradic: [90, 180, 270],
  pentadic: [72, 144, 216, 288],
};

const schemeHues = (seedHex: string, scheme: string): string[] =>
  (SCHEME_ROTATIONS[scheme] ?? []).map(deg => convertRgbToHex(parseColor(rotateHue(seedHex, deg)).rgb));

/** What each harmony scheme is for, in one line — the names mean nothing to most people. */
export const SCHEME_HINTS: Readonly<Record<string, string>> = {
  complement: "one companion, 180° opposite — maximum separation",
  analogous: "two neighbours, ±30° — quiet and cohesive",
  "split-complement": "the complement's neighbours — contrast with less tension",
  triadic: "even thirds, ±120° — three colours of equal weight",
  tetradic: "two complementary pairs — the most range",
  pentadic: "five evenly spaced hues — needs a dominant colour picked by hand",
};

/**
 * Ratio choices, tightest to most dramatic, each showing the ladder it produces from 16px. The ratio
 * is the most consequential typographic choice in the theme and its name carries no information, so
 * the numbers do the explaining.
 */
export const TYPE_SCALE_CHOICES: ReadonlyArray<readonly [string, string]> = [
  ["major-second", "1.125 · 16 · 18 · 20 · 23 · 26 · 29"],
  ["minor-third", "1.2 · 16 · 19 · 23 · 28 · 33 · 40"],
  ["major-third", "1.25 · 16 · 20 · 25 · 31 · 39 · 49"],
  ["perfect-fourth", "1.333 · 16 · 21 · 28 · 38 · 51 · 67"],
  ["perfect-fifth", "1.5 · 16 · 24 · 36 · 54 · 81 · 122"],
  ["golden", "1.618 · 16 · 26 · 42 · 68 · 110 · 178"],
];

/** Answers a caller already has — from CLI flags, or a host tool's own defaults. */
export interface InterviewGiven {
  readonly seed?: string;
  /** Brand count in auto mode, or a comma-separated colour list in manual mode. */
  readonly colors?: string;
  readonly scheme?: string;
  readonly manual?: boolean;
  readonly feel?: string;
  readonly ratio?: string;
  readonly baseSize?: string | number;
  readonly contrast?: string;
  readonly reset?: string;
  readonly format?: string;
  readonly noSemantics?: boolean;
  readonly noNeutral?: boolean;
  readonly noShadows?: boolean;
}

/** The fully-resolved answer set, ready for `runCreate`. */
export type InterviewAnswers = ScaffoldAnswers & { readonly format: RawFormat };

const isColor = (v: string): string | undefined => {
  try {
    parseColor(v);
    return undefined;
  } catch {
    return `"${v}" isn't a colour refract can parse. Try a hex like #4c6ef5.`;
  }
};

/**
 * Run the interview. Anything present in `given` is taken as answered and never asked.
 *
 * The scheme question only appears when the brand count admits more than one rotation set — which is
 * only at three colours. Two is a complement, four a tetradic, five a pentadic: asking would be a
 * prompt with a single option.
 */
export async function promptCreateAnswers(p: Prompter, given: InterviewGiven = {}): Promise<InterviewAnswers> {
  const seed = given.seed ?? (await p.text("Primary colour", "#4c6ef5", isColor));
  const lightness = Math.round(rgbToOklch(parseColor(seed).rgb).L * 10) / 10;
  const seedHex = convertRgbToHex(parseColor(seed).rgb);
  const chip = swatch(seedHex, 3);
  p.write(
    `  ${chip ? `${chip} ` : ""}${dim(`${seedHex} · lightness ${lightness}% — lands at ≈${nearestLadderStep(lightness)} on the ladder`)}`,
  );
  p.write();

  const manual = Boolean(given.manual);
  let brandCount = 2;
  let scheme: BrandScheme | undefined;
  let extraColors: string[] = [];

  if (manual) {
    extraColors = (given.colors ?? "").split(",").map(s => s.trim()).filter(Boolean);
    if (!extraColors.length && p.interactive) {
      const total = await p.number("How many brand colours in total?", 2, n =>
        Number.isInteger(n) && n >= 1 && n <= 5 ? undefined : "Pick a whole number from 1 to 5.");
      for (let i = 1; i < total; i++) {
        extraColors.push(await p.text(`Brand colour ${i + 1}`, "#e64980", isColor));
      }
    }
    brandCount = extraColors.length + 1;
  } else {
    brandCount = given.colors
      ? Number(given.colors)
      : await p.number("How many brand colours? (including the primary)", 2, n =>
          Number.isInteger(n) && n >= 1 && n <= 5 ? undefined : "Pick a whole number from 1 to 5.");
    const options = schemesFor(brandCount);
    scheme = (given.scheme as BrandScheme | undefined) ?? defaultSchemeFor(brandCount);
    if (!given.scheme && options.length > 1) {
      // Show the hues each scheme actually produces. "split-complement" is a word; two blocks of
      // real colour beside the seed is the thing you're choosing between.
      scheme = await p.select<BrandScheme>(
        "Harmony scheme",
        options.map(s => ({
          value: s,
          label: s,
          hint: SCHEME_HINTS[s],
          swatches: [seedHex, ...schemeHues(seedHex, s)],
        })),
        Math.max(0, options.indexOf(scheme as BrandScheme)),
      );
    }
    if (scheme && brandCount > 1) {
      p.write(`  ${dim(`→ ${scheme} · each member becomes its own palette with a full ladder`)}`);
      p.write();
    }
  }

  const anyExtraFlag = given.noSemantics || given.noNeutral || given.noShadows;
  const extras = anyExtraFlag || !p.interactive
    ? { semantics: !given.noSemantics, neutral: !given.noNeutral, shadows: !given.noShadows }
    : await (async () => {
        const picked = await p.multiselect<"semantics" | "neutral" | "shadows">(
          "Also add",
          [
            { value: "semantics", label: "Semantic colours", hint: "success · info · warning · danger" },
            { value: "neutral", label: "Neutral ramp", hint: "50 … 900" },
            { value: "shadows", label: "Shadow tints", hint: "3 alpha levels + the effects ramp" },
          ],
          [0, 1, 2],
        );
        return {
          semantics: picked.includes("semantics"),
          neutral: picked.includes("neutral"),
          shadows: picked.includes("shadows"),
        };
      })();

  const contrast = (given.contrast as ContrastTarget | undefined) ?? await p.select<ContrastTarget>(
    "Contrast target",
    [
      { value: "AA", label: "WCAG AA", hint: "4.5:1 body text" },
      { value: "AAA", label: "WCAG AAA", hint: "7:1 — expect heavier nudges" },
      { value: "none", label: "Skip", hint: "write the colours exactly as given" },
    ],
  );

  const baseFontSize = given.baseSize !== undefined
    ? Number(given.baseSize)
    : await p.number("Base font size (px)", 16, n => (n > 0 ? undefined : "Must be greater than zero."));

  const feel = (given.feel as Feel | undefined) ?? await p.select<Feel>(
    "Overall feel",
    (Object.keys(FEEL_PRESETS) as Feel[]).map(k => ({
      value: k, label: FEEL_PRESETS[k].label, hint: FEEL_PRESETS[k].blurb,
    })),
  );

  const ratio = given.ratio ?? await p.select<string>(
    "Type scale",
    TYPE_SCALE_CHOICES.map(([value, hint]) => ({ value, label: value, hint })),
    Math.max(0, TYPE_SCALE_CHOICES.findIndex(([v]) => v === FEEL_PRESETS[feel].ratio)),
  );

  const reset = (given.reset as ResetPreset | undefined) ?? await p.select<ResetPreset>(
    "CSS reset",
    [
      { value: "preflight", label: "preflight", hint: "full normalization + an h1–h6 size map" },
      { value: "normalize", label: "normalize", hint: "the classic, no heading map" },
      { value: "none", label: "none", hint: "you already ship one" },
    ],
  );

  const format = (given.format as RawFormat | undefined) ?? await p.select<RawFormat>(
    "Format",
    [
      { value: "ts", label: "theme.raw.ts", hint: "typed, `satisfies RawTheme`" },
      { value: "js", label: "theme.raw.js", hint: "plain ESM, no build step" },
      { value: "json", label: "theme.raw.json", hint: "portable, no code at all" },
    ],
  );

  return {
    seed, mode: manual ? "manual" : "auto", brandCount, scheme, extraColors,
    ...extras, contrast, baseFontSize, ratio, feel, reset, format,
  };
}

/**
 * The post-generation summary: what the contrast pass did, and what landed. Returned as lines rather
 * than printed so each host can frame them — the standalone command and the project scaffolder put
 * different things around the same facts.
 */
export function createReportLines(result: CreateResult, variableCount: number): string[] {
  const lines: string[] = [];
  const { contrast } = result.report;
  if (contrast.length) {
    lines.push(`  ${dim(`Contrast · ${contrast.length} pairings checked`)}`);
    for (const c of contrast) {
      const shift = c.nudge > 0
        ? `${yellow(`−${c.nudge}`)} ${green(`${c.ratioAfter} ${c.levelAfter}`)}`
        : dim("unchanged");
      const flag = c.unresolved ? ` ${yellow("! still short of the bar")}` : "";
      lines.push(`    ${c.name.padEnd(10)} ${String(c.ratioBefore).padStart(5)}  ${shift}${flag}`);
    }
    lines.push("");
  }
  const nudged = contrast.filter(c => c.nudge > 0).length;
  lines.push(`  ${dim(`${result.sections.length} subsystems · ${variableCount} variables · 0 recipes`)}`);
  if (nudged) lines.push(`  ${dim(`${nudged} colour${nudged === 1 ? "" : "s"} darkened to clear the contrast bar`)}`);
  return lines;
}
