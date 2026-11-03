---
"@theme-registry/refract": patch
"@theme-registry/refract-css": patch
"@theme-registry/refract-styled-components": patch
---

Raw themes can alias tokens. A `{ ref: "colors.accent" }` with no `modifiers` makes a property, a variant, a mode value or a responsive `base` the same token as its target:

```ts
colors: {
  accent: { base: "#e64980", modes: [{ mode: "dark", base: "#f783ac" }] },
  highlight: { ref: "colors.accent" },
  link: { base: { ref: "colors.accent" }, variants: { hover: { ref: "colors.accent.dark" } } },
}
```

- The CSS adapter writes a live link, `--dt-colors-highlight: var(--dt-colors-accent);`, so the alias follows its target through dark mode, breakpoints and `override()`.
- SCSS writes the target's value; styled-components writes it per mode; `toDTCG` writes a DTCG alias (`"{color.accent.base}"`).
- `theme.tokens` keeps the link and the resolved value.
- An alias can point across subsystems at a token of the same kind (`borders.radius.card → layout.spacing.md`). A missing target or a different kind of value is a validation error, a loop is `REFRACT_E_CYCLE`, and an aliased property can't generate its own tones or scale.

A plain `{ ref }` used to be misread (as a variant it inherited the base and emitted a stray `…-ref` variable; as a base it emitted nothing). The core size budget moves from 30 KB to 31 KB gzip.
