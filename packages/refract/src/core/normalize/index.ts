/**
 * Shared normalize primitives + the normalize-layer vocabulary (Step 0b).
 *
 * Pure, format-neutral: raw theme config to normalized property / recipe shapes,
 * validating breakpoint / variant / target / state references along the way.
 * Subsystem normalizeProperty hooks (colors steps, typography scale, layout none)
 * live under src/next/subsystems/-star-/normalize.ts and layer on top.
 */

export * from "./types";
export { normalizePropertyValue } from "./properties";
export {
  DEFAULT_RESPONSIVE_QUERY,
  normalizeResponsiveOverrides,
  validateNormalizedResponsiveRefs,
} from "./responsive";
export { normalizeRecipeGroup } from "./recipes";
export type { RecipeNormalizationOptions } from "./recipes";
export { createRecipeVariantResolver } from "./recipeResolver";
export type {
  RecipeInterpreter,
  RecipeVariantResolver,
  CreateRecipeVariantResolverOptions,
} from "./recipeResolver";
