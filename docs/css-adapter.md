# The CSS adapter

`createCssAdapter(options?)` renders a Theme to a plain-CSS stylesheet: a set of `:root`
custom-property blocks plus the recipe class rules that reference them.

```ts
import { createTheme } from "@theme-registry/refract";
import { createCssAdapter } from "@theme-registry/refract-css";

const theme = createTheme(raw, { adapter: createCssAdapter({ prefix: "acme" }) });
theme.css; // the full stylesheet
```

Every option is optional. The adapter has just **two naming knobs** — one for variables,
one for classes — plus value/delivery knobs.

## Options

| Option | Type | Default | Affects |
| --- | --- | --- | --- |
| `prefix` | `string` | `"dt"` | Every **variable** name (`--<prefix>-…`); also the default for `classPrefix`. |
| `classPrefix` | `string` | `prefix` | Every **class** name — recipe classes *and* container-query context classes. |
| `inline` | `boolean` | `false` | Bakes resolved values into rules and drops the `:root` variable blocks. |
| `colorFormat` | `"rgb" \| "hex" \| "oklch"` | `"rgb"` | Output syntax for **palette colour** variables. |
| `layer` | `string \| boolean` | `—` | Wrap all output in a cascade `@layer` (`true` → `refract`, or a name) for deterministic precedence below unlayered app CSS. Single-file emit only; off = byte-identical. |
| `reducedMotion` | `boolean` | `false` | Append a `@media (prefers-reduced-motion: reduce)` block that neutralizes animation/transitions. Single-file emit only. |
| `naming` | `NamingOverrides` | `—` | Swap how variable/class names are generated (`{ variableName?, className? }`). Collision-checked — two addresses mapping to one name throw. |
| `naming` | `NamingOverrides` | — | Swap how class/variable names are generated (see [docs/extending.md](extending.md)). |

Subsystems (colors/typography/layout/…) are **not** configured with separate options —
they are namespaced by the token path, so a variable name is always
`--<prefix>-<subsystem>-<group>-<variant>` and a recipe class is always
`.<classPrefix>-<subsystem>-<group>-<variant>`.

---

## `prefix` — variable names (and the MFE story)

`prefix` sets the identifier segment on every CSS variable, and is the default for
`classPrefix`, so on its own it rebrands the whole output:

```ts
createCssAdapter({ prefix: "acme" });
```

```css
:root { --acme-layout-spacing: 16px; }
.acme-layout-container-full { gap: var(--acme-layout-spacing); }
```

### Micro-frontend isolation

Two independently-built bundles on the same page must not share variable names, or their
`--*` custom properties collide and clobber each other. Give each build a distinct `prefix`:

```ts
// App A
createCssAdapter();                      // → --dt-*   / .dt-*
// App B
createCssAdapter({ prefix: "checkout" }); // → --checkout-* / .checkout-*
```

Because a variable's first segment **is** the prefix by construction, choosing the prefix
is the whole isolation mechanism — there's no separate "scope" concept.

## `classPrefix` — class names

By default classes inherit `prefix`. Set `classPrefix` only when you want the class names
to differ from the variable names:

```ts
createCssAdapter({ prefix: "acme", classPrefix: "ui" });
```

```css
:root { --acme-layout-spacing: 16px; }        /* variables → prefix */
.ui-layout-container-full { gap: var(--acme-layout-spacing); }  /* classes → classPrefix */
```

This one prefix covers **every** class the adapter emits, including the container-query
context utility classes:

```css
.ui-cq-card { container-type: inline-size; container-name: card; }
```

There is no per-family class-prefix override — one knob, applied uniformly.

---

## `inline` — bake values, drop variables

By default the adapter emits `var(--…)` references plus the `:root` blocks that define them.
`inline: true` resolves each reference to its concrete value, bakes it into the declaration,
and omits the variable blocks entirely.

```css
/* default */
:root { --dt-colors-primary: #4dabf7; }
.dt-colors-solid-primary { background: var(--dt-colors-primary); }

/* inline: true */
.dt-colors-solid-primary { background: #4dabf7; }
```

Use the default for runtime theming (swap a `:root` var and everything updates). Use `inline`
for a self-contained stylesheet with no custom-property indirection — e.g. shipping one
component's CSS in isolation, or a consumer that can't rely on CSS variables.

> `inline` bakes values, leaving no variables file — so it cannot be combined with the
> multi-file emit modes that exist to produce a separate variables file (the adapter throws
> if you try). Note the `components` emit mode has its **own** `inline` control (default
> `true`) configured on the emit plan; the global `inline` option here does not drive it.

## Length value units — moved to core

Declaration-value length units are **no longer a CSS-adapter option**. They are format-neutral, so
they live on `createTheme` / the build config (`units` + `baseFontSize`, §21) and every target emits
the same units:

```ts
createTheme(raw, { adapter: createCssAdapter(), units: { default: "rem" }, baseFontSize: 16 });
// spacing 16 → "1rem"  (value ÷ baseFontSize)
```

`units` is a token-path role map (`units.default`, `units["<subsystem>"]`,
`units["<subsystem>.<property>"]`, most-specific wins). This is **not** the unit for
media/container-query thresholds — those live in the theme's `media` config (which also supports `em`).

## `colorFormat` — palette colour output

Choose how palette colour values are written into the emitted `:root` variables — the base,
`text`, variants, responsive overrides, and appearance modes. The colour is identical across
formats; this is presentation only, so nothing else about the output changes.

```ts
createCssAdapter();                          // → --dt-colors-primary: rgb(77, 171, 247);
createCssAdapter({ colorFormat: "hex" });    // → --dt-colors-primary: #4dabf7;   (#rrggbbaa with alpha)
createCssAdapter({ colorFormat: "oklch" });  // → --dt-colors-primary: oklch(71.8% 0.1422 246.06);
```

The Model always stores the canonical `rgb()` form; `hex` / `oklch` re-serialize that same
colour at emit time (the `oklch()` reflects the 8-bit-quantized value, not the pre-quantization
synthesis float — the `rgb()` **is** the canonical colour). `oklch` unlocks the browser's native
OKLCH interpolation for anything that reads these variables. Colours typed **literally** into a
recipe declaration pass through as authored; `colorFormat` applies to the synthesized palette
tokens. `inline` mode inherits the chosen format automatically. Other adapters (SCSS / JSON /
styled-components) and DTCG export are unaffected.

---

## `layer` — deterministic precedence

refract emits low, even specificity — recipes are single classes, globals are zero-specificity
`:where()` — and relies on **source order** at equal specificity. That's easy to override, but
source order depends on where the stylesheet loads. To make precedence independent of load order,
wrap the output in a cascade `@layer`:

```ts
createCssAdapter({ layer: true });          // → @layer refract { … }
createCssAdapter({ layer: "refract.base" }); // custom layer name
```

Layered rules always lose to **unlayered** CSS, so your app styles (authored unlayered, or in a
later-declared layer) win by default — the recommended way to compose refract with an existing
stylesheet or a utility framework. It's **single-file emit only** and **off by default** (output is
byte-identical unless you opt in). `reducedMotion` shares the same single-file constraint.

---

## See also

- [Authoring a theme](./authoring.md) — the raw theme surface and `createTheme`.
- [Extending with adapters](./extending.md) — the adapter contract and how the CSS adapter
  is built (worked reference).
