# create-refract-theme

Scaffold a **publishable design-system package** from one seed colour.

```sh
npm create refract-theme my-theme
```

A short interview — primary colour, how many brand colours, overall feel, type scale — and you get a
project that builds and publishes:

```
my-theme/
├── theme.raw.ts      your design: every token, as a literal you can read and edit
├── theme.config.ts   build wiring: which adapters run, where their output lands
├── package.json      publishable — real exports, files allowlist, prepublishOnly
├── tsconfig.json
├── .gitignore
└── README.md
```

## What it generates

From a single colour it derives a whole palette, then writes it down:

- **Brand colours 2–5** by hue rotation (complement · analogous · split-complement · triadic ·
  pentadic). Each becomes its own palette with a full `50…900` ladder — not a variant hanging off the
  primary.
- **Semantic colours** — success · info · warning · danger — anchored to conventional hues rather
  than rotated off your seed, because a rotated "danger" from a red seed comes out green.
- **A contrast pass.** Every text pairing is scored against WCAG AA (or AAA) *before* anything is
  written, and lightness walks down in OKLCH points until it clears the bar. This is the part a
  hand-rolled palette almost always gets wrong: a mid green at the primary's lightness reads fine as a
  chip and fails as a button.
- **A type scale** from your base size and ratio, with leading and tracking derived per step — a
  dramatic ratio automatically gets the tight leading it needs.
- **Spacing, radius, elevation and motion** from one "overall feel" pick.

## What it does not generate

- **No recipes.** You get tokens; turning them into classes is your design work.
- **No app.** This creates a theme package. To add a theme to an app you already have, use
  [`refract create`](https://github.com/theme-registry/refract) instead.

## Literals, not magic

The generator runs **once**. Everything it derives is written into the file as a plain value, so the
result is yours: rename a token, delete a family, hand-pick a hex, and nothing re-derives behind your
back. The tonal ladders, type scale and spacing ramp stay *declarations* the engine synthesizes — so
retuning a scale is still a one-word edit.

## Options

Every prompt has a flag, so the whole thing is scriptable and never blocks in CI:

```sh
npm create refract-theme -- --name my-theme --seed "#4c6ef5" --colors 3 \
  --scheme triadic --feel editorial --contrast AAA --format json --yes
```

Run `npm create refract-theme -- --help` for the full list.

## License

MIT
