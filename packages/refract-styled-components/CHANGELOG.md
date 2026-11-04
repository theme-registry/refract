# @theme-registry/refract-styled-components

## 0.1.21

### Patch Changes

- 2778e6b: Recipe states for design-system components. A list-form state entry now answers up to four
  questions: `state` (what the element is), `has` (what it contains), `within` (whose element it is)
  and `target` (which variant).

  - **State names**: a CSS state (`hover`, `focus`, `focus-visible`, `focus-within`, `active`,
    `checked`, `indeterminate`, `placeholder-shown`, `disabled`, `link`, `visited`) or `aria-<name>`
    for a WAI-ARIA state (`aria-selected` → `[aria-selected="true"]`). Anything else still fails the
    build. `pressed` is now an alias of `aria-pressed` and writes `[aria-pressed="true"]` (it wrote
    `[aria-pressed]`, which also matched `aria-pressed="false"`).
  - **`has`** (components): `has: "checked"` or `has: { state: "checked" }` → `:has(:checked)`, so a
    wrapper (a label, a field box) is styled from the control inside it. An entry needs `state`, `has`
    or both (`:hover:has(:checked)`).
  - **`within`** (components, CSS adapter): `within: "root"` applies the entry while a sibling recipe of
    the same component meets the condition — `.<group>-root:has(:checked) .<group>-tick` — including
    each variant of that recipe, and with `target` for one variant of the part.
  - The SCSS and styled-components adapters render the new states and `has`; they fail on `within`
    for now. The Refract DTCG profile reads and writes `has` and `within`.

  Themes that use none of these emit the same CSS as before, except `pressed`.

- Updated dependencies [555562f]
- Updated dependencies [2778e6b]
- Updated dependencies [3fe83c9]
  - @theme-registry/refract@0.1.21

## 0.1.20

### Patch Changes

- 4577d7d: Raw themes can alias tokens. A `{ ref: "colors.accent" }` with no `modifiers` makes a property, a variant, a mode value or a responsive `base` the same token as its target:

  ```ts
  colors: {
    accent: { base: "#e64980", modes: [{ mode: "dark", base: "#f783ac" }] },
    highlight: { ref: "colors.accent" },
    link: { base: { ref: "colors.accent" }, variants: { hover: { ref: "colors.accent.dark" } } },
  }
  ```

  - The CSS adapter writes a live link, `--dt-colors-highlight: var(--dt-colors-accent);`, so the alias follows its target through dark mode, breakpoints and `override()`.
  - SCSS writes the target's value; styled-components writes it per mode; `toDTCG` writes a DTCG alias (`"{color.accent.base}"`).
  - `theme.tokens` keeps the link and the resolved value.
  - An alias can point across subsystems at a token of the same kind (`borders.radius.card → layout.spacing.md`). A missing target or a different kind of value is a validation error, a loop is `REFRACT_E_CYCLE`, and an aliased property can't generate its own tones or scale.

  A plain `{ ref }` used to be misread (as a variant it inherited the base and emitted a stray `…-ref` variable; as a base it emitted nothing). The core size budget moves from 30 KB to 31 KB gzip.

- Updated dependencies [53b2543]
- Updated dependencies [1ddc055]
- Updated dependencies [f2839f3]
- Updated dependencies [55857e6]
- Updated dependencies [ca9e736]
- Updated dependencies [4577d7d]
- Updated dependencies [5040ea4]
  - @theme-registry/refract@0.1.20

## 0.1.19

### Patch Changes

- Updated dependencies [39752bd]
- Updated dependencies [1bcf6a5]
- Updated dependencies [8a76d77]
  - @theme-registry/refract@0.1.19

## 0.1.18

### Patch Changes

- Updated dependencies [1168dec]
  - @theme-registry/refract@0.1.18

## 0.1.17

### Patch Changes

- Updated dependencies [42b0ee8]
  - @theme-registry/refract@0.1.17

## 0.1.16

### Patch Changes

- Updated dependencies [bbb64ad]
  - @theme-registry/refract@0.1.16

## 0.1.15

### Patch Changes

- Updated dependencies [2520506]
  - @theme-registry/refract@0.1.15

## 0.1.14

### Patch Changes

- Updated dependencies [dd07f1c]
  - @theme-registry/refract@0.1.14

## 0.1.13

### Patch Changes

- Updated dependencies [d963a5e]
  - @theme-registry/refract@0.1.13

## 0.1.12

### Patch Changes

- Updated dependencies [d1b737b]
  - @theme-registry/refract@0.1.12

## 0.1.11

### Patch Changes

- Updated dependencies [821d673]
  - @theme-registry/refract@0.1.11

## 0.1.10

### Patch Changes

- Updated dependencies [bac693a]
  - @theme-registry/refract@0.1.10

## 0.1.9

### Patch Changes

- Updated dependencies [87374bd]
  - @theme-registry/refract@0.1.9

## 0.1.8

### Patch Changes

- 9316e60: Add `preview` — an opt-in, human-facing `preview.html` specimen of a built theme, the audience-flipped sibling of `guide`.

  Set `preview: true` on any emit target and `refract build` writes a rendered page into that target's `outDir`: colour swatches, the type ramp, spacing, radii, shadows, borders and breakpoints, plus every recipe rendered on its real class list. Stylesheets are inlined by default, so the page is a single self-contained file that survives being moved or forwarded (`inline: false` emits relative `<link>`s instead). A theme with appearance modes gets a light/dark toggle; one with breakpoints gets frame-width buttons.

  Token plates come from the format-neutral token export, so **every** adapter — including third-party ones — gets them with no code change. Live recipe plates need output a browser can load as-is, described by a new optional `describePreview(plan, files)` on the adapter contract. The CSS adapter implements it for all four emit modes (honoring `split`'s load-order contract and `components`' own-class markup); the SCSS, styled-components and JSON adapters explain why a live render isn't possible and the page degrades to tokens-only rather than showing unstyled boxes.

  `describePreview` is optional with no default, so the adapter contract stays additive — an existing third-party adapter keeps compiling and still produces a useful preview.

  Also constrain the optional `typescript` peer to `>=5.0.0 <6` (on both `refract` and `refract-mcp`) and fail loud when a resolved `typescript` doesn't expose the compiler API. `npm i -D typescript` now resolves to 7.x, whose main entry exports only `{ version, versionMajorMinor }` — the compiler API moved behind `./unstable/*`. Previously every `.ts` `theme.config` (and the `helpers` vendoring opt-in) died on the opaque `Cannot read properties of undefined (reading 'ESNext')`; it now throws an error naming the installed version, the missing entry points, and the two ways out (`typescript@5`, or a `.mjs`/`.js` config, which never loads typescript at all).

- Updated dependencies [9316e60]
  - @theme-registry/refract@0.1.8

## 0.1.7

### Patch Changes

- @theme-registry/refract@0.1.7

## 0.1.6

### Patch Changes

- Updated dependencies [5a8f126]
  - @theme-registry/refract@0.1.6

## 0.1.5

### Patch Changes

- Updated dependencies [6a87cb1]
  - @theme-registry/refract@0.1.5

## 0.1.4

### Patch Changes

- Updated dependencies [e6861d2]
  - @theme-registry/refract@0.1.4

## 0.1.3

### Patch Changes

- Updated dependencies [1c439a1]
  - @theme-registry/refract@0.1.3

## 0.1.2

### Patch Changes

- Updated dependencies
  - @theme-registry/refract@0.1.2

## 0.1.1

### Patch Changes

- Add a package README so the npm page renders documentation.
- Updated dependencies
  - @theme-registry/refract@0.1.1

## 0.1.0

Initial public release. The styled-components adapter for refract — emits TS/JS theme modules: a
literal `theme` object, tree-shakeable `css` recipes, a `GlobalStyle`, and (in TS) a `theme.d.ts` that
augments styled-components' `DefaultTheme`. Peer-depends on `@theme-registry/refract` and
`styled-components`.
