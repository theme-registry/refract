import type { PropertyValue, RecipeBlock } from "../../core/normalize";

/**
 * Borders' property + recipe types (§14). A dedicated **stroke** subsystem carved out of the
 * effects grab-bag: border + outline share one geometry vocabulary (width / style / offset /
 * radius), diverging only at the render target (the recipe-level `as` verb). Color is NEVER a
 * borders token — a borders recipe carries a value-level `colors.*` ref instead (§14.4).
 */

// --- Property values (geometry only) ---

/** border-width / outline-width (px; number, variants). */
export type BorderWidthValue = PropertyValue<number>;
/** border-style / outline-style (`solid` / `dashed` / … + `auto` for outlines). */
export type BorderStyleValue = PropertyValue<string>;
/** outline-offset (px; only meaningful under `as: "outline"`). */
export type BorderOffsetValue = PropertyValue<number>;
/** border-radius (px; **moved in from effects** — edge geometry, §14.1). `9999px`-style strings allowed. */
export type BorderRadiusValue = PropertyValue<number | string>;

/**
 * A borders recipe declaration block (§14.2). `as` + `side` are **modifiers**, not aspect
 * declarations: the interpreter computes each CSS property from `(as, side, aspect)` — `border`+
 * `left`+`width` → `border-left-width`, `outline`+`offset` → `outline-offset`. The geometry
 * aspects (`width`/`style`/`offset`/`radius`) name a **variant** of the matching borders property
 * by bare name (`"thick"` → `borders.width.thick`); `color` is the value-level `colors.*` ref.
 */
export type BordersRecipeProps = {
  /** Render target — `"border"` (default) or `"outline"`. Routes every aspect to its longhand. */
  as?: "border" | "outline";
  /** Per-side modifier (border only) — routes to `border-<side>-{width,style,color}`. */
  side?: "top" | "right" | "bottom" | "left";
  width?: string;
  style?: string;
  offset?: string;
  radius?: string;
  /** Value-level color ref — a `colors.*` **token** path (`"colors.primary"`), never a borders token. */
  color?: string;
  [property: string]: string | undefined;
};

/**
 * A borders property value (§8a / §14). Borders geometry spans numbers and strings
 * (`width`/`offset` numbers, `radius` `number | string`, `style` strings), so the value unions
 * `string | number`.
 */
export type BordersPropertyValue = PropertyValue<string | number>;

/**
 * The authored `raw.borders` slice (§8a / §14). An **open** map: keys are borders property names
 * (`width`, `style`, `offset`, `radius`), each a {@link BordersPropertyValue}; the reserved
 * `recipes` key is a {@link RecipeBlock} of borders recipes. Authoring type only.
 */
export interface BordersRaw {
  recipes?: RecipeBlock<BordersRecipeProps>;
  [property: string]: BordersPropertyValue | RecipeBlock<BordersRecipeProps> | undefined;
}
