---
name: typography
description: Author the `typography` slice of a refract theme — the open map of type properties (font families, weights, line-height, letter-spacing, text props) and the `fontSize` modular scale synthesized from a base + named ratio. Use when writing or tuning the type domain. Triggers: "type scale", "modular scale / ratio", "font sizes", "fontFamily / fontWeight / lineHeight", "typography recipe".
tier: core
---

# Typography

The `typography` key is an **open** map: each key is a type property holding a value, plus the
reserved `recipes` block. Cross-cutting axes (`responsive`, `variants`, refs) are in
**theme-foundations**; recipe mechanics are in **recipes-and-composition**. Exhaustive options live
in [`docs/authoring.md`](https://github.com/theme-registry/refract/blob/main/docs/authoring.md).

## Type properties

Properties are heterogeneous — a value is `string | number`, or an extended `{ base, … }`:

```ts
typography: {
  fontFamily: { base: "Inter, sans-serif", variants: { mono: "ui-monospace, monospace" } },
  fontWeight: { base: 400, variants: { medium: 500, bold: 700 } },
  lineHeight: { base: 1.5, variants: { tight: 1.25 } },
  letterSpacing: { base: "0", variants: { wide: "0.05em" } },
  // text props also live here: fontStyle, textTransform, textDecoration, textAlign
}
```

Each `variants` entry is named and referenced elsewhere by bare name (see **recipes-and-composition**).

## fontSize — the modular scale

Give `fontSize` a `base` plus a named `ratio` and refract synthesizes the scale steps as variants —
each `base × ratio^step`, rounded to `precision`:

```ts
fontSize: {
  base: 16,
  ratio: "minor-third",   // one of the named ratios below
  precision: 4,           // decimal places (default 4)
  baseFontSize: 16,        // scale origin if it differs from `base` (defaults to `base`)
  unit: "rem",             // "px" | "rem"
}
```

Generated step keys and their exponents: `xs` (−2), `sm` (−1), `md` (0), `lg` (1), `xl` (2), `2xl`
(3), `3xl` (4), `4xl` (5). Named ratios:

| Name | Factor | | Name | Factor |
|---|---|---|---|---|
| `minor-second` | 1.067 | | `augmented-fourth` | 1.414 |
| `major-second` | 1.125 | | `perfect-fifth` | 1.5 |
| `minor-third` | 1.2 | | `golden` | 1.618 |
| `major-third` | 1.25 | | | |
| `perfect-fourth` | 1.333 | | | |

Without a (recognized) `ratio`, `fontSize` passes through untouched. Author-declared `variants` win
over synthesized steps and **seed the chain** — a hand-pinned step becomes the origin the next
generated step compounds from.

## recipes — typography recipes

The reserved `recipes` block declares typographic properties (`fontFamily`, `fontSize`, `fontWeight`,
`lineHeight`, `letterSpacing`, `fontStyle`, `textTransform`, `textDecoration`, `textAlign`, plus any
extra passed through). Each value names a **variant** of the matching property (`fontSize: "3xl"`,
`fontWeight: "bold"`, or `"base"` for the base value). Recipe structure (states, responsive,
composition) is in **recipes-and-composition**.
