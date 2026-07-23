---
name: theme-foundations
description: The cross-cutting vocabulary shared by every refract subsystem — breakpoints, containers, the responsive/variant/target/modes/states override axes, and bare-string references. Read once; the domain guides (colors, typography, layout, …) build on it instead of re-explaining. Triggers: "breakpoints", "container queries / container sizes", "responsive override", "variant vs target", "dark mode / modes", "states (hover/disabled)", "how do refs work".
tier: core
---

# Theme foundations

Vocabulary reused across every subsystem. Learn it here so the domain guides can stay focused
on their own tokens. All of this is defined once in the core and validated on every reference.

## Literals vs references — the one rule

Whether a bare string is a token reference or a raw literal depends on the context:

- **Composition fields** — a recipe's cross-subsystem fields (`colors: "solid.brand"`) and a
  colour recipe's declaration fields (`background: "brand"`, `color: "brand.text"`) — **compose
  tokens**, so a bare string there is always a **reference** (lowers to `var(--…)`). Paths are
  dotted and subsystem-scoped (`"colors.link"`); within a subsystem's own recipe the leading
  segment is implied (`"brand"` inside a colors recipe).
- **The `css` block** and **`globals` element declarations** are **raw CSS**, so a bare string
  there is a **literal** (`display: "flex"` just works). Mark the occasional token with the
  **`ref()`** helper — `color: ref("colors.brand.text")` — or the JSON-safe **`{ ref: "…" }`**
  object (for a `theme.raw.json`, which can't call a function).
- A plain **number** is always a literal.
- **Prefer `ref()` explicitly** when authoring — it makes the intent unmistakable. A `ref()` at a
  token that doesn't exist fails loud at build; a bare literal is never validated.
- **Trust boundary:** a literal `css` value passes through to the output **verbatim** (refract
  validates structure, not the content of raw declarations). Token values are re-serialized to a
  canonical form, but the `css` block is passthrough — so if you compile an **untrusted** (user- or
  agent-authored) theme and serve the result, sanitize its literal `css` values first, as you would
  any untrusted CSS.

## Breakpoints — set them first

Top-level, min-width pixels:

```ts
breakpoints: { xs: 0, sm: 576, md: 768, lg: 992, xl: 1280 }   // the default set
```

Every `responsive` entry references these **names**, so settle them before authoring anything
responsive. Threshold **units** (how `@media` widths render — `px | em | rem`) are a build-time
concern set on `createTheme({ media })` / the config, not in the raw theme.

## Containers — container queries

Top-level, opt-in. A container defines named sizes that recipe overrides target with
`{ container, size }` instead of `{ breakpoint }`:

```ts
containers: {
  card: { type: "inline-size", sizes: { sm: 320, md: 480 } },
}
```

Use breakpoints for viewport-relative variation and containers for component-relative variation.

## The override axes

Both **properties** and **recipes** carry a `responsive: [...]` list. Each entry combines a
condition with a change:

- **Condition:** `breakpoint` (+ `query: "min" | "max" | "exact"`, default `min`),
  `orientation`, or `container` + `size`.
- **Change (pick one):**
  - a plain new value for the property/field;
  - `variant: X` — reassign the base to reference sibling variant `X`;
  - `target: X, …` — override variant `X`'s value specifically (not the base).

```ts
responsive: [
  { breakpoint: "md", query: "min", fontSize: "typography.fontSize.lg" },  // plain
  { breakpoint: "sm", query: "max", variant: "compact" },                  // swap base → compact
  { breakpoint: "lg", target: "wide", padding: "layout.spacing.xl" },      // scope to variant "wide"
]
```

**variant vs target:** `variant` *swaps which variant the base points at*; `target` *edits one
named variant*. A recipe's `variants` map (see **recipes-and-composition**) desugars each variant
into a flat sibling, so `variant:` / `target:` references resolve against those siblings.

## modes — light/dark appearance

Two things share the name. A top-level **`modes` registry** declares which appearance modes exist
(`modes: ["dark", "light"]` — the default; declare more to use a custom mode like `hc`). And a
per-property **`modes` axis** (chiefly on colors) is a **LIST of override entries**, each
`{ mode, target?, …value }`: `mode` is the WHEN (validated against the registry), the optional
`target` scopes into a variant's var, and the value is a literal or a `{ ref?, modifiers }`
derivation. Adapters realize modes as conditional blocks (`prefers-color-scheme` media,
`[data-theme]` attribute, or both).

```ts
modes: ["dark", "light"],                                   // top-level registry (optional; this is the default)
colors: {
  surface: {
    base: "#fff",
    modes: [
      { mode: "dark", base: "#111" },                       // a literal mode override
      { mode: "dark", modifiers: [{ darken: 10 }] },        // …or a derivation off the own base
    ],
  },
}
```

Because dark rides the **referenced token**, anything that refs `colors.surface` flips for free —
so `globals` element rules and recipes never need their own `modes` axis.

## states — recipe conditions

`states` is a **recipe-only** axis (hover, focus, disabled, …), a **LIST of override entries**,
each `{ state, target?, …deltas }`. The **allowed set is owned by the adapter** — an unknown state
throws at build. `state` is the WHEN; the optional `target` scopes the override onto a recipe
variant's sibling (`<item>-<variant>`), so two same-state entries can behave differently per
variant.

```ts
states: [
  { state: "hover", background: "brand.dark" },
  { state: "disabled", opacity: 0.5 },
  { state: "hover", target: "lg", background: "brand" },    // a hover just for the `lg` variant sibling
]
```

modes / states / responsive are all **arrays of overrides over one spine** — WHEN
(`mode`/`state`/`breakpoint`) · WHERE (`target`) · WHAT (the value/deltas). See
**recipes-and-composition** for how states compose with variants and responsive entries.
