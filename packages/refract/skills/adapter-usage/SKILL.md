---
name: adapter-usage
description: Choose a refract output adapter and use its call surface — CSS, SCSS, styled-components, or JSON, each a separate installable package. Use when deciding which format to emit, wiring createTheme with an adapter, or installing the adapter package. Triggers: "which adapter", "createTheme adapter", "CSS vs styled-components", "install refract-css", "adapter options / prefix / colorFormat / scheme".
tier: core
---

# Adapter usage

Core (`@theme-registry/refract`) ships **zero adapters** — that's what keeps it format-neutral.
Each adapter is a **separate package** you install alongside core. Pick by target format, then
pass a constructed adapter to `createTheme`.

## Which adapter

| Package | Factory | Emits | Choose it when |
|---|---|---|---|
| `@theme-registry/refract-css` | `createCssAdapter` | `:root` custom properties + recipe classes, `@media`/`@container`/`@keyframes` | Default. Framework-agnostic; runtime theming by swapping `:root`; MFE isolation via `prefix`. |
| `@theme-registry/refract-styled-components` | `createStyledComponentsAdapter` | TS/JS modules (literal `theme` object + tree-shakeable `css` recipes + `GlobalStyle`) | React apps on styled-components ^6. No `var()`; dark lives in each recipe so it tree-shakes. |
| `@theme-registry/refract-scss` | `createScssAdapter` | Sass `$variables` + `@use` partials + mixins/classes | A Sass build wanting compile-time `$variables`. |
| `@theme-registry/refract-json` | `createJsonAdapter` | The full model as address-keyed JSON (refs kept beside resolved values) | Data-interchange, tooling, or feeding a non-CSS consumer. |

If the format you need has no adapter, you can write one — see the opt-in **adapter-scaffold**
guide (build a standalone adapter against the public `defineAdapter` contract).

## Install the package you picked

Add core **and** the chosen adapter (detect the package manager from the lockfile):

```
npm i @theme-registry/refract @theme-registry/refract-css
# styled-components target also needs the peer:
npm i @theme-registry/refract-styled-components styled-components
```

## Call surface

`createTheme(raw, { adapter })` — `adapter` is **required**. Returns a `Theme` with the
format-neutral surface (`model`, `tokens`, `resolveToken(path)`, `override(partial)`), plus
whatever the adapter attaches via `extend()`:

```ts
import { createTheme } from "@theme-registry/refract";
import { createCssAdapter } from "@theme-registry/refract-css";

const theme = createTheme(raw, { adapter: createCssAdapter({ prefix: "acme" }) });
theme.css;                       // full stylesheet
theme.classes;                   // recipe → class name map
theme.getClass("components", "buttons", "primary");
```

- **CSS** adds `theme.css` / `variablesCss` / `recipesCss` / `classes` / `getClass()` /
  `renderRecipe()` / `media`.
- **styled-components** adds `theme.theme` (for `<ThemeProvider>`) / `recipes` / `GlobalStyle` /
  `media` / `scheme`.
- **JSON** adds `theme.json` / `jsonString`; **SCSS** adds `theme.scss` / `variablesScss` /
  `rulesScss` / `classes`.

See **consuming-the-output** for wiring these into an app.

## Adapter options (constructor)

Options are passed when constructing the adapter, never as CLI flags. The common ones:

- **CSS** — `prefix` (default `"dt"`, also the class prefix + MFE isolation), `classPrefix`,
  `inline` (bake values, drop `var()`), `colorFormat: "rgb" | "hex" | "oklch"`, `naming` (§7B
  override hook), `layer: string | boolean` (wrap output in `@layer` for deterministic precedence
  under app CSS), `reducedMotion: true` (append a `prefers-reduced-motion` reduce block). The last
  two are single-file-emit only and off by default (byte-identical).
- **styled-components** — `language: "ts" | "js"`, `emit: "single" | "split"`,
  `scheme: "media" | "attribute" | "both"` (dark realization), `helpers: ["color-math"]`,
  `naming`.
- **SCSS** — `prefix`, `inline`, `indent`, `layer` (same as CSS). **JSON** — minimal; see
  [`docs/css-adapter.md`](https://github.com/theme-registry/refract/blob/main/docs/css-adapter.md) and [`docs/authoring.md`](https://github.com/theme-registry/refract/blob/main/docs/authoring.md) for the full tables.

Cross-format concerns — emit modes, dark-mode strategy, the CLI — live in **build-config**.
