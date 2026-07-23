# AGENTS.md

Orientation for AI coding agents working in **@theme-registry/refract**. Start here,
then read the doc that matches the task.

## What this package is

A framework-agnostic design-token toolkit. The pipeline is one-directional:

```
raw theme ──▶ format-neutral Model ──▶ adapter ──▶ CSS │ styled-components │ SCSS │ JSON
```

- **Raw theme** — the authored input: `breakpoints` + one key per subsystem
  (`colors`, `typography`, `effects`, `layout`, `components`), each with properties and
  a nested `recipes` block. Typed as `RawTheme`.
- **Model** (`ThemeModel`) — the single source of truth, held state. Format-neutral:
  tokens are `PropertyModel`s, rule-sets/recipes/composition are `RuleSet`s, values are
  `Ref`s (`{ ref?, value?, fn?, arg? }`). Naming, units, and media syntax are **not** in
  the Model — the adapter owns them.
- **Adapter** — `createTheme(raw, { adapter })` requires one; core ships no default. The
  adapter lowers the Model to a concrete format via four primitives (`recipeName`,
  `renderRecipe`, `renderVariables`, `join`) fed by `defineAdapter`.

## Which doc to read

| Task | Read |
| --- | --- |
| Author a theme, consume its output, use the CLI / `emit` / DTCG | **[docs/authoring.md](docs/authoring.md)** |
| Add a subsystem or an output adapter against the frozen contract | **[docs/extending.md](docs/extending.md)** |
| A user-facing overview / install / quickstart | **[README.md](README.md)** |

## Layout

- `src/core/` — the Model, `createTheme`, the `ThemeAdapter`/`AdapterSpec` contract, the
  normalize vocabulary, the merge/derivation utilities. Depends on nothing downstream.
- `src/subsystems/<name>/` — the five subsystems. Each exports a descriptor with up to
  five hooks (`key`, `normalizeProperty`, `tokenizeProperty`, `interpretRecipe`, `buildSlice`)
  plus `dependsOn`. Adding a subsystem never edits the core loop.
- `src/adapters/<name>/` — the format targets (`css`, `styled-components`, `json`, `scss`).
  Each imports only core; each has its own subpath export. `css` is the worked reference.
- `src/dtcg/` — DTCG interop (data-interchange, off the adapter contract).
- `src/build/` — the Node-only build layer: `emitTheme`, `defineConfig`, the config
  loader, and the `refract` CLI. Never on the runtime `.` graph.

## Contracts to respect

- **`createTheme` needs an adapter.** No default; core imports only the `ThemeAdapter`
  interface, never a concrete adapter.
- **The Model is format-neutral.** No CSS var names, units, or `@media` strings in core —
  those live in the adapter. A new format = a new adapter, not a core change.
- **The build layer stays off the runtime graph.** Nothing reachable from `.` or `./dtcg`
  may import `typescript` or a `node:*` builtin (enforced by a packaging-boundary test).
- **The adapter contract is versioned.** External adapters pin to `AdapterSpec.version`;
  keep it small and stable.

## Working conventions

- The build is a 3-config rollup (`npm run build`): the runtime bundles (`.`/`./dtcg`/the
  four adapter subpaths), the `./build` API, and the `cli.js` bin.
- Golden snapshot tests lock the emitted output byte-for-byte. Treat a golden diff as a
  signal to explain, not to `-u` away.
- Full gate before landing a change: `tsc --noEmit` + `npm run typecheck` + `npm run build`
  + `npm test` (golden + states snapshots byte-identical).
