/**
 * Components (composition) subsystem types.
 *
 * A component recipe variant references other subsystems' recipes (`colors: "solid.primary"`,
 * `layout: "padding.button-lg"`, …) and may add its own `css` delta (+ grouped `states` /
 * `responsive`). It owns **no primitive properties** — the property pipeline never runs for it.
 */

import type { RecipeBlock } from "../../core/normalize";

/**
 * One value in a component `css` delta. **Literal-first**: a bare `string` is a raw CSS value
 * (`display: "flex"`), a `number` is a literal, and a token **reference** uses `ref("colors.on-primary")`
 * (the {@link ref} helper) or the JSON-safe object form `{ ref: "colors.on-primary" }` → `var(--…)`.
 * (This differs from the sibling composition fields — `colors: "solid.primary"` — where a bare string is
 * always a reference: those compose tokens, the `css` block is raw CSS.)
 */
export type CssDeltaValue = string | number | { ref: string };

/** One component recipe variant: cross-subsystem references + an own `css` delta. */
export type ComponentsRecipeProps = {
  colors?: string;
  typography?: string;
  layout?: string;
  effects?: string;
  borders?: string;
  css?: Record<string, CssDeltaValue>;
  [subsystem: string]: string | Record<string, CssDeltaValue> | undefined;
};

/**
 * The authored `raw.components` slice (§8a). **Closed** and recipes-only — components own no
 * primitive properties (the property pipeline never runs); they contribute only composition
 * recipes referencing other subsystems' recipes plus an own `css` delta. Authoring type only.
 */
export interface ComponentsRaw {
  recipes?: RecipeBlock<ComponentsRecipeProps>;
}

/**
 * The resolved class surface for one component variant — the referenced recipe classes (which
 * carry their own `:hover` etc. on the shared class) followed by the component's own delta class.
 * `className` is the space-joined list. Mirrors the OLD `ResolvedComponentClass` shape (`classes`
 * renamed `classList`).
 */
export type ResolvedComponentClass = {
  className: string;
  classList: string[];
};
