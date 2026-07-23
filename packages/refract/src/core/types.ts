/**
 * Free-standing theme-surface data types. Adapters expose render *methods*; the
 * only plain data structures the surface needs are the recipe-name map and the
 * (deferred) self-contained lazy-recipe shape.
 */

/**
 * Recipe names for one subsystem: group → variant → identity string.
 * `createTheme` builds it by looping the Model and calling `adapter.recipeName`
 * (not an adapter method itself). Surfaced per subsystem, e.g. `theme.colors.classes`.
 */
export type NameMap = Record<string, Record<string, string>>;

/**
 * The self-contained result of lazily rendering one recipe: the rule PLUS the
 * variables it needs, kept SEPARATE and addressable so a delivery layer can dedup.
 *
 * Both halves are `{ identity, render }` — the delivery layer dedups variables by
 * `path` (and recipes by `name` if the same recipe appears twice), then inserts.
 * Produced by the core helper `renderRecipeStandalone`, composed from `recipeRefs`
 * (core) + `renderToken` (adapter) + `renderRecipe` (adapter). Not produced yet —
 * the lazy per-recipe delivery path is deferred.
 */
export interface RecipeStandalone<TUnit = string> {
  readonly recipe: { readonly name: string; readonly render: TUnit };
  readonly variables: ReadonlyArray<{ readonly path: string; readonly render: TUnit }>;
}
