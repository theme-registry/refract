# Changelog

All six published packages version **in lockstep** — one shared version through the whole `0.x` line
(a Changesets [`fixed` group](.changeset/config.json)), so an entry here applies to the matched set:
`@theme-registry/refract`, `-css`, `-styled-components`, `-scss`, `-json`, and `-mcp`. Per-package
detail lives in each package's own `CHANGELOG.md`. Release mechanics: [RELEASING.md](RELEASING.md).

This project adheres to [Semantic Versioning](https://semver.org). While on `0.x`, minor releases may
carry breaking changes; **pin exact versions**. What is and isn't frozen is spelled out under
[Stability](#stability) below.

## 0.1.2

Post-publish review pass — surface the rigor and close the silent-failure/drift traps. Additive; no
breaking changes (a patch across the lockstep group).

- **Fail loud on bad input.** `refract diff` rejects a mis-shaped candidate (e.g. a `defineConfig`
  passed where the raw theme was wanted) with a coded `REFRACT_E_RAW_SHAPE` — via a new exported
  `assertRawTheme` guard — instead of a nonsense "everything removed" diff at exit 0. The CLI now
  surfaces a `RefractError`'s stable `code` and its collect-all failures.
- **MCP bin robustness.** The `refract-mcp` server resolves symlinks and starts when launched through a
  `node_modules/.bin` shim instead of silently exiting 0; the README documents the `reload` tool (11th)
  and the named-vs-positional `getClass` shapes.
- **Dogfood the auditor.** The `refract init` starter palette is retuned to pass its own WCAG `audit`.
- **Docs can't drift.** Every self-contained doc example is compiled in CI; the status page surfaces the
  test suite, CI gates, and CI-enforced gzip budgets (all drift-gated); the docs site serves `llms.txt`,
  `manifest.json`, `sitemap.xml`, and `robots.txt` at its root; and the skills' `docs/` links are
  repointed to canonical URLs so they resolve once installed.

## 0.1.1

- Add a package README to every package so the npm page renders documentation. No API or output change.

## 0.1.0 — initial public release

- **Monorepo split.** Core ships zero adapter implementations — every adapter is its own installable
  package (`-css`, `-styled-components`, `-scss`, `-json`). Core keeps everything adapter-_enabling_:
  the `createTheme` / `defineAdapter` / `ThemeAdapter` contract, the Model / RawTheme types, DTCG
  interop (`./dtcg`), OKLCH color-math (`./color-math`), the shared naming helpers (`./adapter-kit`),
  and the `refract` CLI.
- **Unified override grammar.** `modes`, `states`, and `responsive` are three arrays of overrides over
  one shared spine (WHEN · WHERE · WHAT), with cross-property derivations, a `target` write-channel, a
  top-level `modes` registry (undeclared modes throw), and colour derivation via a `modifiers` chain.
  `toDTCG(theme, { includeRecipes: true })` round-trips the whole Model losslessly via the
  `com.theme-registry.refract` extension.
- **Eight subsystems** (colors · typography · layout · effects · borders · animation · globals ·
  components), numeric scale synthesis, container queries, a WCAG contrast `audit`, structured
  `RefractError` codes with collect-all validation, and immutable `override()` child themes.
- **`@theme-registry/refract-mcp`** — an MCP server exposing live theme queries (resolve/list/search
  tokens, recipes, contrast, validate, diff) to AI agents over stdio.

## Stability

Two tiers, signalled by npm **dist-tag** (not by divergent versions):

- **Stable** — breaking changes are deliberate, announced events. Core (+ CLI + DTCG interop at
  `/dtcg`), the **CSS** and **styled-components** adapters, and the **MCP** server. Ride `latest`.
- **Experimental** — the shape may still change; pin and expect churn. The **SCSS** and **JSON**
  adapters. Reachable via the `experimental` dist-tag.

**Frozen already, within `0.x`:** token paths are stable identifiers (a path won't change or vanish in
a minor/patch), and emitted output is a stable contract (same theme → byte-identical CSS — same
variable names, class names, and rule order; a change to an emitted name is a breaking release). **Still
moving:** the SCSS/JSON adapter shapes, and the planned work listed under "What's next" on the
[status page](https://theme-registry.github.io/refract/status).

**At `1.0`** the `fixed` group splits into independent lines (core on its own `1.x`), and the public
contract — the `RawTheme` grammar, the `REFRACT_E_*` error codes, the manifest schema, and the
four-primitive adapter contract — becomes semver-stable.
