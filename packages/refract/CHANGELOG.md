# @theme-registry/refract

## 0.1.7

## 0.1.6

### Patch Changes

- 5a8f126: Fix `__dirname is not defined` when the `./build` subpath is used from an ESM consumer. Package-root
  discovery defaulted to `__dirname`, which only exists in the CJS bundle — so `runInit`, `runCreate`
  and `runSkillsInstall` all threw for ESM callers. It went unnoticed because the only consumer was
  refract's own CLI, which ships as CJS.

## 0.1.5

### Patch Changes

- 6a87cb1: Clearer prompts in `refract create` (and `npm create refract-theme`, which shares them). Multi-selects
  now draw a `❯` cursor alongside `[✓]`/`[ ]` checkboxes, so focus and selection are separate signals —
  previously only the label was bolded and it was hard to tell which row the keys would act on. The
  harmony prompt shows the actual derived hues as colour swatches, and option hints align into a column.

## 0.1.4

### Patch Changes

- e6861d2: Interactive prompts now respond to arrow keys. `refract create` (and `npm create refract-theme`,
  which shares the interview) navigates with ↑/↓, toggles multi-selects with space, `a` for all/none,
  and Enter to confirm — instead of typing option numbers. Falls back to the numbered prompts when a
  terminal refuses raw mode, and still takes defaults with no TTY at all.

## 0.1.3

### Patch Changes

- 1c439a1: Add `refract create` — generate a complete `RawTheme` from one seed colour, with a WCAG contrast pass
  that runs before the file is written. `refract init` now detects an existing `theme.raw.*` and writes
  a config that imports it instead of carrying its own starter palette (unchanged when no theme is
  found). Ships the `theme-scaffold` skill.

## 0.1.2

### Patch Changes

- Fail loud on bad input: `refract diff` rejects a mis-shaped candidate (e.g. a `defineConfig` passed where the raw theme was wanted) with a coded `REFRACT_E_RAW_SHAPE` — via a new exported `assertRawTheme` guard — instead of emitting a nonsense "everything removed" diff at exit 0. The CLI now surfaces a `RefractError`'s stable `code` and its collect-all failures. The `refract init` starter palette is retuned so it passes its own WCAG `audit` (all pairings clear AA). Skill docs links repointed to canonical URLs so they resolve once installed.

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
