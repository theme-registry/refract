---
name: recipes-and-composition
description: How recipes work across every refract subsystem — the group → recipe → variant tiers, states, the variants modifier map, and cross-subsystem composition via components. Read this whenever authoring anything under a recipes block, not just colors or layout. Triggers: "add a recipe", "recipe variants", "compose a button/component", "components block", "recipe states", "variant vs recipe".
tier: core
---

# Recipes and composition

Every subsystem exposes the **same** recipe machinery under its `recipes` key (and `components`
is composition-only). Learn it once here; the domain guides just say "and it has recipes." For
the shared override axes (`responsive`, `variant:` / `target:`, `states`) see **theme-foundations**.

## Three tiers

`recipes: { <group>: { <recipe>: { …props } } }`

- **group** (`solid`) — a namespace of related recipes.
- **recipe** (`brand`) — the leaf that resolves to a class / export.
- **variant** (`muted`) — an optional modifier delta on a recipe (below).

```ts
colors: {
  recipes: {
    solid: {
      brand: {
        background: "brand", color: "brand.text",
        states: [{ state: "hover", background: "brand.dark" }],
        responsive: [{ breakpoint: "md", query: "min", state: "hover", background: "brand.darker" }],
      },
    },
  },
}
```

Values that name a token become references (`var(--…)` in CSS) so overrides cascade; unknown
names pass through as literals (see **theme-foundations** → References).

## States

`states` is validated against the **adapter's** known set (CSS: `hover` / `focus` / `disabled` /
…); an unknown state throws at build. It's a **LIST of override entries**, each
`{ state, target?, …deltas }` — author them directly, or put a `state` on a `responsive` entry to
gate on a breakpoint too. An optional `target` scopes a state onto a recipe **variant** sibling
(`<item>-<variant>`), so two same-state entries can differ per variant:
`states: [{ state: "hover", … }, { state: "hover", target: "lg", … }]`.

## Variants — a modifier map on any recipe

Add a `variants` map of deltas to any recipe in any subsystem. Each desugars to a flat sibling
`<recipe>-<variant>`; the bare recipe still emits. **Opt-in + additive** — no `variants` key
means unchanged output.

```ts
solid: {
  brand: {
    background: "brand", color: "brand.text",
    variants: { muted: { background: "brand.light" } },   // → solid.brand + solid.brand-muted
  },
}
```

Merge rules, per field:

- a **ref** replaces the base ref;
- **`css`** shallow-merges by property;
- **`states`** merge by state name;
- **`responsive[]`** concatenates;
- a prop set to **`null`** drops an inherited ref (`borders: null`) — `null`, not `"none"`
  (which stays a real value like `border: none`).

The join separator is `-` (matching token variants). A desugared name that collides with an
existing sibling throws. Variants are a flat axis — no nesting.

## Composition — the `components` subsystem

`components` owns no primitive tokens; each recipe **references other subsystems' recipes** and
adds an own `css` delta (which wins on conflict):

```ts
import { ref } from "@theme-registry/refract";

components: { recipes: { buttons: { primary: {
  colors: "solid.brand", typography: "button.large", layout: "padding.button", borders: "outline.hairline",
  css: { cursor: "pointer", border: "none", color: ref("colors.brand.text") },   // see the rule below
  states: [{ state: "hover", css: { transform: "translateY(-1px)" } }],
} } } }
```

**The `css` block is literal-first:** a **bare string / number is a raw CSS literal** (`cursor:
"pointer"` just works), and a **token reference** uses `ref("…")` or the JSON-safe `{ ref: "…" }`
object. This differs from the composition fields above (`colors: "solid.brand"`), where a bare
string is always a reference — those compose tokens; the `css` block writes CSS. Prefer `ref()`
explicitly. (Full rule in **theme-foundations**.)

The referenced recipes are spread in (their resolved declarations), then the own `css` delta is
applied on top. In CSS this emits a class list; in styled-components it spreads the referenced
`css` blocks — see **adapter-usage** and **consuming-the-output** for how each adapter realizes
composition. `variants` works here too (a component recipe can carry its own modifier map).

Don't hand-derive the composed class name — read the **real** one: `theme.getClass("components",
"buttons", "primary")` returns the full class list, or, with an MCP server connected, the `getClass`
/ `renderRecipe` tools return the real class / emitted CSS live (configured prefix and all). See
**theme-authoring → Agent tools**.

**Precedence.** refract emits low, even specificity (single classes; zero-specificity `:where()` for
globals) and relies on **source order** at equal specificity — the delta class is emitted last, so it
wins. If you compose refract with an existing stylesheet or utility framework and want precedence that
doesn't depend on load order, wrap the output in a cascade **`@layer`** via the CSS adapter's `layer`
option (`createCssAdapter({ layer: true })` → `@layer refract`). Layered rules always lose to unlayered
app CSS, so your styles win by default. Single-file emit only; off by default (byte-identical).
