---
name: theme-scaffold
description: Generate a starting RawTheme from one seed colour with `refract create`, or scaffold a whole publishable theme package with `npm create refract-theme`. Use when there is no theme yet and you need a defensible starting palette, type scale and spacing ramp rather than a blank file. Triggers: "refract create", "create a theme", "new theme", "scaffold a theme", "starter theme", "generate a palette", "npm create refract-theme", "new design system".
tier: core
---

# Scaffolding a theme

Two commands turn a seed colour into a real `RawTheme`. Use them instead of hand-writing a first
theme from nothing — the output clears a contrast bar, which a hand-rolled first palette usually
doesn't.

| Situation | Command | Writes |
| --- | --- | --- |
| Project exists, needs a theme | `refract create` | `theme.raw.(ts\|js\|json)` |
| Nothing exists yet | `npm create refract-theme my-theme` | a whole publishable package |
| Tokens already exist elsewhere | `refract import tokens.json` | see **dtcg-import** |

Both run the **same interview** and the same generator. Neither changes the palette model: they call
the colour helpers the library already ships and write down what they return, **once**.

## The commands

```
refract create                                   # interactive
refract create --yes                             # every default, asks nothing
refract create --seed "#4c6ef5" --colors 3 --scheme triadic --feel editorial --format json
```

Then wire the build — `refract init` **detects** the theme file and imports it:

```
refract init      # finds theme.raw.*, writes a config that imports it
refract build
```

Flags mirror every prompt: `--seed`, `--colors <n|list>`, `--scheme`, `--manual`, `--feel`,
`--ratio`, `--base-size`, `--contrast <AA|AAA|none>`, `--reset`, `--format <ts|js|json>`, `--out`,
`--no-semantics`, `--no-neutral`, `--no-shadows`, `--yes`, `--force`. Every prompt is
non-interactive-safe: with no TTY it takes the default rather than blocking, so this is safe in CI.

## What you get — and what you don't

From one colour: brand palettes, semantic colours, a neutral ramp, shadow tints, a type scale with
derived leading and tracking, a spacing ramp, radius, elevation and motion — around 150 variables.

**No recipes.** This is the important one. The scaffold emits *tokens only*, so nothing composes
into a class list yet. Do not tell the user their buttons are themed — they have variables. Writing
recipes is the next step and it is theirs (or yours) to do: see **recipes-and-composition**.

Also absent by design: no `@keyframes` (nothing would reference one without a recipe), and no
components.

## Decisions baked into the output

Know these before you edit a generated theme, or you'll "fix" things that are deliberate.

- **Brand colours 2–5 are top-level palettes, not variants.** `harmony` in a hand-authored theme
  emits `primary-complement` as a single flat leaf; the scaffolder promotes each member to its own
  family (`secondary`, `tertiary`, …) with a full `50…900` ladder, because a flat leaf can't carry a
  UI.
- **`base` is the brand colour.** The ladder is absolute lightness, so the seed lands wherever it
  falls (often between two stops) and is reachable only as `base`. The `50…900` stops are for
  surfaces, borders and states. Nothing snaps — the hex the user typed survives.
- **Semantic colours are hue-anchored, not rotated.** Rotating off the seed would make "danger"
  whatever lands at +150°; from a red seed that's green. success/info/warning/danger start from
  fixed hues and borrow only the seed's character.
- **A contrast pass ran before the file was written.** Every text pairing was scored and failing
  colours were darkened in OKLCH points until they cleared the bar. If you change a `base`, re-run
  `refract audit` — it is easy to lose AA by hand.
- **Derived leading and tracking are named after the size step they were tuned for**
  (`lineheight-4xl`, not `lineheight-tight`), so the pairing documents itself without a recipe:

  ```css
  font-size:      var(--dt-typography-fontsize-4xl);
  line-height:    var(--dt-typography-lineheight-4xl);
  letter-spacing: var(--dt-typography-letterspacing-4xl);
  ```

## Retuning a generated theme

The output is **literal where the value came from an opinion, declarative where the engine
synthesizes**. That's why retuning is usually one word, not a table:

| Want | Change |
| --- | --- |
| A different brand colour | `colors.primary.base` — every step re-derives |
| A tighter type scale | `typography.fontSize.ratio` → `"major-second"` |
| More generous spacing | the multipliers in `layout.spacing.steps` |
| Softer corners | `borders.radius.base` |

Do **not** replace `fontSize: { base, ratio }` with a hand-listed ladder, or `spacing: { base, step,
steps }` with literal pixels — that throws away the intent the engine uses to synthesize.

## Gotchas

- **Re-running clobbers.** `refract create` refuses to overwrite an existing `theme.raw.*` without
  `--force`. Don't pass `--force` over a theme the user has edited; generate to `--out` instead.
- **Format matters later, not now.** `.ts` · `.js` · `.json` compile to **byte-identical** output —
  a scaffolded theme has no functions or recipes, so JSON loses nothing. It stops being true the
  moment the theme needs a function-valued field (a custom scale `algorithm`); that requires `.ts`.
- **The spacing curve is linear on purpose.** `step: 4` keeps every stop on a 4px grid; the
  geometric `ratio` curve gives `8 · 12 · 18 · 27 · 40.5` and is right for type, wrong for space.
- **`refract init` only skips its own starter palette when a theme file already exists.** In an
  empty directory it still writes a self-contained config — so run `create` *before* `init`.

## Programmatic use

The generator is exported, so tooling can call it without a TTY:

```ts
import { scaffoldTheme, runCreate } from "@theme-registry/refract/build";

const { raw, report } = scaffoldTheme({ seed: "#4c6ef5", brandCount: 3, feel: "editorial" });
report.contrast;  // per-palette: ratio before/after, the nudge applied, whether it cleared the bar
report.brand;     // each brand palette with the hue rotation that produced it

runCreate({ seed: "#4c6ef5", cwd: ".", format: "ts" }); // generate + write in one call
```

`scaffoldTheme` is pure — no filesystem, no prompting, no randomness — so the same answers always
produce the same theme. Its tunable curves (leading, tracking, semantic hue anchors, feel presets)
are named constants at the top of `build/scaffold.ts`; they are opinions, and they are meant to be
arguable.

## Where to go next

**recipes-and-composition** to turn these tokens into classes · **colors** for the palette grammar
you're now editing · **build-config** for targets and emit modes · **overrides-and-child-themes** to
derive a second brand from the one you just generated.
