# @theme-registry/refract

[![CI](https://github.com/theme-registry/refract/actions/workflows/ci.yml/badge.svg)](https://github.com/theme-registry/refract/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@theme-registry/refract)](https://www.npmjs.com/package/@theme-registry/refract)
[![license](https://img.shields.io/npm/l/@theme-registry/refract)](LICENSE)

**649 tests · 5 CI gates · six gzip-budgeted packages (core ≤30 KB).** Quality signals are drift-gated and surfaced on the [status page](https://theme-registry.github.io/refract/status).

A framework-agnostic design-token toolkit. You author one **raw theme**; refract
compiles it into a single, format-neutral **Model** and lowers that Model to whatever
output you need through an **adapter** — CSS custom properties, styled-components,
SCSS `$variables`, or plain JSON. One source of truth, many targets.

```
raw theme ──▶ Model (format-neutral) ──▶ adapter ──▶ CSS │ styled-components │ SCSS │ JSON
```

> **Status: pre-release (`0.x`).** Published on npm as `@theme-registry/refract` (with its adapter and
> MCP packages) in a single lockstep `fixed` group. Pin exact versions through `0.x`; see
> [Versioning](#versioning).

## Background

refract didn't start as a library. It started as the infrastructure behind a **flagship site and ~130
sister sites** that shared one administration and one foundation — each differing in little more than its
colour palette and logo, none allowed to drift in look and feel. The frontends were Next.js +
styled-components on a shared CMS-backed admin, templates loaded lazily, one style-guide driving them
all. That pattern — **one base theme, many brands, override only what's yours** — went on to run a
multi-brand media group, a pan-European NGO network, and a multi-identity civic institution.

Those estates ran on a UI-focused theme registry (previously shipped under an earlier npm scope, now
consolidating under `@theme-registry`): a main theme plus child themes that override whatever they need,
consumed at runtime or as a prebuilt library. What it never standardized were the **foundations** — the
layout system (grids, columns, spacing), the media/breakpoint model, and colour/type synthesis — solved
well but ad-hoc, project by project. refract is those foundations, taken from what actually worked, made
solid and **format-neutral**, and made to **show their work** (blast-radius `diff`, WCAG `audit`) before
anything ships. **The idea has the better part of a decade of production behind it; the package itself is
new** — a clean, standardized rewrite that earns its own miles (see the test suite, size budgets, and
[status](https://theme-registry.github.io/refract/status)).

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
versions** until `1.0`, when the group splits into independent lines. Release history:
**[CHANGELOG.md](CHANGELOG.md)** · mechanics + policy: **[RELEASING.md](RELEASING.md)**.

**Token paths are stable identifiers.** A token path (`colors.brand.dark`) is treated as public API —
it won't change or disappear within a minor/patch release, so agents, the `guide` manifest (`schema`-
versioned), and DTCG round-trips can bind to it. Removals/renames are breaking (major) changes.

## Install

```bash
npm install @theme-registry/refract
```

`styled-components` and `typescript` are **optional** peers — only needed if you use the
styled-components adapter or the `.ts` build config, respectively.

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
Full field-by-field walkthrough: **[docs/authoring.md](docs/authoring.md)**.

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
**[docs/extending.md](docs/extending.md)** or run the `adapter-scaffold` skill.

## Build to disk (CLI)

```bash
npx refract init      # scaffold a theme.config.(ts|js|mjs)
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

- **[docs/authoring.md](docs/authoring.md)** — author a theme + consume its output (the user guide).
- **[docs/extending.md](docs/extending.md)** — write a subsystem or an adapter against the frozen contract.
- **[AGENTS.md](AGENTS.md)** — orientation for AI coding agents.

## License

MIT © Petyo Stoyanov
