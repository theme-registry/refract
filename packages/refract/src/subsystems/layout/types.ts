/**
 * Layout subsystem types (clean-room).
 *
 * Regular property keys (`spacing` / `gutters` / `aspectRatio`) normalize like any other
 * subsystem; the structural keys (`columns` / `grids` / `stacks` / `container`) drive the
 * structural generators (see `structural.ts`); `recipes` are ordinary token-path recipes.
 */

import type { PropertyValue, RecipeBlock } from "../../core/normalize";

export type ResponsiveQuery = "min" | "max" | "exact";

/** The whitelisted "regular" layout property keys (the ones that become `PropertyModel`s). */
export const LAYOUT_PROPERTY_KEYS: readonly string[] = ["spacing", "gutters", "aspectRatio", "sizes"];

/**
 * Scale-synthesis authoring keys (§10.6) for a length scale (`spacing`/`gutters`/`sizes`). Declare
 * one curve — `ratio` (geometric `base × ratio^n`, `steps` an ordered name array) or `step` (linear
 * `step × n`, `steps` a name→multiplier map) — to synthesize the variant ramp instead of hand-listing
 * it. Opt-in: absent both, the property behaves exactly as before. The same keys inside a `responsive`
 * entry regenerate the whole named scale at that breakpoint (D6). Authored `variants` still win.
 */
export type LayoutScaleExtras = {
  ratio?: number;
  step?: number;
  steps?: readonly string[] | Record<string, number>;
};

// --- Columns ---

export type ColumnsConfig = { size: number; gutter?: string; inset?: string };
export type ColumnsValue = number | ColumnsConfig;

// --- Grids ---

export type GridDefinition = {
  templateColumns?: string;
  templateRows?: string;
  autoRows?: string;
  autoColumns?: string;
  justifyItems?: string;
  alignItems?: string;
  justifyContent?: string;
  alignContent?: string;
  gap?: string;
  responsive?: Array<{
    breakpoint: string;
    query?: ResponsiveQuery;
    templateColumns?: string;
    templateRows?: string;
    autoRows?: string;
    autoColumns?: string;
    justifyItems?: string;
    alignItems?: string;
    justifyContent?: string;
    alignContent?: string;
    gap?: string;
  }>;
};
export type GridsDefinition = Record<string, GridDefinition>;

// --- Stacks ---

export type StackDefinition = {
  direction?: "row" | "column";
  align?: string;
  justify?: string;
  wrap?: string;
  inline?: boolean;
  gap?: string;
  responsive?: Array<{
    breakpoint: string;
    query?: ResponsiveQuery;
    direction?: "row" | "column";
    align?: string;
    justify?: string;
    wrap?: string;
    inline?: boolean;
  }>;
};
export type StacksDefinition = Record<string, StackDefinition>;

// --- Container ---

export type ContainerConfig = {
  /** The resolved mode: `"fixed"` / `"fluid"` / a custom width string. */
  mode: string;
  inset?: string;
  gutter?: string;
  direction?: string;
  align?: string;
  justify?: string;
  maxWidth?: string | number;
};

// --- Container (authored) ---

/**
 * One authored container variant (§8a) — a mode string (`"fixed"` / `"fluid"` / a width) or a
 * config object. Distinct from {@link ContainerConfig}, which is the resolved `{ mode }` shape the
 * structural generator produces.
 */
export type ContainerVariantRaw =
  | string
  | {
      base?: string;
      inset?: string;
      gutter?: string;
      direction?: string;
      align?: string;
      justify?: string;
      maxWidth?: string | number;
    };

/** The authored `layout.container` value (§8a) — a mode string or a config with variants/responsive. */
export type ContainerRaw =
  | string
  | {
      base?: string;
      inset?: string;
      gutter?: string;
      direction?: string;
      align?: string;
      justify?: string;
      maxWidth?: string | number;
      variants?: Record<string, ContainerVariantRaw>;
      responsive?: Array<{
        breakpoint: string;
        query?: ResponsiveQuery;
        target?: string;
        direction?: string;
        align?: string;
        justify?: string;
        inset?: string;
        gutter?: string;
      }>;
    };

// --- Recipes ---

export type LayoutRecipeProps = {
  paddingY?: string;
  paddingX?: string;
  marginY?: string;
  marginX?: string;
  gap?: string;
  background?: string;
  /**
   * Sizing verbs (§22) — each names a `layout.sizes` variant and routes to its CSS longhand
   * (`maxWidth` → `max-width`, no fan-out). A verb exists because it consumes a themed scale (`sizes`);
   * dimensional CSS with no scale (`display`, `position`, …) stays in a component `css` delta.
   */
  width?: string;
  minWidth?: string;
  maxWidth?: string;
  height?: string;
  minHeight?: string;
  maxHeight?: string;
  [property: string]: string | undefined;
};

/**
 * The authored `raw.layout` slice (§8a). The only **closed** subsystem — its keys are fixed:
 * the regular property tokens (`spacing`/`gutters`/`aspectRatio`), the four structural generators
 * (`columns`/`grids`/`stacks`/`container`), and the `recipes` block. Authoring type only.
 */
export interface LayoutRaw {
  spacing?: PropertyValue<string | number, LayoutScaleExtras>;
  gutters?: PropertyValue<string | number, LayoutScaleExtras>;
  aspectRatio?: PropertyValue<string | number>;
  /** The sizing scale (§22) — one length scale for width/height/min/max, chosen at the recipe verb. */
  sizes?: PropertyValue<string | number, LayoutScaleExtras>;
  columns?: ColumnsValue;
  grids?: GridsDefinition;
  stacks?: StacksDefinition;
  container?: ContainerRaw;
  recipes?: RecipeBlock<LayoutRecipeProps>;
}
