---
name: visual-effects
description: Author the three visual-effect slices of a refract theme — `effects` (shadows, transitions, blur, opacity, z-index), `borders` (stroke geometry: width/style/offset/radius), and `animation` (motion tokens + keyframes + animation-shorthand recipes). Use when writing shadows, transitions, strokes, or motion. Triggers: "box shadow", "transition tokens", "border / outline / radius", "keyframes", "animation recipe", "blur / opacity / z-index".
tier: core
---

# Visual effects — effects · borders · animation

Three sibling subsystems, each with its own top-level key. Cross-cutting axes (`responsive`,
`variants`, `modes`, refs) are in **theme-foundations**; recipe mechanics in
**recipes-and-composition**. Exhaustive options live in `docs/authoring.md`.

## effects

Open map. `shadow` and `transitions` are **structured object-leaf** properties — format-neutral flat
leaves, never raw CSS. `blur` / `opacity` / `zIndex` are plain scalars.

The flat leaf fields sit at the property top level and **are** the (single-layer) base — there is
**no `base` key**. A `variants` entry — and the value of each `modes` / `responsive` entry (both are
lists of `{ mode|breakpoint, …leaf }`, per **theme-foundations**) — is a full leaf value, or an
**array** of leaves for a multi-layer value. The keyword `"none"` means no shadow / no transition.
**Raw CSS strings are rejected** (only `"none"` is accepted).

```ts
effects: {
  shadow: {
    offsetY: 2, blur: 8, color: "colors.shadow",     // top-level leaf = the base
    variants: {
      lg: [                                            // array = multi-layer
        { offsetY: 4, blur: 12, color: "colors.shadow" },
        { offsetY: 1, blur: 3,  color: "colors.shadow.a20" },
      ],
      none: "none",
    },
  },
  transitions: { property: "opacity", duration: 200, timingFunction: "ease-out", delay: 0 },
  blur: 8, opacity: 1, zIndex: 10,
}
```

Shadow leaf fields: `offsetX`, `offsetY`, `blur`, `spread` (a bare number is a **deferred** length
resolved by the unit pass; a `"1px"` / `"0.5rem"` string is **pinned**), `color` (a `colors.*`
**ref** — translucency comes from an `alpha` colour variant, e.g. `colors.shadow.a20`, never a shadow
field), and `inset` (boolean). Transition part fields: `property` (**required**), `duration` (ms),
`timingFunction` (keyword or `cubic-bezier(...)`), `delay` (ms).

Reserved `recipes` (EffectsRecipeProps): `boxShadow` (→ `shadow`), `transition` (→ `transitions`),
`blur` (lowers to `filter: blur(var(--…))`), `opacity`, `zIndex` — each naming a variant.

## borders

Open map of **stroke geometry only** — colour is never a borders token. Properties: `width` (px
number), `style` (string), `offset` (px number, outline only), `radius` (px number, or a string like
`"9999px"`).

```ts
borders: {
  width:  { base: 1, variants: { thick: 2 } },
  style:  { base: "solid", variants: { dashed: "dashed" } },
  radius: { base: 4, variants: { pill: "9999px" } },
  offset: { base: 2 },
}
```

Reserved `recipes` (BordersRecipeProps): `as` (`"border"` default | `"outline"`) and `side`
(`top`/`right`/`bottom`/`left`, border only) are **modifiers** that route each aspect to its
longhand. The geometry aspects `width` / `style` / `offset` / `radius` name a **variant** of the
matching property by bare name (`"thick"` → `borders.width.thick`). `color` is a **value-level
`colors.*` ref** (`"colors.primary"`), never a borders token.

## animation

Motion tokens `duration` (ms number) / `easing` (string) / `delay` (ms number) are regular
properties (base + variants). The reserved `keyframes` key holds named definitions; `recipes`
composes them into an `animation:` shorthand.

```ts
animation: {
  duration: { base: 200, variants: { fast: 120, slow: 400 } },
  easing:   { base: "ease-out", variants: { spring: "cubic-bezier(.5,1.5,.5,1)" } },
  keyframes: {
    fadeInUp: {
      from: { opacity: 0, transform: "translateY(20px)" },   // literal or { ref: "colors.surface" }
      to:   { opacity: 1, transform: "translateY(0)" },
    },
  },
}
```

A keyframe definition maps a step selector (`from` / `to` / `"0%"` / `"50%"` / grouped `"0%, 100%"`)
to declarations — kebab-case CSS property → a **literal** value or a **`{ ref }`** (resolved late so a
keyframe can animate a themed value). Authoring order is preserved.

Reserved `recipes` (AnimationRecipeProps): `keyframes` names a keyframe; `duration` / `easing` /
`delay` name a **variant** of the matching motion token; `iterationCount` / `direction` / `fillMode`
/ `playState` pass through — all composed into one `animation:` shorthand.
