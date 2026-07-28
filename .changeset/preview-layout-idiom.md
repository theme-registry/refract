---
"@theme-registry/refract": patch
---

Render layout recipes in the idiom their own section already uses for tokens.

`layout.spacing` tokens get purpose-built demos — a hatched inset with a solid core, a row of blocks with a gap between them. The **recipes made of those same tokens** were rendering as bare boxes: a padding rule-set with no contrast between inset and content, and a `gap` rule-set showing nothing whatsoever, because `gap` does literally nothing on an element with a single child.

A layout recipe now borrows that idiom. Its real class still carries the measure; the preview supplies only what makes the measure legible — a content box for an inset, `display:flex` plus sample items for a gap — and discloses that it did, as with the colour-companion affordances.

A rule-set that also sets a width, height or margin is a **structure** rather than a measure — a centring container, a grid — so it keeps its natural size and gets no demo. That distinction is what stops a `layout.container` from being drawn as a hatched swatch.

**Gutters render as the space between content tracks.** A gutter is defined by what it separates — "spacing between content tracks, created in grid, flex and multi-column layout via `column-gap` / `row-gap` / `gap`" — and a bar gives the magnitude without the meaning. The specimen now draws three real content tracks with the gutter hatched between them, so `32px` and `16px` are read as different separations rather than different bar lengths, and a `0` gutter correctly shows tracks touching. The plate carries the definition. `sizes` is a magnitude rather than a separation, so it keeps its bar.

