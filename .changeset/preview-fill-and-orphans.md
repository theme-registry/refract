---
"@theme-registry/refract": patch
---

Fix unstyled plates in `preview.html`, and let a dimensionless recipe fill its stage.

**Regression fix (shipped in 0.1.12).** The paper-and-cards rewrite renamed `.rfp-plate*` to `.rfp-card*` in the stylesheet but only updated the palette renderer, so the shared `plate()` helper kept emitting the old names. Eighteen elements — every plate below the palette — rendered with no CSS at all: no card, no spacing between a plate's name and its subtitle. Valid HTML, silently unstyled, which is why nothing caught it. A test now asserts that every `rfp-` class the page emits is also defined in the stylesheet it ships.

**Dimensionless recipes fill their stage.** A pure colour recipe (`background` + `color`, nothing else) has nothing to size it, so it collapsed to a text-sized blob adrift on a large stage — which tells you almost nothing about the colour. Those now stretch edge to edge and read as a swatch. Recipes that size themselves are untouched, because that size is the thing being shown; composition is followed, so a variant that declares nothing but references a recipe with padding still keeps its natural size.

The modes, base-elements and components section heads also now use the same heading + count pill as every other section, rather than a leftover eyebrow style that no longer had CSS behind it.
