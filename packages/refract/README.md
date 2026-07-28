# @theme-registry/refract

[![CI](https://github.com/theme-registry/refract/actions/workflows/ci.yml/badge.svg)](https://github.com/theme-registry/refract/actions/workflows/ci.yml)

A framework-agnostic design-token toolkit. You author one **raw theme**; refract
compiles it into a single, format-neutral **Model** and lowers that Model to whatever
output you need through an **adapter** — CSS custom properties, styled-components,
SCSS `$variables`, or plain JSON. One source of truth, many targets.

```
raw theme ──▶ Model (format-neutral) ──▶ adapter ──▶ CSS │ styled-components │ SCSS │ JSON
```

> **Status: `0.x` (pinned).** Published on npm as `@theme-registry/refract`. Pin exact versions
> through `0.x`. **Docs, live playground & API reference:** <https://theme-registry.github.io/refract/>

## Stability

| Surface | Package | Tier |
| --- | --- | --- |
| Core + CLI (incl. DTCG interop at `/dtcg`) | `@theme-registry/refract` | **Stable** |
| CSS adapter | `@theme-registry/refract-css` | **Stable** |
| styled-components adapter | `@theme-registry/refract-styled-components` | **Stable** |
| MCP server (agent query surface) | `@theme-registry/refract-mcp` | **Stable** |
| SCSS adapter | `@theme-registry/refract-scss` | Experimental |
| JSON adapter | `@theme-registry/refract-json` | Experimental |

**Stable** — breaking changes are deliberate, announced events. **Experimental** — the shape may
still change; these adapters are reachable via the npm `experimental` dist-tag.

## Versioning

All packages share **one lockstep version** through the `0.x` line (a Changesets `fixed` group) and
publish together. Tiers are signalled by npm dist-tag, not by divergent versions. **Pin exact
versions** until `1.0`, when the group splits into independent lines. Details: **[RELEASING.md](RELEASING.md)**.

**Token paths are stable identifiers.** A token path (`colors.brand.dark`) is treated as public API —
it won't change or disappear within a minor/patch release, so agents, the `guide` manifest (`schema`-
versioned), and DTCG round-trips can bind to it. Removals/renames are breaking (major) changes.

## Install

```bash
npm install @theme-registry/refract
```

`styled-components` and `typescript` are **optional** peers — only needed if you use the
styled-components adapter or the `.ts` build config, respectively. Install typescript as
**`typescript@5`**: a bare `npm i -D typescript` now resolves to 7.x, the native port, whose main
entry exports only a version string — the compiler API a `.ts` config is transpiled with sits behind
its `./unstable/*` subpaths. A `.mjs` or `.js` config never loads typescript at all.

## Scaffold a theme

Don't start from a blank file. One seed colour becomes a full theme — palettes with tonal ladders,
semantic colours, a type scale with derived leading, a spacing ramp — with every colour checked
against **WCAG contrast before the file is written**:

```bash
npx refract create                 # in an existing project → theme.raw.ts
npm create refract-theme my-theme  # from nothing → a publishable theme package
```

The generator runs **once**; what it writes is an ordinary theme file you own and edit. It emits
**tokens only** — no recipes, so nothing composes into a class list yet. That's the next step, and
it's design work: see [Recipes](https://theme-registry.github.io/refract/r-recipes).

## Quick start

`createTheme(raw, { adapter })` builds the theme. The `adapter` is **required** — core
ships no default, which is what keeps it format-neutral.

```ts
import { createTheme } from "@theme-registry/refract";
import { createCssAdapter } from "@theme-registry/refract-css"; // adapters are separate packages

const theme = createTheme(
  {
    breakpoints: { sm: 576, md: 768, lg: 1024 },
    colors: {
      brand: { base: "#4c6ef5", text: "#ffffff" },   // → brand, brand.text, brand.light/dark/…
      recipes: {
        solid: { brand: { background: "brand", color: "brand.text" } },
      },
    },
  },
  { adapter: createCssAdapter() },
);

theme.css;                       // the full stylesheet (:root vars + .classes)
theme.tokens["colors.brand"];    // { ref?: string, value?: … } — the flat token map
theme.resolveToken("colors.brand.dark"); // "#3d58c4" — derived step (follows aliases + runs derivations)
theme.classes;                   // recipe → className map
```

Swap the adapter, keep the raw theme:

```ts
import { createScssAdapter } from "@theme-registry/refract-scss"; // each adapter is its own package
const scss = createTheme(raw, { adapter: createScssAdapter() }); // scss.scss → $variables + classes
```

## Authoring the raw theme

The raw theme is the file you live in. It is one key per **subsystem**, each with
properties and an optional nested `recipes` block:

```ts
import type { RawTheme } from "@theme-registry/refract/build";

const raw = {
  breakpoints: { sm: 576, md: 768, lg: 1024 },

  colors:     { /* palettes: hex | { base, text, variants, steps, responsive } + recipes */ },
  typography: { /* fontFamily/Size/Weight/lineHeight/… (modular scale) + recipes */ },
  effects:    { /* radius/shadow/transitions/opacity/zIndex/blur/… + recipes */ },
  layout:     { /* spacing/gutters + columns/grids/stacks/container + recipes */ },
  components: { /* composition-only: recipes that reference other subsystems' recipes */ },
} satisfies RawTheme;
```

Property values can be **literals** (`"#4c6ef5"`, `16`), **references** to other tokens
(`color: "brand.text"`), and carry **responsive / variant / target** overrides keyed on
your breakpoints. Recipes group reusable rule-sets with **states** (`hover`, `disabled`, …).
Full field-by-field walkthrough: **[docs/authoring.md](https://github.com/theme-registry/refract/blob/main/docs/authoring.md)**.

## Adapters — the multi-format thesis

Every adapter consumes the same Model and decides how to realize it. Four ship in-box:

Core ships **zero** adapters; each is its own installable package (`npm i @theme-registry/refract-<name>`).

| Adapter | Package | Output | Notes |
| --- | --- | --- | --- |
| **CSS** | `@theme-registry/refract-css` | `:root` custom properties + classes | the batteries-included default |
| **styled-components** | `@theme-registry/refract-styled-components` | `css` blocks + `createGlobalStyle` + `theme.media` | needs the `styled-components` peer |
| **SCSS** | `@theme-registry/refract-scss` | compile-time `$variables` + classes from Sass | `TUnit = string`, a genuinely distinct format |
| **JSON** | `@theme-registry/refract-json` | the full Model as address-keyed data | `TUnit = object` — proves the contract is format-generic |

Write your own with `defineAdapter(spec)` — you fill four primitives (`recipeName`,
`renderRecipe`, `renderVariables`, `join`) and core supplies the rest. See
**[docs/extending.md](https://github.com/theme-registry/refract/blob/main/docs/extending.md)** or run the `adapter-scaffold` skill.

## Build to disk (CLI)

```bash
npx refract create    # design a theme.raw.(ts|js|json) from one seed colour
npx refract init      # scaffold a theme.config.(ts|js|mjs) — imports theme.raw.* if present
npx refract build     # load the config → write every target's files to its outDir
npx refract tokens    # export theme.tokens as a DTCG tokens.json (adapter-free)
```

`theme.config.ts` is your code — it imports the adapters (and the raw theme) it wants:

```ts
import { defineConfig } from "@theme-registry/refract/build";
import { createCssAdapter } from "@theme-registry/refract-css";
import { raw } from "./theme.raw"; // a native, RawTheme-typed sibling .ts (graph-compiled)

export default defineConfig({
  raw,
  targets: [
    { name: "css", adapter: createCssAdapter(), outDir: "dist/theme" },
    { name: "split", adapter: createCssAdapter(), outDir: "dist/split", emit: { type: "split" } },
  ],
});
```

### `emit` — how output is written

Each target's `emit` picks the output shape (CSS adapter):

| Mode | Result |
| --- | --- |
| `single` (default) | one `theme.css` — all `:root` vars + all rules |
| `split` | `styles.css` + `variables.css` (load-order contract, no `@import`) |
| `subsystem` | a styles+variables pair per subsystem (`colors.css`, `colors.variables.css`, …) |
| `components` | each component variant flattened into one self-contained file (`inline: true` bakes values; `inline: false` emits `var(--…)` + a tree-shaken `variables.css`) |

### `preview` — see what you built

Set `preview: true` on any target and `refract build` also writes a `preview.html` into its
`outDir`: a rendered specimen you double-click, forward, or hand a designer. It inlines its
stylesheets by default, so the page is one self-contained file that survives being moved.

```ts
{ name: "css", adapter: createCssAdapter(), outDir: "dist/theme", preview: true }
```

It reads as a style guide, not a token dump: a sticky section rail, colour families as contiguous
ladders with live WCAG contrast readouts on each `text` pairing, the type ramp set in its own sizes,
spacing shown as a measure *and* as an applied inset, a **state matrix** per recipe, and a
copy-on-click identifier beside every specimen. Sections appear only when the theme has tokens of
that kind.

Token plates render from the format-neutral token export, so **every** adapter gets them. Live
recipe plates additionally need output a browser can load as-is, which today means CSS; an
SCSS/styled-components/JSON target still renders every token and names every recipe, and says why it
can't render them live. (For a live design-review page from an SC or SCSS theme, add a CSS target to
the same config — same recipes, same core.)

Three things only a compiler's specimen sheet can show: **states** side by side (a CSS pseudo-class
can't be triggered from markup, so the adapter emits a parallel pinnable rule that is inlined into
the page and never added to the stylesheet you ship), an **appearance-mode diff** of the tokens that
actually carry an override, and **composition** broken into its parts — each class in a component's
identity attributed to the recipe it came from. Bare elements themed by the `globals` subsystem get
their own prose specimen, since they carry no class at all. Off by default.

Its machine-facing sibling is `guide: true`, which writes an `llms.txt` + `manifest.json`
consumption guide into the same folder.

## DTCG round-trip

The `./dtcg` subpath reads/writes the W3C Design Token Community Group `tokens.json`
format, so a theme round-trips through Figma / Style Dictionary / other DTCG tooling.
It is data-interchange, **not** an output adapter — property tokens only.

```ts
import { fromDTCG, toDTCG } from "@theme-registry/refract/dtcg";

const raw   = fromDTCG(designTokensJson);        // DTCG document → createTheme raw input
const doc   = toDTCG(theme);                     // built theme's tokens → DTCG document
```

## Package entry points

| Subpath | Contents |
| --- | --- |
| `@theme-registry/refract` | `createTheme`, `createCssAdapter`, `createStyledComponentsAdapter`, `defineAdapter`, the Model/adapter types, subsystem descriptors |
| `…/css` · `…/styled-components` · `…/json` · `…/scss` | each adapter's factory + types, as its own bundle |
| `…/dtcg` | `fromDTCG` / `toDTCG` / `parseDTCGDocument` (pure, no runtime adapter graph) |
| `…/build` | `defineConfig`, `emitTheme`, the `RawTheme` authoring types, the `Emit` vocabulary (Node-only) |

## Documentation

- **[docs/authoring.md](https://github.com/theme-registry/refract/blob/main/docs/authoring.md)** — author a theme + consume its output (the user guide).
- **[docs/extending.md](https://github.com/theme-registry/refract/blob/main/docs/extending.md)** — write a subsystem or an adapter against the frozen contract.
- **[AGENTS.md](AGENTS.md)** — orientation for AI coding agents.

## License

MIT © Petyo Stoyanov
