---
"@theme-registry/refract": patch
---

Rebuild `preview.html` as paper and cards, and commit it to a light sheet.

The page is now a light paper with each plate as a white card, rather than a white ground with grey panels that left every plate flush and weightless — palettes in particular ran together. Colour becomes **one card per family**: a large base swatch, the family's lightness ladder, then its declared members, so separation comes from the card edge instead of a hairline rule.

New on the page:

- **A masthead in the theme's own first palette**, carrying headline counts — tokens, subsystems, recipes + elements, emitted size, and a **WCAG pass ratio** across declared `text` pairings. It is the one place the chrome takes a hue, and it takes the theme's rather than asserting one.
- **An index cover** built from the sections that actually rendered, so it is the shape of the theme rather than a fixed contents list.
- **`src` / `gen` provenance tags** — whether you authored a value or refract synthesised it. This is read from the model, not the token export: a literal `Ref` carries `value` while a derived one carries `ref`/`fn`/`modifiers`, and the DTCG export resolves both down to literals.
- **Count pills** on every section head.

**The sheet is deliberately light-only.** Colour cannot be judged against a moving backdrop — the same swatch reads lighter and more saturated on dark, which is why swatch books are printed on white. A flipping sheet would also add a second variable: you could no longer tell whether a swatch changed because the *theme's* mode changed or because the page did. The appearance control moves the specimen; the sheet stays paper. The theme's own `prefers-color-scheme` rules still apply to what is being previewed.
