---
"@theme-registry/refract": patch
---

Fail loud on input that used to be dropped or misread without an error. Each now throws a coded `RefractError`:

- A typography recipe key that isn't a typography property, including a `css` block (`REFRACT_E_RECIPE_PROPERTY`). It used to be dropped.
- A typography recipe value that names no variant of its property, e.g. `fontFamily: "Inter"`, or a property the theme doesn't define (`REFRACT_E_VARIANT_REF`). It used to emit an invalid `var(typography.fontFamily.Inter)`.
- An unknown `layout` key such as `padding` (`REFRACT_E_LAYOUT`). It used to be dropped.
- A plain `{ ref }` alias with no `modifiers` as a base, variant or mode (`REFRACT_E_PROPERTY` / `REFRACT_E_VARIANT` / `REFRACT_E_MODE`). As a variant it used to inherit the base and emit a stray `…-ref` variable; as a base it emitted nothing. Plain aliases are planned; until then use a literal, or for colours `{ ref, modifiers: [...] }`.

A theme that hit any of these was already producing wrong or missing CSS, so it now fails at build time instead.
