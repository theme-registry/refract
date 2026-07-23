# @theme-registry/refract-figma (POC)

A proof-of-concept **Figma plugin** that turns a refract theme into a **Figma Variable collection** —
closing the designer↔code loop with refract as the source of truth.

It rides on the DTCG layer: you export a theme with `refract tokens` (or `toDTCG(theme)`), paste the
JSON into the plugin, and it creates one Figma variable per token, folder-nested by path, with **theme
variants mapped to Figma modes**.

> Scope: **`refract → Figma` only.** Importing an existing Figma file *into* a RawTheme is handled
> elsewhere and is out of scope here.

## Architecture

The mapping is a **pure, tested transform** (`src/plan.ts` → `buildVariablePlan`), kept separate from
the thin `figma.*` glue (`src/code.ts`) so the logic is verifiable without Figma:

```
DTCG document(s) ──▶ buildVariablePlan(collection, modes) ──▶ VariablePlan ──▶ code.ts ──▶ figma.variables.*
   (one per "mode")      (pure, unit-tested)                                    (sandbox glue)
```

- **Colours** → `COLOR` variables (`{ r, g, b, a }`).
- **Dimensions / numbers / durations** → `FLOAT` (unit stripped — Figma floats are unitless).
- **fontFamily / cubicBezier** → `STRING`.
- **Composite types** (shadow, typography, border, transition) have no Figma-variable equivalent and
  are **skipped with a warning** (surfaced in the UI).

### Modes are the point

refract emits one resolved theme per DTCG document, so **each mode is a separate document**. Pass the
base theme plus each `theme.override(…)` variant (dark, a brand) and they become the modes of one
collection:

```json
{ "modes": [
  { "name": "light", "doc": { "color": { "$type": "color", "brand": { "base": { "$value": "#4c6ef5" } } } } },
  { "name": "dark",  "doc": { "color": { "$type": "color", "brand": { "base": { "$value": "#8aa2ff" } } } } }
] }
```

A single DTCG document (no `modes` wrapper) becomes one mode named from the UI field.

## Build & load

```sh
pnpm --filter @theme-registry/refract-figma build   # bundles src/code.ts → dist/code.js
```

Then in Figma desktop: **Plugins → Development → Import plugin from manifest…** and pick this package's
`manifest.json`. Run it, paste a `tokens.json`, and click **Create variables**.

## Test

```sh
pnpm --filter @theme-registry/refract-figma test     # exercises the pure transform
```

## Production notes

- Swap the local `src/figma-env.d.ts` ambient types for the official `@figma/plugin-typings`.
- Give the plugin a real published `id` in `manifest.json`.
- Next step (out of scope): re-reading edited Figma variables back into a RawTheme, and the
  `Figma + refract + AI + MCP` flow (an agent authoring/validating over MCP on both sides).
