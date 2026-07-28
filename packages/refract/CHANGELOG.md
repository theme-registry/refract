# @theme-registry/refract

## 0.1.15

### Patch Changes

- 2520506: Make `preview.html` aware of CSS properties that paint nothing on their own, and stop presenting comparable colour recipes two different ways.

  **`border-color` was rendering as a blank box.** A `colors.border` recipe emits exactly one declaration — `border-color` — and `border-style` initially resolves to `none`, so nothing was drawn at all. The specimen now supplies the missing companion (`border-style` + `border-width`) so the declared colour can be seen, and **says on the page that it did**, because a reader must never conclude their theme sets a 3px border when the preview added it. The emitted stylesheet is untouched; this is a specimen affordance only. The same applies to `outline-color`, `text-decoration-color` and `column-rule-color`, and to the symmetric case where a rule-set sets a width but no style.

  **`colors.surface` and `colors.container` looked unrelated.** Both are background + foreground pairings, but `container` declares states, which routed it to the state matrix where cells rendered at text size — so one appeared as full swatches and the other as tiny blobs, for no reason a reader could see. Matrix cells now get the same swatch treatment as the grid.

  **Filling is for rule-sets that express a value, not for components.** A `components` recipe is shown at whatever size it really is, even when that is text-sized, because that is the truth about the recipe; stretching a button to fill its stage would misrepresent it.

  A rule-set that emits no declarations and composes nothing now says so rather than rendering an unexplained empty box.

## 0.1.14

### Patch Changes

- dd07f1c: Render each subsystem's recipes inside its own section, in that section's context.

  Every rule-set previously landed in one "Components" section at the foot of the page, so a `colors.solid` recipe — which is part of the colour story and made of the very palette above it — was read twenty plates away under a heading that didn't describe it. Recipes now file to their subsystem's section: `colors.*` beside the palette, `layout.*` with spacing, `borders.*`/`effects.*` with shape, `animation.*` with motion, `typography.*` with the type scale. Only genuinely composed rule-sets stay in Components, which is the honest home for "a thing built out of the others".

  A section now earns its place on tokens **or** recipes, so a subsystem that declares rule-sets but contributes no tokens of its own still appears. Section pills and rail counts report both. The "no recipes yet" notice stays in one place rather than repeating per section.

  Also fixes long token paths overflowing their swatch chips instead of wrapping.

## 0.1.13

### Patch Changes

- d963a5e: Fix unstyled plates in `preview.html`, and let a dimensionless recipe fill its stage.

  **Regression fix (shipped in 0.1.12).** The paper-and-cards rewrite renamed `.rfp-plate*` to `.rfp-card*` in the stylesheet but only updated the palette renderer, so the shared `plate()` helper kept emitting the old names. Eighteen elements — every plate below the palette — rendered with no CSS at all: no card, no spacing between a plate's name and its subtitle. Valid HTML, silently unstyled, which is why nothing caught it. A test now asserts that every `rfp-` class the page emits is also defined in the stylesheet it ships.

  **Dimensionless recipes fill their stage.** A pure colour recipe (`background` + `color`, nothing else) has nothing to size it, so it collapsed to a text-sized blob adrift on a large stage — which tells you almost nothing about the colour. Those now stretch edge to edge and read as a swatch. Recipes that size themselves are untouched, because that size is the thing being shown; composition is followed, so a variant that declares nothing but references a recipe with padding still keeps its natural size.

  The modes, base-elements and components section heads also now use the same heading + count pill as every other section, rather than a leftover eyebrow style that no longer had CSS behind it.

  **Every colour family gets its own card.** Previously only families with a numeric ladder did; everything else was merged into one "Semantic" grid, so three unrelated families ran together as fifteen undifferentiated chips — losing exactly the separation that makes a swatch sheet readable. Each family now shows its base swatch (carrying the WCAG readout for its declared `text` pairing), its ladder if it has one, and its own members. Only a family with no variants at all joins a shared "Single tokens" grid, since a whole card for one chip is waste.

  Contrast is now computed at **build time** rather than by a script in the page, so the readout can't drift from the swatch it sits on and the page is complete without JavaScript. Unmapped dimension tokens (breakpoints among them) render as scaled bars instead of bare labels — a dimension has magnitude, so the specimen should show magnitude.

## 0.1.12

### Patch Changes

- d1b737b: Rebuild `preview.html` as paper and cards, and commit it to a light sheet.

  The page is now a light paper with each plate as a white card, rather than a white ground with grey panels that left every plate flush and weightless — palettes in particular ran together. Colour becomes **one card per family**: a large base swatch, the family's lightness ladder, then its declared members, so separation comes from the card edge instead of a hairline rule.

  New on the page:

  - **A masthead in the theme's own first palette**, carrying headline counts — tokens, subsystems, recipes + elements, emitted size, and a **WCAG pass ratio** across declared `text` pairings. It is the one place the chrome takes a hue, and it takes the theme's rather than asserting one.
  - **An index cover** built from the sections that actually rendered, so it is the shape of the theme rather than a fixed contents list.
  - **`src` / `gen` provenance tags** — whether you authored a value or refract synthesised it. This is read from the model, not the token export: a literal `Ref` carries `value` while a derived one carries `ref`/`fn`/`modifiers`, and the DTCG export resolves both down to literals.
  - **Count pills** on every section head.

  **The sheet is deliberately light-only.** Colour cannot be judged against a moving backdrop — the same swatch reads lighter and more saturated on dark, which is why swatch books are printed on white. A flipping sheet would also add a second variable: you could no longer tell whether a swatch changed because the _theme's_ mode changed or because the page did. The appearance control moves the specimen; the sheet stays paper. The theme's own `prefers-color-scheme` rules still apply to what is being previewed.

## 0.1.11

### Patch Changes

- 821d673: Make `preview.html` fill the viewport.

  The page capped itself at 1260px while painting its background only on its own shell, so on a wide screen it floated as a panel over an unpainted body — with mismatched bands down both edges. Three causes, all fixed: the width cap is gone (the shell is now `width:100%` + `min-height:100vh`, so the ground covers the viewport), the UA's default 8px body margin is reset, and the page declares `color-scheme: light dark` so the browser's own canvas and scrollbars match in dark mode.

  The two document-level rules are written with `:where()`, giving them zero specificity — a theme's own `globals` rules still win, so the chrome never outranks the theme it is displaying. Per-element measure caps (prose at 64ch, leading samples at 52ch) are unchanged, so text stays readable at any window width while ladders, the state matrix and the swatch grid get the room they were being denied.

## 0.1.10

### Patch Changes

- bac693a: Fix two ways `preview.html` misrepresented a theme's palette, both found by rendering a real theme in a browser rather than by reading the code.

  **The base-rung marker never fired, and the page claimed otherwise.** The palette note read "the marked rung is the family's `base`", but the marker was chosen by comparing the base's hex against each rung's hex. A numeric `steps` ladder is an absolute lightness scale (`L = (1000 − label) / 10`) and refract deliberately does **not** snap the seed onto it — `refract create` reports where a seed lands rather than moving it — so that equality essentially never held and nothing was ever marked. The preview now finds the nearest rung by OKLCH lightness and says where the base _lands_ (`#14b8a6` → `lands ≈ 300`), which is both true and the question a reader actually has.

  **Contrast was scored on tokens that never declared a pairing.** Every member of a colour family was rendered against the family's `text`, including synthesized tints like `brand.dark` and `surface.lighter`. Those were never meant to carry that text, so the page filled with `fail` badges that read as a defect in the user's theme when nothing was wrong. Contrast is now scored only where the pairing is genuinely declared — the family base against its own `text` — and derived tints render as plain swatches.

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
