/**
 * Typography's `normalizeProperty` hook — modular font-size scale synthesis.
 *
 * When `fontSize` is authored with a `ratio`, this generates the scale steps
 * (`xs`…`4xl`) as variants — each `base * ratio^step` (or a custom `algorithm`),
 * rounded to `precision`. Author-declared steps are preserved and seed the chain.
 * Non-`fontSize` properties and ratio-less `fontSize` pass through untouched.
 */

import type { NormalizedPropertyValue, NormalizedVariantValue } from "../../core/normalize";
import type { FontSizeExtras, TypographyRatioKey, TypographyScaleKey } from "./types";

const TYPOGRAPHY_RATIOS: Record<TypographyRatioKey, number> = {
  "minor-second": 1.067,
  "major-second": 1.125,
  "minor-third": 1.2,
  "major-third": 1.25,
  "perfect-fourth": 1.333,
  "augmented-fourth": 1.414,
  "perfect-fifth": 1.5,
  golden: 1.618,
};

const DEFAULT_SCALE_STEPS: Record<TypographyScaleKey, number> = {
  xs: -2,
  sm: -1,
  md: 0,
  lg: 1,
  xl: 2,
  "2xl": 3,
  "3xl": 4,
  "4xl": 5,
};

const DEFAULT_PRECISION = 4;

type FontSizeVariant = NormalizedVariantValue<number, FontSizeExtras>;

/**
 * The typography `normalizeProperty` hook. Synthesizes the modular scale for
 * `fontSize`; a pass-through for every other typography property.
 *
 * @param propertyKey The property being normalized (only `"fontSize"` is transformed).
 * @param normalized  The property after the shared property normalize pass.
 */
export const finalizeTypographyNormalization = (
  propertyKey: string,
  normalized: NormalizedPropertyValue<unknown>,
): NormalizedPropertyValue<unknown> => {
  if (propertyKey !== "fontSize") return normalized;
  return generateFontSizeScaleVariants(
    normalized as unknown as NormalizedPropertyValue<number, FontSizeExtras>,
  ) as unknown as NormalizedPropertyValue<unknown>;
};

/**
 * Build the `xs`…`4xl` scale variants from `base`, `ratio`, and `precision`.
 * Returns the input unchanged when there is no (recognized) `ratio`.
 */
const generateFontSizeScaleVariants = (
  normalized: NormalizedPropertyValue<number, FontSizeExtras>,
): NormalizedPropertyValue<number, FontSizeExtras> => {
  const ratio = normalized.ratio;
  if (!ratio) return normalized;

  const ratioValue = TYPOGRAPHY_RATIOS[ratio];
  if (!ratioValue) return normalized;

  const baseFontSize = normalized.baseFontSize ?? normalized.base;
  const precision = normalized.precision ?? DEFAULT_PRECISION;
  const algorithm = normalized.algorithm;
  const existingVariants = normalized.variants ?? {};
  const generated: Record<string, FontSizeVariant> = {};

  let previousValue: number | null = null;

  for (const [key, step] of Object.entries(DEFAULT_SCALE_STEPS) as [TypographyScaleKey, number][]) {
    if (existingVariants[key]) {
      previousValue = existingVariants[key].base ?? null;
      continue;
    }

    let value: number;
    if (algorithm) {
      value = algorithm(baseFontSize, key, step, previousValue);
    } else {
      value = baseFontSize * Math.pow(ratioValue, step);
    }

    const rounded = Number(value.toFixed(precision));
    previousValue = rounded;
    generated[key] = { base: rounded } as FontSizeVariant;
  }

  return {
    ...normalized,
    variants: {
      ...generated,
      ...existingVariants,
    },
  };
};
