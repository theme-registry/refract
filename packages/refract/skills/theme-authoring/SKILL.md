---
name: theme-authoring
description: Entry point and hub for authoring a refract theme — frame a RawTheme (breakpoints + subsystem keys), then route to the focused domain guides. Use when starting a theme, adding a subsystem, or unsure which guide applies. Triggers: "author a theme", "write a raw theme", "set up refract", "add colors/typography/layout/a recipe", "which refract skill".
tier: core
---

# Theme authoring — hub

refract compiles **one `RawTheme`** into a format-neutral `ThemeModel`, then an **adapter**
lowers that model to a concrete output (CSS variables, SCSS, styled-components modules, JSON).
You author the `RawTheme`; the adapter and build config decide the output. This guide frames
the theme and routes to the focused guide for whatever you're actually doing.

**You are authoring input, not changing the engine.** Never edit the core or a subsystem to
make a theme work — if the theme can't express something, that's a real gap to surface, not a
patch. Full narrative reference lives in `docs/authoring.md`.

## Frame the theme

- **Type it.** `const raw = { … } satisfies RawTheme`, with
  `import type { RawTheme } from "@theme-registry/refract/build"`. The `satisfies` gives
  autocomplete and rejects bogus top-level keys — a red squiggle means the authored shape is
  wrong; fix the theme, not the types.
- **Breakpoints first.** `breakpoints: { name: minWidthPx }`. Every responsive override
  references these names, so settle them before anything else (a `0`-width base is fine).
  Breakpoints, containers, and the shared responsive/variant/target/modes/states vocabulary
  are all covered in **theme-foundations** — read it once; the domain guides build on it.
- **One key per subsystem**, each optional. Each holds properties plus an optional nested
  `recipes` block:

  | Key | Domain | Guide |
  |---|---|---|
  | `colors` | palettes, steps, harmony, modes | **colors** |
  | `typography` | font families, modular type scale | **typography** |
  | `layout` | spacing/sizes scales, columns/grids/stacks/container | **layout** |
  | `effects`, `borders`, `animation` | shadows/transitions/blur, stroke geometry, motion | **visual-effects** |
  | `components` | cross-subsystem composition (recipes only; `css` is literal-first, `ref()` for tokens) | **recipes-and-composition** |
  | `globals` | `preset` + themed bare-element rules | this guide (below) |

## Route to the right guide

- **Any recipe, states, `variants`, or `components` composition** → **recipes-and-composition**.
  Recipes work identically across every subsystem, so that vocabulary lives in one place.
- **A specific token domain** (palettes, type scale, spacing, effects) → the domain guide above.
- **Picking or configuring an output format** → **adapter-usage** (which adapter) and
  **build-config** (`theme.config.ts`, the `refract` CLI, emit modes, dark-mode strategy).
- **Using the built theme in an app**, or shipping a self-documenting theme package →
  **consuming-the-output**.
- **Brand variants / child themes** → **overrides-and-child-themes**.
- **Importing existing design tokens** (Figma / Tokens Studio / Style Dictionary) →
  **dtcg-import**.

## Agent tools — MCP, then the static fallback

When a **refract MCP server** is connected (a project can ship one — `@theme-registry/refract-mcp`,
auto-discovers `theme.config.*`), prefer its **live tools** over guessing. They answer against the
**real compiled theme**, per configured adapter — so class names carry the real prefix and validation
runs the real build, not a stand-in:

- `validateTheme(candidate)` — before writing an edit; returns **every** problem at once, per target.
- `diffTheme(candidate)` — the **blast radius** of an edit *before* you apply it: which tokens moved,
  which classes changed, which contrast pairings crossed a threshold, which targets stopped building.
- `getClass` / `renderRecipe` — the real class / emitted CSS for a recipe.
- `resolveToken` / `searchTokens` / `listTokens` — a token's value + `varName` + `derivedFrom`, or discovery.
- `checkContrast` — a WCAG-2 audit of the theme's colour pairings.
- The server also serves the guide as MCP resources: `refract://manifest.json` (schema 1 — real names +
  DTCG tokens) and `refract://llms.txt`.

**Fallback when no MCP server is connected:** read the emitted **`manifest.json`** / **`llms.txt`** (when
the build enabled the guide — see **consuming-the-output**), or call the runtime accessors on the built
theme (`theme.getClass(...)`, `theme.resolveToken(...)`). The MCP tools, the emitted guide, and these
skills all speak the same **schema 1** contract, so they don't disagree.

## Globals — themed element rules + reset

Bare-element styling lives in the `globals` key (no separate guide). `preset` is the
normalization base (`"preflight" | "normalize" | "reset" | false`) plus a default `h1`–`h6`
scale map; `elements` are themed rules — each selector is a recipe-item (flat literal-first leaves,
`ref()` for tokens, plus `states` / `responsive` / `variants`), no cross-subsystem composition refs. A variant
is a delta-only modifier the adapters scope higher (CSS `a.subtle`, SC/SCSS nested `&.subtle`).
There is no `modes` axis — light/dark rides the referenced token's own modes. Unknown refs fail
loud; preset default headings drop opportunistically.

```ts
globals: {
  preset: "preflight",                                   // + default h1–h6 → type scale
  elements: {
    a: {
      color: ref("colors.link"),                         // ref() = token reference
      textDecoration: "underline",                        // bare string = literal (raw CSS)
      states: [{ state: "hover", color: ref("colors.link.dark") }],
      responsive: [{ breakpoint: "md", query: "min", fontSize: ref("typography.fontSize.lg") }],
      variants: { subtle: { color: ref("colors.muted") } }, // → a.subtle
    },
  },
}
```

## Verify

- Build once and inspect: `createTheme(raw, { adapter: createCssAdapter() }).css` (plus
  `.tokens` / `.classes`). See **adapter-usage** for the call surface.
- Building to disk? Run `refract build` and check the files under each `outDir` — see
  **build-config**.
- Typecheck the `satisfies RawTheme`.
- MCP server connected? Run `validateTheme` (all problems at once) and `diffTheme` (the edit's blast
  radius) against the real adapters *before* writing — see **Agent tools** above.
