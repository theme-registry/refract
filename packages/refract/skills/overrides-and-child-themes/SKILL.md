---
name: overrides-and-child-themes
description: Derive brand variants and child themes from a base theme with theme.override(partial). Use for multi-brand, white-label, or sub-brand setups where several themes share one structure. Triggers: "child theme", "brand variant", "white-label", "theme.override", "override a token", "multi-brand".
tier: core
---

# Overrides and child themes

`theme.override(partial)` returns a **new theme** by delta-merging a partial raw theme onto the
base. Use it for multi-brand / white-label setups: author one structural base, then derive brands
that change only what differs.

```ts
const base = createTheme(raw, { adapter: createCssAdapter() });

const acme = base.override({
  colors: { brand: { base: "#d6336c" } },   // only the token(s) that differ
});

acme.css;                                    // fully re-derived output
```

## What re-derives

The override re-runs the pipeline, so **derived values recompute** — a palette `base` change
re-derives its `light`/`dark`/`steps`, a layout scale re-synthesizes its ramp, and every recipe
that references those tokens picks up the new values. **Cross-property derivations re-derive too:**
a variant or mode that reads *another* property (`{ ref: "colors.brand", modifiers: [{ darken: 12 }] }`)
recomputes when you override its **source** — even though the deriving property isn't in your
partial. This is why tokens are stored as derived refs, not frozen literals. The adapter surface
(`.css`, `.classes`, …) recomputes for the child.

## Guidelines

- **Override the smallest delta.** Change the `base` of a palette, not each derived variant, and
  let derivation do the rest.
- **Structure stays in the base.** Overrides are for *values* — keep recipes, breakpoints, and
  composition in the base theme so every brand shares one shape.
- **Chain freely.** A child can itself be overridden (`acme.override({...})`), building a small
  tree of brand → sub-brand.
- **See the blast radius first.** An override re-derives everything downstream — before you commit
  one, run `diffTheme(partial)` (via the MCP server, or `refract diff` in CI) to see exactly which
  tokens, classes and contrast pairings the delta moves. Plan, then apply. See **theme-authoring →
  Agent tools**.
- For the merge semantics of individual fields (refs, `css`, `states`, `responsive`) the same
  rules as recipe variants apply — see **recipes-and-composition**.

For emitting several brands to disk, give each its own build target (or run the build per
override) — see **build-config**.

## Extending a theme you don't own — external tokens

`override()` derives a child of a theme *you* built. To instead build ON TOP of a **published**
theme — reusing its variables without redefining them — declare the borrowed tokens as external:

```ts
extends: { prefix: "dt" },                     // the parent theme's CSS-variable prefix
colors: {
  brand:   { external: "colors.brand" },       // path form → var(--dt-colors-brand)
  surface: { external: "--mat-sys-surface" },  // literal form (leading --) → any var, verbatim
  accent:  "#e64980",                          // your own new token
  recipes: { solid: { cta: { background: "brand", color: "accent" } } },
}
```

An external token is a passthrough to the parent's CSS variable: referenceable everywhere, never
defined locally, never tonally derived, and it survives `override()`. Path form assumes the parent's
default naming (`extends.prefix`, any string incl. `""`); literal form (`--…`) points at any variable
(Material/Tailwind/hand-rolled). Best for individual tokens (colours, spacing, type). For a one-off,
`css: { color: "var(--dt-colors-brand)" }` also works — a bare string in a `css` block is a literal.
