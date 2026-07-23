import type {
  DerivationModifier,
  ExternalProperty,
  ModeOverride,
  NormalizedPropertyValue,
  RecipeBlock,
  ResponsiveOverride,
} from "../../core/normalize";
import type { AdjustDials, RGBTuple } from "./utils";

export type { AdjustDials } from "./utils";

/**
 * A colour's authored **base** value — a hex string (`"#4dabf7"` / `"#4af"`), an `[r, g, b]` tuple
 * (0–255), or any CSS colour string: `oklch()`, `hsl()/hsla()`, `rgb()/rgba()`, or a named keyword
 * (`"rebeccapurple"`). All are normalized to the canonical `rgb()` form at build (derivation runs in
 * OKLCH). A `var(--…)` is **rejected** — it can't be tonally derived at build time; borrow an external
 * token instead (`{ external: … }`). Tuple/keyword/function forms are coerced at normalize time.
 */
export type ColorInput = string | RGBTuple;

/**
 * A **derivation spec** variant (§13.3, §20.4, dec.2) — a named variant derived from a source colour
 * by an ordered `modifiers` chain of single-key `{ [fn]: args }` dials (`darken`/`lighten`/`alpha`/
 * `adjust`/`setL`/`rotateHue`): `value = modifiers.reduce((v, {fn,arg}) => fn(v, arg), resolve(ref))`.
 * `ref` names the source token (defaults to the property's own base; may point to another variant/step).
 * `darken`/`lighten` shift OKLCH lightness by N points (alpha preserved); `alpha` sets absolute opacity
 * (`{ alpha: 40 }` ⇒ 40% opaque); `adjust` places an absolute lightness and/or scales chroma and/or
 * rotates hue in one shot (see {@link AdjustDials}).
 */
export type PaletteDerivationSpec = { ref?: string; modifiers: DerivationModifier[] };

/**
 * A built-in colour-harmony scheme — rotations of the base's hue around the perceptual wheel, each
 * generated variant holding the base's lightness and chroma (only the hue turns).
 */
export type HarmonyScheme =
  | "complement"
  | "analogous"
  | "split-complement"
  | "triadic"
  | "tetradic";

/**
 * The palette-level `harmony` option (§20.5). The **string** form uses each scheme's default member
 * names (`"triadic"` → `triadic1` / `triadic2`); the **object** form renames them positionally
 * (`{ triadic: ["mint", "coral"] }` → `mint` / `coral`). Exactly one scheme per colour.
 */
export type HarmonyOption = HarmonyScheme | Partial<Record<HarmonyScheme, string[]>>;

/**
 * One authored variant value — a literal colour, a {@link PaletteDerivationSpec}, or the extended
 * `{ base, …extra }` form (for literal variants carrying siblings like `text`).
 */
export type PaletteVariantInput =
  | ColorInput
  | PaletteDerivationSpec
  | ({ base: ColorInput } & Record<string, unknown>);

/**
 * Colors' property extras — the palette-synthesis config that rides alongside a colour value.
 * `steps` is **numeric only** and defines an absolute OKLCH lightness ladder (§20.2): each
 * Tailwind-style label maps to a fixed lightness via `L = (1000 − label) / 10` (low = light, high =
 * dark), so the same label reads at the same lightness across every palette. Named tonal variants
 * (`light`/`lighter`/`dark`/`darker`) are auto-generated when no `steps` are declared; they stay
 * relative, compounding `lightenBy`/`darkenBy` as OKLCH ΔL points (which do NOT apply to numeric
 * steps). (`variants` is NOT here — it's a first-class key on {@link PaletteExtendedProperty},
 * widened to accept derivation specs.)
 */
export type PalettePropertyExtras = {
  text?: ColorInput;
  steps?: number[];
  lightenBy?: number;
  darkenBy?: number;
  harmony?: HarmonyOption;
};

/**
 * Colors' extended-property authoring shape — mirrors core's `ExtendedProperty` but with a
 * {@link ColorInput} base (hex string or `[r,g,b]` tuple) and a `variants` map widened to accept
 * {@link PaletteVariantInput} (literal colours, derivation specs, or extended literals). Coerced to
 * the canonical core shape (`base: string`) at normalize time.
 */
export type PaletteExtendedProperty = {
  base: ColorInput;
  responsive?: ResponsiveOverride<ColorInput, PalettePropertyExtras>[];
  variants?: Record<string, PaletteVariantInput>;
  modes?: ModeOverride<ColorInput, PalettePropertyExtras>[];
} & PalettePropertyExtras;

export type PalettePropertyValue = ColorInput | PaletteExtendedProperty | ExternalProperty;

export type NormalizedPaletteValue = NormalizedPropertyValue<string, PalettePropertyExtras>;

/**
 * The palette recipe declaration shape — colour-bearing CSS properties whose values
 * name a palette reference (`"primary"`, `"primary.text"`, `"neutral.light"`) or a
 * literal. Any additional style property is allowed (passed through as a literal).
 */
export type PaletteRecipeValue = string | number;

export type PaletteRecipeProps = {
  background?: PaletteRecipeValue;
  backgroundColor?: PaletteRecipeValue;
  color?: PaletteRecipeValue;
  borderColor?: PaletteRecipeValue;
  outlineColor?: PaletteRecipeValue;
  [property: string]: PaletteRecipeValue | undefined;
};

/**
 * The authored `raw.colors` slice (§8a). An **open** map: keys are arbitrary palette names
 * (`primary`, `neutral`, …), each a {@link PalettePropertyValue} — a bare hex/ref string, an
 * `[r,g,b]` tuple, or a full `ExtendedProperty` with `text` / `steps` / `variants` / `responsive`.
 * The reserved `recipes` key is a {@link RecipeBlock} of palette recipes. Authoring type only —
 * the spine still consumes the slice as `Record<string, unknown>`.
 */
export interface ColorsRaw {
  recipes?: RecipeBlock<PaletteRecipeProps>;
  [palette: string]: PalettePropertyValue | RecipeBlock<PaletteRecipeProps> | undefined;
}
