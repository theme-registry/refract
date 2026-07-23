import type { PropertyValue, RecipeBlock } from "../../core/normalize";

/**
 * Typography's fontSize-scale config. Only the normalize-relevant subset is ported
 * for Step 0b (the recipe / token / source types grow in Step 2).
 */

export type TypographyScaleKey =
  | "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "4xl";

export type TypographyRatioKey =
  | "minor-second" | "major-second" | "minor-third" | "major-third"
  | "perfect-fourth" | "augmented-fourth" | "perfect-fifth" | "golden";

export type FontSizeExtras = {
  ratio?: TypographyRatioKey;
  precision?: number;
  unit?: "px" | "rem";
  baseFontSize?: number;
  algorithm?: (base: number, key: string, step: number, prev: number | null) => number;
};

export type FontSizeValue = PropertyValue<number, FontSizeExtras>;

/**
 * A typography recipe declaration block. Each value names a **variant** of the
 * matching typography property (`fontSize: "3xl"`, `fontWeight: "bold"`, `fontSize: "base"`
 * for the base value) — the interpreter maps it to a token-path {@link import("../../core/model").Ref}.
 * Only the keys in the property map are lowered; unknown keys are ignored.
 */
export type TypographyRecipeProps = {
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: string;
  lineHeight?: string;
  letterSpacing?: string;
  fontStyle?: string;
  textTransform?: string;
  textDecoration?: string;
  textAlign?: string;
  [property: string]: string | undefined;
};

/**
 * A typography property value (§8a). Typography properties are heterogeneous —
 * `fontFamily` is a string, `fontSize`/`fontWeight`/`lineHeight` numbers, `letterSpacing`
 * a string — so the value unions `string | number`; the fontSize modular-scale extras
 * (`ratio`/`precision`/…) ride along on every key (all optional, harmless elsewhere).
 */
export type TypographyPropertyValue = PropertyValue<string | number, FontSizeExtras>;

/**
 * The authored `raw.typography` slice (§8a). An **open** map: keys are typography property
 * names (`fontFamily`, `fontSize`, …), each a {@link TypographyPropertyValue}; the reserved
 * `recipes` key is a {@link RecipeBlock} of typography recipes. Authoring type only.
 */
export interface TypographyRaw {
  recipes?: RecipeBlock<TypographyRecipeProps>;
  [property: string]: TypographyPropertyValue | RecipeBlock<TypographyRecipeProps> | undefined;
}
