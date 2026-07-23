---
name: colors
description: Author the `colors` slice of a refract theme — palettes as bare hex / `[r,g,b]` / extended colours, the OKLCH numeric step ladder, tonal + derivation-spec + harmony variants, and palette recipes. Also the `@theme-registry/refract/color-math` helper subpath for computing colours live in an app that match the emitted CSS. Use when writing or tuning a palette. Triggers: "add a palette", "colour steps / tonal ramp", "lighten / darken / alpha a colour", "colour harmony", "OKLCH steps", "colour math helpers".
tier: core
---

# Colors

The `colors` key is an **open** map: each key is a palette name (`primary`, `neutral`, …)
holding a colour value. The reserved `recipes` block holds palette recipes. Cross-cutting axes
(`responsive`, `modes`, refs) are in **theme-foundations**; recipe mechanics are in
**recipes-and-composition**. Exhaustive options live in `docs/authoring.md`.

## A colour value

Three forms, cheapest first:

```ts
colors: {
  accent: "#4dabf7",                 // bare hex (3- or 6-digit)
  ink: [33, 37, 41],                 // [r, g, b] tuple, 0–255
  brand: {                           // extended
    base: "#4dabf7",
    text: "#ffffff",                 // paired foreground (same hex/tuple rule)
    steps: [50, 100, 200, /* … */ 900],
    variants: { subtle: { modifiers: [{ alpha: 40 }] } },
    modes: [{ mode: "dark", base: "#1c7ed6" }],
  },
}
```

A base may be a **hex string, `[r,g,b]` tuple, or any CSS colour** — `oklch()`, `hsl()`/`hsla()`,
`rgb()`/`rgba()`, or a named keyword (`"rebeccapurple"`). All normalize to a canonical `rgb(...)`
string at build and derive in OKLCH. Only a `var(--…)` is rejected — it can't be tonally derived;
borrow it as an [external token](../overrides-and-child-themes/SKILL.md) instead. Alpha is never
authored on a base — use an `alpha` variant.

## Steps — the numeric OKLCH ladder

`steps` is **numeric only** and defines an **absolute** OKLCH lightness ladder: each Tailwind-style
label maps to a fixed lightness via `L = (1000 − label) / 10`, so **low labels are light, high are
dark**, and the same label reads at the same lightness across every palette. `0` / `1000` are pure
white / black; every other label clamps to `[5, 98]`. The exact authored colour stays at the
unnumbered `colors.<name>` token — a rung is never aliased to it, and `lightenBy` / `darkenBy` do
**not** apply to numeric steps.

With **no** `steps`, refract auto-generates the named tonal set `light` / `lighter` / `dark` /
`darker`, each compounding `lightenBy` / `darkenBy` (default `10`) as OKLCH ΔL points.

## Variants — derivation specs

Beyond literals, a variant can be a **derivation spec** — a `modifiers` **chain** of single-key
dials (`{ darken }` / `{ lighten }` / `{ alpha }` / `{ adjust }`), applied left-to-right, with an
optional `ref` naming the source (defaults to the colour's own base; may point at another
variant/step by name, or a cross-property token path like `colors.brand`):

```ts
variants: {
  hover:   { modifiers: [{ darken: 8 }] },                    // −8 OKLCH ΔL from base
  ghost:   { modifiers: [{ alpha: 15 }] },                     // absolute opacity: 15% opaque
  onHover: { ref: "hover", modifiers: [{ lighten: 4 }] },      // read another variant, then transform
  muted:   { modifiers: [{ adjust: { l: 60, c: 0.4, h: -10 } }] }, // absolute L, chroma ×, hue rotation
  tinted:  { modifiers: [{ darken: 6 }, { alpha: 90 }] },      // a multi-dial chain (darken THEN alpha)
}
```

`adjust` dials: `l` = absolute OKLCH lightness `0–100`; `c` = chroma **multiplier** (`1` keeps, `0`
greys); `h` = signed hue rotation in degrees. The same `modifiers` chain is the value form for a
mode (`{ mode, modifiers }`) and a responsive entry. Every generated variant carries `derive`
metadata, so `override()` of the base — or of a **cross-property** source — re-bakes the whole set
for free (see **overrides-and-child-themes**).

## harmony

Rotate the base's hue around the perceptual wheel (lightness + chroma held). String form uses default
member names; object form renames positionally:

```ts
brand: { base: "#4dabf7", harmony: "triadic" },              // → triadic1, triadic2
brand: { base: "#4dabf7", harmony: { triadic: ["mint", "coral"] } },
```

Schemes and their default members: `complement` → `complement`; `analogous` → `analogous1/2`;
`split-complement` → `split1/2`; `triadic` → `triadic1/2`; `tetradic` → `tetradic1` / `complement`
/ `tetradic2`. Exactly one scheme per colour.

## recipes — palette recipes

The reserved `recipes` block declares colour-bearing style properties (`background`,
`backgroundColor`, `color`, `borderColor`, `outlineColor`, plus any extra property passed through as
a literal). Each value names a palette reference (`"primary"`, `"primary.text"`, `"neutral.light"`)
or a literal. Recipe structure (states, variants, composition) is in **recipes-and-composition**.

## color-math — live colours that match the CSS

The same OKLCH functions refract bakes with are published at `@theme-registry/refract/color-math`,
string-in / string-out, so a colour computed live in the app matches the emitted CSS variable:

```ts
import { lighten, darken, setL, rotateHue, complement, adjust, alpha,
         toHexColor, toOklchColor } from "@theme-registry/refract/color-math";

lighten("#4dabf7", 10);   // shift OKLCH lightness +10
alpha("#4dabf7", 40);     // absolute 40% opacity
adjust("#4dabf7", { l: 60, c: 0.4, h: -10 });
```

Also exported: the conversion primitives `parseColor`, `serializeColor`, `convertHexToRGB`,
`convertRgbToHex`, `rgbToOklch`, `oklchToRgb`, `isHexColor`, `coerceColorInput`.

## Contrast audit — `refract audit`

Colours are the flagship, so refract can score them. The audit checks every palette `base`↔`text`
pairing and every recipe foreground↔background (all subsystems, incl. `:hover`) against **WCAG 2**
contrast, with an advisory **APCA** Lc. It **reports** — it never rewrites a colour; a non-derivable
side (`transparent`, a `var()`, a keyword) is `skipped`.

```
refract audit                      # report (exit 0)
refract audit --strict             # fail the run (exit 1) on any pairing below the bar
refract audit --min-wcag AAA       # raise the bar (AA | AAA | AA-large)
refract audit --large              # relax to large-text thresholds
```

Programmatic — reads a built theme, same scores as structured data:

```ts
import { audit } from "@theme-registry/refract";
const { pairings, summary, ok } = audit(theme, { minWcag: "AA" });
// each pairing: { label, fg, bg, wcagRatio, wcagLevel, apcaLc, pass } or { skipped }
```

WCAG levels: `AAA` ≥ 7, `AA` ≥ 4.5, `AA-large` ≥ 3 (large text only). APCA is advisory — reported,
never gated. `--strict` throws a `RefractError` (code `REFRACT_E_AUDIT`) listing every failing pair.
