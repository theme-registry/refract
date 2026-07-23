---
name: build-config
description: Wire the refract build — theme.config.ts (defineConfig, targets), the emit modes (single/split/subsystem/components), the refract CLI (init/build/import/tokens), and per-target dark-mode strategy. Use when emitting a theme to disk rather than building it at runtime. Triggers: "theme.config", "defineConfig", "refract build", "emit split/subsystem/components", "output multiple formats", "dark mode strategy", "refract init".
tier: core
---

# Build config

Two ways to realize a theme: **at runtime** via `createTheme(raw, { adapter })` (see
**adapter-usage**), or **to disk** via a `theme.config` + the `refract` CLI. This guide is the
disk path.

## `theme.config.(ts|mjs|js)`

The config is **your code** — it imports the adapter(s) and the raw theme, and that import *is*
the extensibility seam (like Rollup/Vite). Adapter options are passed at construction, not as CLI
flags. Multiple targets emit multiple formats from one theme. Keep the raw theme in a sibling
`theme.raw.ts` (the `.ts` config graph-compiles, so `import { raw } from "./theme.raw"` resolves).

```ts
import { defineConfig } from "@theme-registry/refract/build";
import { createCssAdapter } from "@theme-registry/refract-css";
import { createStyledComponentsAdapter } from "@theme-registry/refract-styled-components";
import { raw } from "./theme.raw";

export default defineConfig({
  raw,
  targets: [
    { name: "css", adapter: createCssAdapter(), outDir: "dist/theme" },
    { name: "sc",  adapter: createStyledComponentsAdapter({ language: "ts" }), outDir: "dist/sc" },
  ],
  // media / units / baseFontSize resolve once so every target emits identical units.
});
```

`ThemeConfig` = `{ raw, targets, media?, units?, baseFontSize? }`. Each `EmitTarget` =
`{ adapter, outDir, name?, emit?, helpers? }`. Resolution order: `theme.config.ts` → `.mjs` →
`.js` (a `.ts` config lazy-loads the optional `typescript` peer).

## Emit modes (`emit` on a target)

Core owns the vocabulary; **each adapter decides which modes it honors** and throws a clear error
otherwise.

| Mode | Output | Notes |
|---|---|---|
| `single` (default) | one file | `{ file }` renames it |
| `split` | rules file + variables file | load-order contract, **no `@import`** |
| `subsystem` | a styles+variables pair per subsystem | `filename(subsystem, kind)` |
| `components` | one self-contained rule-set per component variant | `inline` defaults **true** (bakes values); `inline: false` emits `var()` + a tree-shaken variables file |

Only `single` / `split` may omit `type`. Support matrix: **CSS** and **JSON** = all four; **SCSS**
= single/split/components (subsystem throws); **styled-components** = single/split only (ES modules
tree-shake, so the CSS-only modes are redundant).

## The `refract` CLI

- `refract init [--js|--mjs] [--force]` — scaffold a runnable `theme.config`.
- `refract build [--config <path>] [--target <name|index>] [--out <dir>]` — emit each target.
- `refract import <tokens.json> […]` — seed a theme from a DTCG document (see **dtcg-import**).
- `refract tokens [--config <path>] [--out <file>]` — DTCG export (see **dtcg-import**).
- `refract help`.

Run via `npx refract <cmd>`. `outDir` resolves relative to the config file's directory.

## Dark-mode strategy (differs by target)

- **CSS / SCSS / JSON** — dark rides the *referenced token's own `modes`* (see **theme-foundations**);
  a token with a `dark` value emits `@media (prefers-color-scheme: dark)` overrides. No separate
  global switch; `colorFormat` is the main CSS colour knob.
- **styled-components** — an explicit `scheme` option: `"media"` (OS), `"attribute"`
  (`[data-theme="dark"]` manual toggle), or `"both"`.

## Vendored helpers

`helpers: ["color-math"]` on a target materializes a shared helper module (live `lighten`/`darken`/
`alpha`) next to the output — opt-in, only when named.
