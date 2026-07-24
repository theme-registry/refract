---
name: layout
description: Author the `layout` slice of a refract theme — the length scales (spacing/gutters/sizes/aspectRatio) with geometric or linear scale synthesis, the four structural generators (columns/grids/stacks/container), and layout recipes with sizing verbs. The only CLOSED subsystem (fixed keys). Use when writing spacing scales or layout primitives. Triggers: "spacing scale", "sizes / min-width scale", "columns / grid / stack / container", "4/8-pt grid", "layout recipe padding/gap".
tier: core
---

# Layout

`layout` is the only **closed** subsystem — its keys are fixed: the length-scale properties
(`spacing` / `gutters` / `sizes` / `aspectRatio`), the four structural generators (`columns` /
`grids` / `stacks` / `container`), and the `recipes` block. Cross-cutting axes are in
**theme-foundations**; recipe mechanics in **recipes-and-composition**. Exhaustive options live in
[`docs/authoring.md`](https://github.com/theme-registry/refract/blob/main/docs/authoring.md).

## Length scales — synthesis

`spacing`, `gutters`, and `sizes` can synthesize their variant ramp from a base + one curve (declare
`ratio` **or** `step`, never both). `aspectRatio` is a plain property (no ramp).

```ts
layout: {
  // geometric: base × ratio^n, `steps` an ORDERED name array (index = exponent)
  spacing: { base: 8, ratio: 1.5, steps: ["xs", "sm", "md", "lg", "xl"] },

  // linear: step × mult, `steps` a name→multiplier map (the 4/8-pt grid)
  gutters: { base: 0, step: 4, steps: { sm: 1, md: 2, lg: 4 } },

  sizes: { base: "20rem", ratio: 1.25, steps: ["sm", "md", "lg"],
           variants: { full: "100%", prose: "65ch" } },   // authored variants win, never synthesized
}
```

Omitting `steps` uses the default ladder `xs sm md lg xl 2xl 3xl 4xl`. Each synthesized step is a
**derived** ref (`scaleStep`), so `override()` of the base re-derives the whole ramp for free (see
**overrides-and-child-themes**). Authored `variants` win over synthesized ones; `spacing` / `gutters`
always expose a forced `none` (`0`). A `responsive` entry carrying `ratio` / `step` regenerates the
**whole named scale** at that breakpoint (one `target` override per step).

## Structural generators

Each key drives a generator that emits layout primitives; declarations reference the length-scale
tokens by name.

- **`columns`** — `number` or `{ size, gutter?, inset? }`. Generates per-span × per-breakpoint
  utilities: `col-<bp>-<n>` (`grid-column-end: span n`) and `offset-<bp>-<n>` (`grid-column-start`),
  plus `columns--size/gutter/inset` config tokens.
- **`grids`** — `{ <name>: { templateColumns, templateRows, autoRows, autoColumns, justifyItems,
  alignItems, justifyContent, alignContent, gap, responsive } }`. Each emits a `grid-<name>` recipe
  (`display: grid` + template props; `gap` resolves to a `spacing` ref).
- **`stacks`** — `{ <name>: { direction: "row"|"column", align, justify, wrap, inline, gap,
  responsive } }`. Each emits a `stack-<name>` recipe (flex / inline-flex, direction, align, justify,
  wrap; `gap` → `spacing` ref).
- **`container`** — a mode string (`"fixed"` / `"fluid"` / a width) or `{ base, inset, gutter,
  direction, align, justify, maxWidth, variants, responsive }`. Always emits a default container
  (defaults to `"fixed"`). `fixed` steps `max-width` per breakpoint; `fluid` applies a `maxWidth` cap
  (a `sizes` variant name → unit-aware ref, a breakpoint name → its px width, else a literal); a
  custom width becomes that `max-width`. Emits `container--inset/gutter` config tokens.

## recipes — layout recipes

The reserved `recipes` block declares spacing-bearing properties (`paddingX` / `paddingY` / `marginX`
/ `marginY` / `gap` / `background`) plus **sizing verbs** — `width` / `minWidth` / `maxWidth` /
`height` / `minHeight` / `maxHeight`, each naming a `layout.sizes` variant and routing to its CSS
longhand. Non-scale dimensional CSS (`display`, `position`, …) stays in a component `css` delta.
Recipe structure is in **recipes-and-composition**.
