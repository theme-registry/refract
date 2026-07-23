/**
 * Interpreted-recipe shape consumed by the Model builders.
 *
 * A subsystem's `interpretRecipe` resolves each authored recipe declaration to a
 * format-neutral {@link Ref} — a token-path reference (`{ ref: "colors.primary" }`,
 * optionally carrying the resolved literal in `value`) or a plain literal
 * (`{ value: "12px 20px" }`). It emits refs **directly**; the Model builder no longer
 * string-parses `var(--…)` back into refs (that coupling is gone). Serialization to a
 * concrete format (the `var(--…)` string, an `$…`, an inlined value) is the adapter's
 * job (step 1).
 *
 * The two condition axes (state / breakpoint …) are kept **separate** from the
 * declarations, so an override is `{ …condition, declarations }` — no flat object
 * mixing string condition keys with declaration refs.
 */
import type { Ref } from "./model";

/** A recipe variant's declarations after interpretation — property → resolved {@link Ref}. */
export type RecipeDeclarations = Record<string, Ref>;

/** One interpreted override: its condition (state and/or breakpoint …) + declaration refs. */
export type InterpretedRecipeOverride<TBreakpoint extends string> = {
  /** Present for breakpoint-conditioned overrides; absent for pure-state / container overrides. */
  breakpoint?: TBreakpoint;
  query?: "min" | "max" | "exact";
  state?: string;
  variant?: string;
  target?: string;
  orientation?: "landscape" | "portrait";
  /** Container-query axis (§10.5): the named container + its size-name (in place of `breakpoint`). */
  container?: string;
  size?: string;
  declarations: RecipeDeclarations;
};

export type InterpretedRecipeVariant<TBreakpoint extends string> = {
  base: RecipeDeclarations;
  responsive: InterpretedRecipeOverride<TBreakpoint>[];
};

export type InterpretedRecipeGroup<TBreakpoint extends string> = Record<
  string,
  InterpretedRecipeVariant<TBreakpoint>
>;
