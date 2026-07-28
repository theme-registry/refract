---
"@theme-registry/refract": patch
---

Render each subsystem's recipes inside its own section, in that section's context.

Every rule-set previously landed in one "Components" section at the foot of the page, so a `colors.solid` recipe — which is part of the colour story and made of the very palette above it — was read twenty plates away under a heading that didn't describe it. Recipes now file to their subsystem's section: `colors.*` beside the palette, `layout.*` with spacing, `borders.*`/`effects.*` with shape, `animation.*` with motion, `typography.*` with the type scale. Only genuinely composed rule-sets stay in Components, which is the honest home for "a thing built out of the others".

A section now earns its place on tokens **or** recipes, so a subsystem that declares rule-sets but contributes no tokens of its own still appears. Section pills and rail counts report both. The "no recipes yet" notice stays in one place rather than repeating per section.

Also fixes long token paths overflowing their swatch chips instead of wrapping.
