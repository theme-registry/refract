# @theme-registry/refract-scss

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

Initial public release (experimental). The SCSS adapter for refract — emits Sass `$variables` +
classes, with `inline`, `indent`, `prefix`, and cascade `@layer` options. Peer-depends on
`@theme-registry/refract`. Reachable via the npm `experimental` dist-tag.
