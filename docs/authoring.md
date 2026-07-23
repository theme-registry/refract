# Authoring a theme

The user guide: how to author a raw theme, pick and configure an adapter, consume the
built theme at runtime, and emit it to disk at build time. For writing your own subsystem
or adapter, see **[extending.md](extending.md)**.

- [Quickstart — a minimal theme](#quickstart--a-minimal-theme)
- [The raw theme](#the-raw-theme)
- [Property values](#property-values-literals-refs-overrides)
- [Recipes and states](#recipes-and-states)
- [Composition — the `components` subsystem](#composition--the-components-subsystem)
- [Choosing an adapter](#choosing-an-adapter)
- [The runtime theme](#the-runtime-theme)
- [Deriving child themes with `override`](#deriving-child-themes-with-override)
- [Build to disk](#build-to-disk)
- [`emit` modes](#emit-modes)
- [DTCG interop](#dtcg-interop)

## Quickstart — a minimal theme

You don't need most of what's below to start. A complete theme is a palette, a recipe, and a
component — five lines of substance:

```ts
import { createTheme } from "@theme-registry/refract";
import { createCssAdapter } from "@theme-registry/refract-css";

const theme = createTheme({
  colors: {
    brand: { base: "#4c6ef5", text: "#ffffff" },                       // + auto light/dark steps
    recipes: { solid: { brand: { background: "brand", color: "brand.text" } } },
  },
  components: { recipes: { buttons: { primary: { colors: "solid.brand" } } } },
}, { adapter: createCssAdapter() });

// `theme.css` → the stylesheet to ship;
// `theme.getClass("components", "buttons", "primary")` → the class to put on your <button>.
```

That's the whole pattern: **properties** (`brand`) → **recipes** (`solid.brand`) → **components**
(`buttons.primary`) → an **adapter** renders it. Everything past this point is optional depth —
reach for it when you need it, using the [subsystem cheat-sheet](#subsystem-cheat-sheet) to see
which axis solves which problem.

## The raw theme

A raw theme is `breakpoints` plus one key per **subsystem**. Every key is optional. Type
it with `RawTheme` for autocomplete and typo detection:

```ts
import type { RawTheme } from "@theme-registry/refract/build";

const raw = {
  breakpoints: { xs: 0, sm: 576, md: 768, lg: 1024, xl: 1440 },

  colors:     { /* palettes + recipes */ },
  typography: { /* type properties + recipes */ },
  effects:    { /* radius/shadow/… + recipes */ },
  layout:     { /* spacing + structural generators + recipes */ },
  components: { /* composition recipes only */ },
} satisfies RawTheme;
```

`breakpoints` is a `name → min-width (px)` map. Every responsive override elsewhere
references these names, so define them first. A `0`-width base (`xs: 0`) is allowed.

Each subsystem carries **properties** (the tokens) and an optional nested **`recipes`**
block (reusable rule-sets).

### Subsystem cheat-sheet

The pattern is uniform — properties → recipes — but each subsystem has a couple of things worth
knowing up front, so you look them up rather than memorize them:

| Subsystem | Properties | Synthesizes? | Notes / exceptions |
| --- | --- | --- | --- |
| `colors` | palettes | **yes** — OKLCH tonal steps (`light`/`dark`/…) + numeric ladders | input: hex / `[r,g,b]` / `oklch()` / `hsl()` / keyword |
| `typography` | `fontFamily`, `fontSize`, `fontWeight`, `lineHeight`, `letterSpacing`, text props | **yes** — modular type scale | — |
| `layout` | `spacing`, `gutters`, `sizes`, `aspectRatio` | **yes** — spacing/size scale ramps | **closed** (fixed keys); structural generators `columns`/`grids`/`stacks`/`container` |
| `effects` | `radius`, `shadow`, `transitions`, `opacity`, `zIndex`, `outline`, `borderWidth`, `blur` | no — values pass through | recipe keys differ from token keys (`boxShadow`→`shadow`, `transition`→`transitions`); `blur`→`filter` |
| `borders` | `width`, `style`, `offset`, `radius` | no | stroke geometry; `color` is a value-level `colors.*` ref |
| `animation` | `duration`, `easing`, `delay` | no | + `keyframes`; `reducedMotion` is a CSS-adapter option |
| `components` | *(none)* | n/a | **closed**, recipes-only — composes the others' recipes, owns no tokens |
| `globals` | *(none)* | n/a | mints **no classes** — a `preset` + themed bare-element rules (`a`, `h1`, …) |

Two subsystems are **closed** (fixed authoring keys): `layout` and `components`. `layout` is the
only closed subsystem that owns property tokens; `components` is recipes-only.

## Property values (literals, refs, overrides)

A property is either a bare value or a full object with `base`, `variants`, and
`responsive`:

```ts
colors: {
  success: "#40c057",                        // bare literal — one token, no variants
  brand: {
    base: "#4c6ef5",
    text: "#ffffff",
    variants: { light: "#91a7ff", dark: "#3b5bdb" },   // brand.light, brand.dark
  },
}
```

**References.** Inside a recipe, a value that names another token is emitted as a
reference (in CSS, `var(--…)`), not inlined — so overriding the source cascades for free:

```ts
recipes: {
  solid: { brand: { background: "brand", color: "brand.text" } },
  //                             ^ ref to colors.brand   ^ ref to colors.brand.text
}
```

### Literals vs references

One rule governs every value you author, split by context:

- **Composition fields** — a recipe's cross-subsystem fields (`colors: "solid.brand"`) and a
  colour recipe's declaration fields (`background: "brand"`) — **compose tokens**, so a bare
  string there is always a **token reference**.
- **The `css` block** (and `globals` element declarations) — **raw CSS**, so a bare string
  there is a **literal** value (`display: "flex"` just works). Mark the occasional token with
  the **`ref()`** helper (TS/JS) or the JSON-safe **`{ ref: "…" }`** object.
- **Numbers** are always literals.

```ts
import { ref } from "@theme-registry/refract";

css: {
  display: "flex",                    // literal (raw CSS)
  gap: 8,                             // literal (number)
  color: ref("colors.brand.text"),   // reference → var(--…)
}
// theme.raw.json — the object form needs no import:
//   "color": { "ref": "colors.brand.text" }
```

A `ref()` at a token that doesn't exist fails loud at build time; a bare literal is never
validated. (The two contexts are deliberate: name a token where you're composing tokens,
write a value where you're writing CSS.)

**Colour input.** Author a colour as a hex string (`"#4c6ef5"`), an `[r, g, b]` tuple, or any CSS
colour — `oklch(…)`, `hsl(…)` / `hsla(…)`, `rgb(…)` / `rgba(…)`, or a named keyword
(`"rebeccapurple"`). All normalize to the canonical form and derive in OKLCH. Only a `var(--…)` is
rejected — it can't be tonally derived at build time; borrow it as an [external token](#extending-a-published-theme--external-tokens) instead.

**Synthesized color steps.** Colours synthesize in **OKLCH** (a perceptual space), so equal
lightness moves look even and one lightness reads the same across hues. A palette with `base`
(and optionally seed `variants`) auto-derives named steps `light` / `lighter` / `dark` /
`darker`. Tune or replace them:

```ts
brand:   { base: "#4c6ef5", lightenBy: 12, darkenBy: 15 },          // tune the named pair (OKLCH ΔL points)
accent:  { base: "#e64980", steps: [100,200,300,400,500,600,700,800,900] }, // absolute-L ladder: L = (1000 − label)/10
neutral: { base: "#868e96", variants: { hover: { adjust: { l: 45, c: 0.8 } } } }, // one-shot OKLCH placement
danger:  { base: "#e03131", harmony: "complement" },               // auto hue-rotated relatives
```

Numeric `steps` are an **absolute-lightness ladder** — each label sits at `L = (1000 − label)/10`
(`500`→L50, `900`→L10), so the same label reads at the same lightness in every palette (the exact
authored colour stays at the unnumbered token). Named steps stay relative, compounding
`lightenBy` / `darkenBy` as OKLCH ΔL points (default 10). Derived steps are stored as
**derivations** (`{ ref, fn, arg }`), not baked values, so an `override` of the base re-derives
them automatically.

**Responsive / variant / target overrides.** A `responsive[]` list re-values a property
per breakpoint. Each entry names a `breakpoint` (+ optional `query: "min" | "max"` and
`orientation`) and one of:

- plain new value(s) → override the base at that breakpoint;
- `variant: X` → reassign the base to reference variant `X` at that breakpoint;
- `target: X, …` → override *variant `X`'s* value(s) at that breakpoint.

```ts
danger: {
  base: "#fa5252", variants: { dark: "#e03131", light: "#ffc9c9" },
  responsive: [
    { breakpoint: "xl", query: "min", base: "#f03e3e" },                  // deepen base on wide screens
    { breakpoint: "sm", query: "max", target: "dark", base: "#c92a2a" },  // scope the dark step on phones
    { breakpoint: "md", query: "min", variant: "light", orientation: "landscape" }, // ref light in landscape
  ],
}
```

**Modular type scale.** `fontSize` can compute a scale from a ratio; author-declared
variants seed / override computed steps:

```ts
fontSize: {
  base: 16, ratio: "major-third", precision: 2, baseFontSize: 16, unit: "rem",
  variants: { "4xl": 56 },   // an explicit step that overrides the computed value
}
```

## Recipes and states

Recipes come in three tiers: a **recipe group** (`solid`) is a family; a **recipe**
(`brand`) is a named bundle of refs + `css` that resolves to a class; a **variant** (see
below) is an optional modifier delta layered on that recipe. A recipe is a `prop → value`
map; values may be refs to that subsystem's tokens or literal passthroughs. Add **states**
(validated against the adapter's known set) and `responsive[]` overrides:

```ts
colors: {
  recipes: {
    solid: {
      brand: {
        background: "brand",
        color: "brand.text",
        states: {
          hover:    { background: "brand.dark" },
          disabled: { background: "brand.lighter", color: "brand.dark" },
        },
        responsive: [
          { breakpoint: "md", query: "min", state: "hover", background: "brand.darker" }, // :hover inside @media
          { breakpoint: "lg", query: "min", target: "brand", background: "brand.dark" },   // self-scoped swap
        ],
      },
    },
  },
}
```

States and responsive entries flatten into one ordered `overrides` list internally; the
adapter renders each as the right selector (`:hover`, `[disabled]`, …) optionally wrapped
in `@media`. Unknown state names throw at build time.

### Variants — modifiers on a recipe

A recipe may carry an optional **`variants`** map of modifier deltas — DRY siblings that
share a base. Each variant desugars to a flat sibling recipe named `<recipe>-<variant>`
(`primary` + `sm` → `primary-sm`); the bare recipe still emits too. Opt-in and additive: a
recipe with no `variants` key is byte-identical to before. Works on **every** subsystem's
recipes (colors, typography, effects, borders, layout, components).

```ts
buttons: {
  primary: {                     // the recipe — its own props ARE the base
    colors: "solid.primary", typography: "button.large", borders: "box.default",
    css: { gap: "8px" },
    variants: {                  // modifiers on THIS recipe
      sm:      { typography: "button.small", css: { gap: "6px" } },
      flat:    { borders: null },  // ← `null` drops the inherited ref (see below)
    },
  },
}
// emits: buttons.primary, buttons.primary-sm, buttons.primary-flat
```

A variant delta merges onto the recipe's base field-by-field: a **ref/scalar** prop replaces
(delta wins); **`css`** shallow-merges by property; **`states`** merge by state name (a shared
state's declarations shallow-merge); **`responsive[]`** concatenates (delta appended). A prop
set to **`null`** is the removal sentinel — it drops an inherited ref (`borders: null`).
`null`, *not* `"none"`: `"none"` stays a real value (`border: none`, effects `"none"`, the
`radius.none` variant). A desugared `<recipe>-<variant>` that collides with an existing
sibling recipe throws at build time.

The axis is flat (variants don't nest), matching token variants. A responsive `variant:` /
`target:` on a recipe references a **sibling recipe** in the group — and because variants
desugar *into* group members, `target: "primary-sm"` resolves against the same pool. This is
the same pattern properties already use, where a `variants` map and a `responsive.variant` /
`target` coexist cleanly — one scope up.

**Layout structural generators.** Beyond `spacing`/`gutters`, layout has four generators
that also produce rule-sets:

```ts
layout: {
  columns: { size: 12, gutter: "compact", inset: "sm" },          // col-1…12 utility classes
  grids:   { cards: { templateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "xl" } },
  stacks:  { toolbar: { direction: "row", gap: "sm", responsive: [{ breakpoint: "sm", query: "max", direction: "column" }] } },
  container: { base: "fixed", inset: "lg", variants: { fluid: { base: "fluid", maxWidth: 1600 } } },
}
```

**Synthesized scales (§10.6).** `spacing`, `gutters` and `sizes` can generate their variant
ramp from a `base` + a curve — the same pattern as colours' tonal steps and typography's
modular scale — instead of hand-listing every rung. Opt-in and additive: no curve key ⇒
byte-identical to a hand-listed scale. Declare exactly one curve (both is an error):

```ts
// geometric — `ratio`; `steps` is an ordered name array, index = exponent (base × ratio^index)
spacing: { base: 8, ratio: 1.5, steps: ["xs", "sm", "md", "lg", "xl"] }
//   → xs 8 · sm 12 · md 18 · lg 27 · xl 40.5

// linear — `step`; `steps` is a name→multiplier map (step × multiplier)
spacing: { base: 4, step: 4, steps: { xs: 1, sm: 2, md: 3, lg: 4, xl: 6 } }
//   → xs 4 · sm 8 · md 12 · lg 16 · xl 24

// `steps` optional — default ladder xs sm md lg xl 2xl 3xl 4xl. Precision fixed at 4 decimals.
```

Each rung is stored as a **derived** `Ref` (`fn: "scaleStep"`, like colours — not a frozen
literal), so `override()` of the `base` re-synthesizes the whole ramp. A hand-authored
`variants` entry wins over the generated rung of the same name; the forced `none` stays on
`spacing`/`gutters` (not `sizes`); a pinned `%` (`full: "100%"`) has no magnitude, so it is
only ever an authored variant. A `responsive` entry carrying a `ratio`/`step` regenerates
the whole named scale at that breakpoint (`{ breakpoint: "sm", query: "max", ratio: 1 }`
flattens every step to the base on mobile). Rule of thumb: linear grid for spacing,
geometric ramp for sizes.

### Which variant or mode do I reach for?

Several mechanisms share the words "variant" and "mode." They do different jobs — pick by intent:

| I want to… | Reach for | Shape | Result |
| --- | --- | --- | --- |
| add a sibling **token** (a lighter brand) | **property `variants`** | `brand: { variants: { light: "#…" } }` | a new token `colors.brand.light` |
| add a **modifier** to a recipe (a small button) | **recipe `variants`** | `primary: { variants: { sm: {…} } }` | a class `.…-primary-sm` |
| **swap** which recipe applies at a breakpoint | responsive **`variant:`** | `responsive: [{ breakpoint:"lg", variant:"subtle" }]` | adopt a sibling recipe ≥ lg |
| flip a token for **dark mode** | **`modes`** | `surface: { modes: { dark: "#…" } }` | `@media`/`[data-theme]` redeclaration |
| build a whole **child theme** (white-label) | **`override()`** | `theme.override({ … })` | a separate child `Theme` |
| borrow a token from a **parent** theme | **`external`** | `brand: { external: "colors.brand" }` | `var(--…)`, not redefined |

The two that overlap most are `modes` (a value flips *in place* under a media/attribute query) and
`override()` (a *new theme object* with re-derived tokens and identical class names). Reach for
`modes` for light/dark on one theme; `override()` when you want a distinct theme to swap at runtime.

## Composition — the `components` subsystem

`components` owns no properties. Its recipes **reference** other subsystems' recipes and
add an own `css` delta. The output is an option-C class list: the referenced classes plus
one delta class for the component's own declarations.

The `css` delta is **literal-first** — it's raw CSS. A bare **string** or **number** is a
literal value; a **token reference** uses the `ref()` helper (or the JSON-safe `{ ref: "…" }`
object). See [Literals vs references](#literals-vs-references) for the one rule that governs
this everywhere. A `ref()` at an unknown token path fails loud at build time.

```ts
import { ref } from "@theme-registry/refract";

components: {
  recipes: {
    buttons: {
      primary: {
        colors: "solid.brand",        // reference another subsystem's recipe (composition field — always a ref)
        typography: "button.large",
        layout: "padding.button",
        effects: "surface.focusable",
        // own delta — raw CSS literals; mark the occasional token with ref():
        css: { color: ref("colors.brand.text"), cursor: "pointer", border: "none", display: "inline-flex" },
        states: { hover: { css: { transform: "translateY(-1px)" } } }, // own state, wins on conflict
      },
    },
  },
}
```

At build time, the `components` **emit mode** can flatten each variant into one
self-contained rule (see [`emit` modes](#emit-modes)).

## Globals — themed element rules

The `globals` subsystem styles **bare element selectors** (`a`, `h1`, `code`, …) — the CSS
"global styles" layer. It has two parts:

- **`preset`** — the normalization base: `"preflight"` (opinionated, token-first strip),
  `"normalize"` (light cross-browser fixes), `"reset"` (aggressive classic reset), or
  `false` (none). `preflight` / `reset` also seed a default `h1`–`h6` → type-scale map. The
  preset renders at zero specificity (`:where(sel)`), so it never fights your styles, and its
  default headings **drop opportunistically** — a theme with no generated `fontSize` scale
  simply omits them. The key is `preset` (not `reset`) so `preset: "reset"` reads cleanly.
- **`elements`** — your themed element rules. Each selector maps to a recipe-item: flat
  declarations plus the `states` / `responsive` / `variants` axes. Leaves are **literal-first**,
  the same grammar as a component `css` delta (bare string / number → literal, `ref("…")` /
  `{ ref: "…" }` → token reference; see [Literals vs references](#literals-vs-references));
  cross-subsystem composition refs are **not** allowed — these are flat declarations bound to a
  selector. A `ref()` at an unknown token fails loud at build time.

```ts
import { ref } from "@theme-registry/refract";

globals: {
  preset: "preflight",
  elements: {
    a: {
      color: ref("colors.link"),                  // token ref → var(--…) / theme read
      textDecoration: "underline",                 // literal (raw CSS)
      states: { hover: { color: ref("colors.link.dark") } },
      responsive: [{ breakpoint: "md", query: "min", fontSize: ref("typography.fontSize.lg") }],
      variants: { subtle: { color: ref("colors.muted") } }, // a delta-only modifier
    },
  },
}
```

Element rules render at a **higher tier than the preset** but below your minted component
classes: the base is a bare `a { … }` (specificity `0,0,1`) — it beats the `:where()` reset
but loses to a recipe class. A **variant** is a delta-only modifier the adapter scopes to a
higher-specificity selector — the CSS adapter as a self-scoped class (`a.subtle`), the
styled-components / SCSS adapters as a nested `&.subtle` — so `<a class="subtle">` wins over
the base. There is **no `modes` axis**: light/dark rides the *referenced token's* own modes,
so an `a` that refs `colors.link` flips automatically wherever that token defines a `dark` mode.

`h1`–`h6` you don't author keep the preset's default scale binding; author `elements.h1` and
your rule takes over (and can add states / responsive / variants like any element).

## Extending a published theme — external tokens

To add styles on top of a theme you don't own — reusing its colours, spacing, and so on
without redefining them — declare the borrowed tokens as **external**. An external token is a
passthrough to a CSS variable the *parent* theme already emits: it's referenceable everywhere
in your theme, but never defined locally and never tonally derived.

```ts
extends: { prefix: "dt" },                     // the parent theme's variable prefix
colors: {
  brand:   { external: "colors.brand" },       // path form → var(--dt-colors-brand)
  surface: { external: "--mat-sys-surface" },  // literal form (leading --) → var(--mat-sys-surface)
  accent:  "#e64980",                          // your own new token, defined normally
  recipes: { solid: { cta: { background: "brand", color: "accent" } } }, // reference either
}
```

- **Path form** (`"colors.brand"`) assumes the parent uses refract's default naming; `extends.prefix`
  supplies its prefix — any string, including `""` for an unprefixed parent (`--colors-brand`).
- **Literal form** (`"--anything"`, leading `--`) points at *any* CSS variable verbatim — a parent
  built by Material, Tailwind, Chakra, or by hand. No prefix assumed.
- `resolveToken("colors.brand")` yields `"var(--dt-colors-brand)"`; the CSS adapter emits no `:root`
  definition for it; it survives `override()` unchanged.

Best for individual tokens (colours, type, effects, borders, motion). For a one-off reference at a
single declaration site you can also inline a raw variable: `css: { color: "var(--dt-colors-brand)" }`
(a bare string in a `css` block is a literal, so this passes straight through). Borrowing from two
prefixed systems at once (named sources) is on the roadmap.

## Choosing an adapter

`createTheme(raw, { adapter })` requires an adapter. Each first-party adapter is its own
package (install the core plus the one(s) you need); each takes optional options at
construction:

```ts
import { createTheme } from "@theme-registry/refract";
import { createCssAdapter } from "@theme-registry/refract-css";
import { createStyledComponentsAdapter } from "@theme-registry/refract-styled-components";
import { createJsonAdapter } from "@theme-registry/refract-json";
import { createScssAdapter } from "@theme-registry/refract-scss";

createTheme(raw, { adapter: createCssAdapter({ prefix: "mfe", inline: false }) });
```

Common CSS adapter options: `prefix` (variable names — and micro-frontend isolation: give
each bundle a distinct prefix), `classPrefix` (class names, defaults to `prefix`), `inline`
(bake resolved values instead of `var(--…)`), and `length` (px/rem for numeric values). See
**[The CSS adapter](./css-adapter.md)** for the full options reference with examples.

**Dropping into a page you don't own** — two opt-in options make refract safe next to app CSS:

```ts
createCssAdapter({
  layer: true,          // wrap all output in `@layer refract { … }` (or a custom name) — refract's
                        //   rules sit deterministically below your unlayered CSS, whatever the load order
  reducedMotion: true,  // append a `@media (prefers-reduced-motion: reduce)` block that kills motion
});
```

Both default off (byte-identical output) and apply to single-file emit + the runtime `theme.css`.
`layer` is also available on the SCSS adapter. (`layer` throws if combined with a multi-file
`emit` mode — it targets one self-contained document.)

## The runtime theme

### Build-time or runtime — pick your deployment

refract runs the same pipeline two ways, and they suit different apps:

- **Build-time emit** (`refract build` → static `.css` / `.ts`) — refract runs at build and
  **leaves the bundle entirely**; you ship plain artifacts. No live `override()`, no per-request
  themes. Best for a single-brand site or a design system's published output.
- **Runtime compile** (`createTheme(...)` in the app) — the Model is built in-process, so live
  `override()`, user-editable and per-request themes work; the trade is that refract's compile code
  ships with your app and a theme swap re-injects the stylesheet.

Most apps want build-time. Reach for runtime when theming is *dynamic* (white-label per tenant,
user-chosen themes, live editing). You can also do both: ship the default theme as precompiled CSS
and only load the runtime on the surface that actually re-themes.

`createTheme` returns a `Theme`. The **format-neutral** surface is always present; the
**adapter** attaches its format-specific helpers via `extend`:

```ts
// Format-neutral (core):
theme.model;                          // the ThemeModel — the source of truth
theme.tokens;                         // flat path → Ref map (aliases/derivations kept as refs)
theme.resolveToken("colors.brand.dark"); // → "#3b5bdb" (follows aliases, runs derivations)
theme.override(partial);              // a child theme (see below)

// CSS adapter (via extend):
theme.css;                            // the full stylesheet (:root vars + rules)
theme.variablesCss;                   // just the :root variable blocks
theme.recipesCss;                     // just the class rules
theme.classes;                        // recipe → className map
theme.media;                          // breakpoints → @media builder
theme.renderRecipe("colors", "solid", "brand"); // one recipe's CSS on demand
```

The **styled-components** adapter is SC-native: it emits **TS/JS modules**, not a
stylesheet, so its `extend` attaches a different surface — the same shapes its `emit()`
writes, but live and lazy:

```ts
// styled-components adapter (via extend):
theme.theme;      // the LITERAL theme object → <ThemeProvider theme={theme.theme}>
theme.recipes;    // recipes.<sub>.<group>.<variant> — a lazy css block, lowered on first access
theme.GlobalStyle; // the globals subsystem as a createGlobalStyle (present iff the raw defines `globals`)
theme.media;      // breakpoints → SC tagged-templates (theme.media.md.min`…`)
theme.scheme;     // prefers-color-scheme tagged-templates (present iff modes exist)

const Button = styled.button`${theme.recipes.components.buttons.primary}`;
```

Values read straight from the theme (`${({ theme }) => theme.colors.primary}`) — no
`var()`, no CSS variables. Dark mode (§ appearance modes) lives *inside* each recipe as a
`theme.scheme.dark` / `[data-theme]` block, so it tree-shakes with the recipe and switches
with a plain CSS recalc — a single `ThemeProvider`, never swapped. See
**[The styled-components emit](#the-styled-components-emit)** below for the `emit()` shape
and its options.

## Deriving child themes with `override`

`theme.override(partial)` immutably merges a partial raw theme into the Model and returns
a **new** child theme — the parent is untouched, so you can derive siblings:

```ts
// A base-only palette auto-derives its steps, so overriding the base re-derives them:
const base  = createTheme({ colors: { brand: { base: "#4c6ef5" } } }, { adapter: createCssAdapter() });
const night = base.override({ colors: { brand: { base: "#1c2333" } } });

base.resolveToken("colors.brand.dark");  // "#3d58c4" — derived from #4c6ef5; parent untouched
night.resolveToken("colors.brand.dark"); // "#161c29" — re-derived from the new base
```

Only the partial's subsystem slices are re-normalized. Overriding a color base
re-derives its synthesized steps for free (an explicitly authored `variants.dark`,
by contrast, is replaced only if the override supplies a new one).

### Scoped & nested theming

Dark mode via `modes` re-declares variables under `@media (prefers-color-scheme)` **or** a
`[data-theme]` attribute (`scheme: "attribute" | "both"`). Because it's an attribute selector,
that scope isn't limited to the root — put `data-theme="dark"` on **any** element to theme a
subtree, so a dark island can live inside a light page:

```html
<body>                        <!-- light -->
  <aside data-theme="dark">…</aside>   <!-- this subtree reads the dark values -->
</body>
```

The variables cascade, so nesting works too (a `light` island inside a `dark` region). Use
`scheme: "both"` to follow the OS by default *and* let a manual `[data-theme]` toggle override it.

## Build to disk

Scaffold and build with the `refract` CLI:

```bash
npx refract init            # writes theme.config.(ts|js|mjs); --js / --mjs / --force
npx refract import t.json   # seed theme.raw.ts (+ config) from a DTCG tokens.json; --out / --raw-only / --force
                            #   --breakpoint-group <name> / --breakpoints <n:px,…>
npx refract build           # --config <path> --target <name|index> --out <dir>
npx refract tokens          # --config <path> --out <file>  (DTCG export, adapter-free)
npx refract audit           # score colour contrast (WCAG + APCA); --strict / --min-wcag <AA|AAA|AA-large> / --large
npx refract skills install  # install the bundled AI skills into your agent (claude/codex/…)
```

The `refract skills <install|list|update>` command wires refract's catalog of AI skills
into your coding agent, version-locked to the installed package. **claude** gets native
per-skill files at `.claude/skills/`; the agents-md family (codex / opencode /
github-copilot / cursor / generic) gets a router in its own instructions file plus
on-demand bodies under `.refract/skills/`. Flags: `--agent <a,b|all>`,
`--global | --local` (default local), `--only <names>`, `--optional` (include the opt-in
tier; twelve core skills install by default).

`theme.config.ts` is your own code. Author the raw theme in a sibling **typed** file —
the build graph-compiles the config together with its relative `.ts` imports, so an
extensionless `import { raw } from "./theme.raw"` resolves:

```ts
// theme.raw.ts
import type { RawTheme } from "@theme-registry/refract/build";
export const raw = { /* … */ } satisfies RawTheme;

// theme.config.ts
import { defineConfig } from "@theme-registry/refract/build";
import { createCssAdapter } from "@theme-registry/refract-css";
import { createStyledComponentsAdapter } from "@theme-registry/refract-styled-components";
import { raw } from "./theme.raw";

export default defineConfig({
  raw,
  targets: [
    { name: "css", adapter: createCssAdapter(), outDir: "dist/theme", helpers: ["color-math"] },
    { name: "sc",  adapter: createStyledComponentsAdapter(), outDir: "dist/theme-sc" },
  ],
});
```

Each target names an adapter, an `outDir`, and an optional `emit`. `refract build`
builds the theme once and writes every target's files. `helpers` vendors self-contained
runtime helpers (e.g. `color-math` for live `lighten`/`darken`).

Set `guide: true` (or `guide: { packageName: "@acme/theme" }`) on a target to also emit a
self-documenting `llms.txt` + `manifest.json` into its `outDir` — they name the theme's
**real** class names / export ids / token paths (adapter-specialized prose), so a downstream
dev or coding agent can consume the theme from the folder alone with no refract and no skills.
The files sit inside `outDir`, so they travel with the theme however it ships (package / zip /
vendored). Off by default — a build with no `guide` is byte-identical.

```ts
{ name: "css", adapter: createCssAdapter(), outDir: "dist/theme", guide: true }
```

### Regression-testing the emitted output

The emit is deterministic — the same theme always produces byte-identical output — so a snapshot
test catches unintended CSS changes. Build in-memory and snapshot the string:

```ts
import { expect, it } from "vitest";
import { createTheme } from "@theme-registry/refract";
import { createCssAdapter } from "@theme-registry/refract-css";

it("emits stable CSS", () => {
  const theme = createTheme(raw, { adapter: createCssAdapter() }) as { css: string };
  expect(theme.css).toMatchSnapshot();
});
```

Any change to a token, recipe, or synthesis rule shows up as a reviewable diff — the same
byte-identical-goldens discipline refract uses on itself.

## `emit` modes

`emit` (per target) picks the output shape. The vocabulary is shared; **each adapter
decides which modes it honors** — the modes below are the CSS adapter's:

```ts
{ emit: "single" }                                  // or omit — one theme.css
{ emit: { type: "single", file: "app.css" } }       // rename
{ emit: { type: "split", file: "styles.css", variables: "variables.css" } }
{ emit: { type: "subsystem" } }                      // colors.css + colors.variables.css, …
{ emit: { type: "components", inline: true } }       // flattened, self-contained, baked values
{ emit: { type: "components", inline: false, variables: "variables.css" } } // var(--…) + tree-shaken vars
```

| Mode | Files | Notes |
| --- | --- | --- |
| `single` | `theme.css` | everything; the default. Global `inline` bakes values whole-file |
| `split` | `styles.css` + `variables.css` | load `variables.css` first — **no `@import`** |
| `subsystem` | `<sub>.css` + `<sub>.variables.css` per subsystem | `components` emits styles only |
| `components` | one file per component variant | `inline: true` → zero `var(`; `inline: false` → `var(--…)` + a `variables.css` tree-shaken to only referenced tokens (`variables: false` suppresses). Filenames colliding are bundled into one file |

An adapter throws a clear error for a mode it doesn't support (e.g. `split` + global
`inline`, which would leave no variables to split out).

### Portability & the exit ramp

Be clear-eyed about what travels. Your **tokens** are portable everywhere — `toDTCG(theme)` (or
`refract build`'s DTCG target) walks the flat token map into a standard DTCG document any tool
reads. Your **composition** — recipes, states, responsive swaps, components — is refract-shaped;
nothing else consumes it directly. That's the honest trade: refract owns the synthesis and
composition layer, and that layer is where the value is.

So there's a documented **exit**: `emit: { type: "components", inline: true }` flattens every
component variant into one self-contained CSS rule with baked values and zero `var(--…)` — plain,
dependency-free CSS you can lift out and keep working, with no refract at runtime. Leaving is a
supported build target, not a rewrite.

## The styled-components emit

The styled-components adapter emits **TypeScript/JavaScript modules**, not a stylesheet —
a category the CSS adapter already covers. `emit()` writes:

- **`theme.ts`** — the literal `theme` object (`export const theme = { … } as const`), the
  flat, tree-shakeable `css` recipe consts (`componentsButtonsPrimary`), and a grouped
  `recipes` barrel referencing them. If the raw defines `globals`, a `GlobalStyle` too.
- **`media.ts`** (always) / **`scheme.ts`** (iff appearance modes ride
  `prefers-color-scheme`) — vendored tagged templates with this theme's concrete `@media`
  strings baked in (only dependency: `styled-components`).
- **`theme.d.ts`** (iff `language: "ts"`) — augments styled-components' `DefaultTheme` from
  `typeof theme`, so `props.theme.…` is typed and autocompleted.
- **`color-math.ts`** (iff `helpers: ["color-math"]`) — the shared vendored helpers.

```ts
import { theme, GlobalStyle, componentsButtonsPrimary } from "./theme";
const Book = styled.button`${componentsButtonsPrimary}`;
// <ThemeProvider theme={theme}><GlobalStyle /><Book/></ThemeProvider>
```

A recipe carries its **states**, **breakpoints** and **dark mode** as nested blocks — every
value still read from the theme (breakpoints off `theme.media.<bp>.{min,max,exact,between}`,
dark off `theme.scheme.dark` reading `theme.modes.dark.*`):

```ts
export const colorsSolidPrimary = css`
  background: ${({ theme }) => theme.colors.primary};
  ${({ theme }) => theme.media.md.min`background: ${theme.colors.primaryDark};`}       // responsive → @media (min-width: 768px)
  &:hover { background: ${({ theme }) => theme.colors.primaryDark}; }                  // state
  ${({ theme }) => theme.scheme.dark`background: ${theme.modes.dark.colors.primary};`} // dark (scheme:"attribute" → [data-theme="dark"] &)
`;
```

Composition is a `css` spread of the referenced siblings plus the component's own delta, so
importing one button pulls exactly the recipes it composes. Options:

| Option | Values | Default | Effect |
| --- | --- | --- | --- |
| `language` | `"ts" \| "js"` | `"ts"` | `ts` also emits `theme.d.ts` |
| `emit` (target) | `"single" \| "split"` | `"single"` | one module, or `theme.ts` / `recipes.ts` / `global.ts` split (ES modules tree-shake per export, so the CSS adapter's `subsystem`/`components` modes are neither needed nor supported) |
| `scheme` | `"media" \| "attribute" \| "both"` | `"media"` | how modes realize dark: `@media (prefers-color-scheme)`, a `[data-theme]` toggle, or both |
| `helpers` | `string[]` | `[]` | `["color-math"]` wires the `lighten`/`darken`/`alpha` import and surfaces them on `theme` |

The **same renderer** backs the runtime: `createTheme(raw, { adapter })` returns the identical
shapes (`theme` · `recipes` · `GlobalStyle` · `media` · `scheme`), but each recipe is lowered
to a live `css` block on first access and cached — reach for runtime for dynamic / white-label
themes and `override()`; reach for `emit()` to ship, tree-shake, and drop refract.

## DTCG interop

The `./dtcg` subpath round-trips the W3C DTCG `tokens.json` format — property tokens only,
independent of any adapter:

```ts
import { fromDTCG, toDTCG } from "@theme-registry/refract/dtcg";

const raw = fromDTCG(designTokensJson);   // DTCG document → createTheme raw input
const doc = toDTCG(createTheme(raw, { adapter: createCssAdapter() })); // theme.tokens → DTCG document
```

`refract tokens` is the CLI wrapper around `toDTCG` — it reads only the config's `raw`,
so it needs no adapter.

**Recipe round-trip (opt-in).** DTCG has no component model, so recipes are out of standard scope.
For a lossless `refract → DTCG → refract` trip, `toDTCG(theme, { includeRecipes: true })` stashes the
rule-set IR under a reverse-DNS `$extensions` key (`com.theme-registry.refract`, versioned), and
`fromDTCGTheme(doc, { adapter })` restores property tokens **and** recipes in one call. It's
refract-specific — other tools ignore the extension — and off by default (byte-identical output).

## Auditing contrast

Colours are the flagship, so refract can score them. `audit(theme)` (and the `refract audit` CLI)
checks every palette `base`↔`text` and recipe fg↔bg pairing (all subsystems, incl. `:hover`) against
**WCAG 2** contrast, with an advisory **APCA** Lc. It *reports* — it never rewrites a colour; a
non-derivable side (`transparent`, a `var()`, a keyword) is `skipped`.

```ts
import { audit } from "@theme-registry/refract";
const { pairings, summary, ok } = audit(theme, { minWcag: "AA" }); // strict:true throws on failure
```

`refract audit --strict` fails the build (exit 1); WCAG levels are `AAA` ≥ 7, `AA` ≥ 4.5, `AA-large`
≥ 3. APCA is advisory — reported, never gated.

## Errors carry stable codes

Every authoring/build error is a **`RefractError`** with a machine-readable `code`
(`REFRACT_E_COLOR_INPUT`, `REFRACT_E_STEPS`, `REFRACT_E_NAMING`, …) you can branch on. Post-build
reference validation **collects every failure** and throws them at once as `REFRACT_E_VALIDATION` —
`err.failures` lists them all, so you fix them in a single pass rather than one build at a time.

```ts
import { RefractError } from "@theme-registry/refract";
try { createTheme(raw, { adapter }); }
catch (e) { if (e instanceof RefractError) console.error(e.code, e.failures ?? e.message); }
```
