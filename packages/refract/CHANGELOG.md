# @theme-registry/refract

## 0.1.9

### Patch Changes

- 87374bd: Redesign `preview.html` as a proper style guide.

  The first version was a token dump: a flat row per token, one at-rest specimen per recipe, and chrome that competed with the theme's own colours. It now reads as a specimen sheet — sticky section rail with counts, colour families as contiguous ladders with live WCAG contrast readouts on each `text` pairing, the type ramp set in its own sizes, leading shown on wrapped text, spacing rendered as a measure _and_ as an applied inset and gap, and a copy-on-click identifier beside every specimen. Sections appear only when the theme actually has tokens of that kind, and full DTCG coverage means `lineHeight`, `letterSpacing`, `borderWidth`, `borderStyle`, `outlineOffset`, `blur`, `opacity`, `zIndex`, `gutters`, `sizes`, `aspectRatio` and `transition` now all appear; an unrecognized group still renders rather than being dropped.

  Three additions show what only a compiler's specimen sheet can:

  - **State matrix.** Recipe states render side by side instead of on hover. A CSS pseudo-class can't be triggered from markup, so the CSS adapter emits parallel pinnable rules (`.cls.rfp-s-hover`) that are inlined into the page — and deliberately never added to the emitted stylesheet a consumer ships.
  - **Appearance-mode diff.** A table of the tokens that actually carry an override, base value → override value. The toggle shows the result; this shows the cause.
  - **Composition breakdown.** A component's class list split into its parts, each attributed to the recipe it came from.

  Bare elements themed by the `globals` subsystem get their own prose specimen, since they carry no class at all. `PreviewDescriptor` gains five optional fields for this (`tokenName`, `states`, `statePinClass`, `statePinCss`, `composition`); all are optional, so the adapter contract stays additive.

  Two legibility bugs fixed along the way: specimen geometry used the page ground on a barely-different stage, which made radius, border and padding specimens near-invisible in dark mode, and the chrome assumed a light theme. Geometry now uses a dedicated mid-tone that reads at the same weight on both grounds.

## 0.1.8

### Patch Changes

- 9316e60: Add `preview` — an opt-in, human-facing `preview.html` specimen of a built theme, the audience-flipped sibling of `guide`.

  Set `preview: true` on any emit target and `refract build` writes a rendered page into that target's `outDir`: colour swatches, the type ramp, spacing, radii, shadows, borders and breakpoints, plus every recipe rendered on its real class list. Stylesheets are inlined by default, so the page is a single self-contained file that survives being moved or forwarded (`inline: false` emits relative `<link>`s instead). A theme with appearance modes gets a light/dark toggle; one with breakpoints gets frame-width buttons.

  Token plates come from the format-neutral token export, so **every** adapter — including third-party ones — gets them with no code change. Live recipe plates need output a browser can load as-is, described by a new optional `describePreview(plan, files)` on the adapter contract. The CSS adapter implements it for all four emit modes (honoring `split`'s load-order contract and `components`' own-class markup); the SCSS, styled-components and JSON adapters explain why a live render isn't possible and the page degrades to tokens-only rather than showing unstyled boxes.

  `describePreview` is optional with no default, so the adapter contract stays additive — an existing third-party adapter keeps compiling and still produces a useful preview.

  Also constrain the optional `typescript` peer to `>=5.0.0 <6` (on both `refract` and `refract-mcp`) and fail loud when a resolved `typescript` doesn't expose the compiler API. `npm i -D typescript` now resolves to 7.x, whose main entry exports only `{ version, versionMajorMinor }` — the compiler API moved behind `./unstable/*`. Previously every `.ts` `theme.config` (and the `helpers` vendoring opt-in) died on the opaque `Cannot read properties of undefined (reading 'ESNext')`; it now throws an error naming the installed version, the missing entry points, and the two ways out (`typescript@5`, or a `.mjs`/`.js` config, which never loads typescript at all).

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
