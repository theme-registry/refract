---
"@theme-registry/refract": patch
---

Draw lengths at true size, and separate `base` from its variants everywhere.

**Scaling every set so its largest member fills the row was a lie about magnitude.** An 80px spacing drawn ~900px wide reads as ten times its value, and `4px` vs `8px` became indistinguishable from `40px` vs `80px` — the bars were identical in both cases. Lengths are now drawn at **true size**, so a specimen can be held against a ruler, which is the entire point of a measure. The plate says `true scale`.

Proportional scaling remains only where true size is impossible — breakpoints run to 1280px in a column a fraction of that — and those plates say `scaled to fit` instead, so a reader is never left to assume.

**`base` is now separated from its variants**, as colour families already did it. The base is the unit its variants are derived from; presenting it as the first row of an undifferentiated list hides that relationship entirely. Spacing, sizes, gutters, typography, radius, border widths, shadows and any unmapped group now band their base under a `Base` label with `Variants` beneath.
