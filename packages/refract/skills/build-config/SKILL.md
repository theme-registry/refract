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
`{ adapter, outDir, name?, emit?, helpers?, guide?, preview? }`. Resolution order: `theme.config.ts` → `.mjs` →
`.js` (a `.ts` config lazy-loads the optional `typescript` peer — it must be **5.x**; a bare
`npm i -D typescript` resolves to 7.x, whose main entry doesn't expose the compiler API, and the
build then fails with `Cannot read properties of undefined (reading 'ESNext')`. A `.mjs`/`.js`
config never loads it).

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

## Emitted extras (`guide` / `preview` on a target)

Both are **off by default** and land inside the target's `outDir`, so they travel with any
distribution form. A build with neither set is byte-identical to before.

- `guide: true` → `llms.txt` + `manifest.json` — the **machine-facing** consumption guide (real
  class names / export ids / token paths). Object form: `{ packageName?, llmsFile?, manifestFile? }`.
- `preview: true` → `preview.html` — the **human-facing** rendered specimen. Object form:
  `{ file?, title?, inline? }`; `inline` defaults **true** (one self-contained shareable file), set
  it `false` to emit relative `<link>`s that reflect a rebuilt stylesheet on refresh.

**What `preview` shows depends on the adapter, and you should say so rather than over-promise.**
Token plates (colours, type ramp, spacing, radii, shadows, breakpoints) render from the
format-neutral token export, so **every** adapter gets them. *Live* recipe plates need output a
browser can load as-is — **CSS only** today. An SCSS / styled-components / JSON target still renders
every token and lists every recipe by its real identity, and states why it can't render them live.
If a user wants a live design-review page from an SC or SCSS theme, tell them to **add a CSS target
to the same config** — same recipes through the same core, so it's a faithful specimen.

The page is a **style guide**, not a token dump: sticky section rail, colour families as contiguous
ladders with live WCAG contrast readouts on each `text` pairing, the type ramp set in its own sizes,
spacing as a measure *and* an applied inset (there is no `padding` token — spacing IS the padding
scale), a **state matrix** per recipe, an **appearance-mode diff** of the tokens that actually carry
an override, **composition** broken into its parts, and a prose specimen for the bare elements the
`globals` subsystem themes. Sections appear only when the theme has tokens of that kind.

It follows the target's `emit` mode (variables load before styles in `split`; plates group by
subsystem or by component file), gains a light/dark toggle when the theme declares `modes`, and
frame-width buttons when it declares `breakpoints`. A theme with **no recipes** (e.g. straight out of
`refract create`) renders its tokens and says explicitly that recipes are missing.

**State rules never reach the shipped stylesheet.** A CSS pseudo-class can't be triggered from
markup, so the adapter emits parallel pinnable rules (`.cls.rfp-s-hover`) that are inlined into
`preview.html` only. If a user asks why those classes aren't in `theme.css`, that's why.

## Dark-mode strategy (differs by target)

- **CSS / SCSS / JSON** — dark rides the *referenced token's own `modes`* (see **theme-foundations**);
  a token with a `dark` value emits `@media (prefers-color-scheme: dark)` overrides. No separate
  global switch; `colorFormat` is the main CSS colour knob.
- **styled-components** — an explicit `scheme` option: `"media"` (OS), `"attribute"`
  (`[data-theme="dark"]` manual toggle), or `"both"`.

## Vendored helpers

`helpers: ["color-math"]` on a target materializes a shared helper module (live `lighten`/`darken`/
`alpha`) next to the output — opt-in, only when named.
