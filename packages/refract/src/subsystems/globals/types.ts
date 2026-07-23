/**
 * The globals subsystem's authoring types (§9).
 *
 * `globals` owns the bare-element layer: a **preset** (opinionated static normalization + a default
 * `h1`–`h6` map bound to the type scale) plus **themed element rules** (`elements`) bound to raw
 * selectors. An element rule is a recipe *item* (declarations + `states` / `responsive` / `variants`),
 * not a two-level recipe group — the selector IS the leaf. Authoring type only; the subsystem lowers
 * it to Model rule-sets (`kind:"reset"` for the preset layer, `kind:"globals"` for elements) that each
 * web adapter renders.
 */

import type { RecipeVariantDefinition, GlobalsElementVariantModifier } from "../../core/normalize";

/** The built-in normalization preset names. `false` disables the static + default layers (elements only). */
export type GlobalsPreset = "preflight" | "normalize" | "reset" | false;

/**
 * One themed-element declaration value (§9) — components' `CssDeltaValue`, minus cross-subsystem
 * composition refs. **Literal-first**: a bare `string` is a raw CSS value (`textDecoration: "underline"`),
 * a `number` is a literal, and a token **reference** uses `ref("colors.link")` or the JSON-safe object
 * form `{ ref: "colors.link" }` → `var(--…)`. Flat leaves bound to a selector, never the class-list
 * composition of `components`.
 */
export type GlobalsDeclValue = string | number | { ref: string };

/** The flat declaration map a globals element instantiates the recipe-item shape's `TProps` with. */
export type GlobalsDeclarations = Record<string, GlobalsDeclValue>;

/**
 * One themed element rule (§9) — the recipe-item shape ({@link RecipeVariantDefinition}) instantiated
 * with flat globals leaves: base declarations plus the three condition axes `states` / `responsive` /
 * `variants`. There is **no `modes` axis** — light/dark rides the referenced token's own modes. Each
 * `variants` entry is a delta-only modifier the adapters render as a higher-specificity variant of the
 * element (CSS `a.subtle`, styled-components / SCSS nested `&.subtle`).
 */
export type GlobalsElement = RecipeVariantDefinition<
  GlobalsDeclarations,
  string,
  // §9 exception to dec.7 — a globals element variant keeps its nested `states`/`responsive`.
  GlobalsElementVariantModifier<GlobalsDeclarations, string>
>;

/**
 * The authored `rawTheme.globals` slice (§9).
 *
 * - `preset` — the normalization base (`"preflight" | "normalize" | "reset" | false`). The key is
 *   `preset` (not `reset`) because a `reset: "reset"` collides with the `"reset"` value. There is **no
 *   bare-string shorthand** — the one form is `globals: { preset }`. The preset expands the static
 *   layer (+ a default `h1`–`h6` heading map for `preflight` / `reset`); it must be explicit for those
 *   layers to emit, so a bare `{ elements }` (no `preset` key) emits only the themed element rules and
 *   an `override({ globals: { elements } })` inherits the parent's preset.
 * - `elements` — selector → themed element rule.
 */
export interface GlobalsRaw {
  preset?: GlobalsPreset;
  elements?: Record<string, GlobalsElement>;
}
