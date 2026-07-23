# Docs site — `@theme-registry/refract`

A self-contained documentation & live-playground page for the library. Every
code sample is compiled **in the browser by the real library** (the CSS
adapter), and the four theme presets in the top bar swap live.

## Build

Three steps, wired as npm scripts (run from the repo root):

```bash
npm run docs:build      # build lib → bundle IIFE → inject → website/refract-showcase.html
npm run docs:validate   # headless checks (tag balance, renders, class-existence, full-page exec)
```

`docs:build` runs, in order:

1. `npm run build` — compiles the library to `dist/` (rollup).
2. `docs:bundle` (`scripts/bundle.mjs`) — bundles `bundle/entry.js` into a single
   browser IIFE at `website/out/refract.iife.js` (vite; styled-components stubbed
   so the CSS-adapter path stays React-free).
3. `scripts/build.mjs` — injects that IIFE + the preset RawThemes into
   `template.html`, producing `website/refract-showcase.html`.

Open `website/refract-showcase.html` in any browser — no server needed.

## Files

| Path | What it is |
| --- | --- |
| `template.html` | **The source.** Page markup, styles, and the client script (router, renderers, preset switcher). Two markers — `/*__REFRACT_BUNDLE__*/` and `/*__PRESETS__*/` — are where the build injects. |
| `presets.mjs` | The four preset RawThemes, built from one `makePreset` factory so every preset shares identical recipe structure (preset switching is a pure stylesheet swap). |
| `bundle/entry.js` | Re-exports the runtime surface (`createTheme`, `createCssAdapter`) from `dist/`. |
| `bundle/sc-stub.js` | No-op styled-components stub for the bundle. |
| `bundle/vite.config.mjs` | IIFE build config (location-independent paths). |
| `scripts/bundle.mjs` | Runs the vite bundle. |
| `scripts/build.mjs` | Injects bundle + presets into the template. |
| `scripts/validate.mjs` | Headless validation — run after a build. |

## Generated (git-ignored)

- `website/out/refract.iife.js` — the bundled library
- `website/refract-showcase.html` — the built page

Both regenerate from `npm run docs:build`.

## Keeping examples in sync with the library

The page compiles themes with the **real** library, so authored inputs and their
rendered output can never silently drift — but the hand-written *emitted-output*
snippets (on the adapter pages) and the presets can. After any library change
that touches a subsystem's shape, re-run `npm run docs:build && npm run
docs:validate`; `validate` fails loudly if a renderer emits a class the compiled
CSS doesn't contain.
