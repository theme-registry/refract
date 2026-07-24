# @theme-registry/refract

## 0.1.1

### Patch Changes

- Add a package README so the npm page renders documentation.

## 0.1.0

Initial public release.

- **Monorepo split.** Core ships zero adapter implementations — every adapter is its own installable
  package (`@theme-registry/refract-css`, `-styled-components`, `-scss`, `-json`). Core keeps
  everything adapter-_enabling_: the `createTheme` / `defineAdapter` / `ThemeAdapter` contract, the
  Model / RawTheme types, DTCG interop (`./dtcg`), OKLCH color-math (`./color-math`), the shared naming
  helpers (`./adapter-kit`), and the `refract` CLI.
- **Unified override grammar.** `modes`, `states`, and `responsive` are three arrays of overrides over
  one shared spine (WHEN · WHERE · WHAT), with cross-property derivations, a `target` write-channel, a
  top-level `modes` registry (undeclared modes throw), and colour derivation via a `modifiers` chain.
  `toDTCG(theme, { includeRecipes: true })` round-trips the whole Model losslessly via the
  `com.theme-registry.refract` extension.
- Eight subsystems (colors · typography · layout · effects · borders · animation · globals ·
  components), numeric scale synthesis, container queries, a WCAG contrast `audit`, structured
  `RefractError` codes with collect-all validation, and immutable `override()` child themes.
