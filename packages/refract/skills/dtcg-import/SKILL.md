---
name: dtcg-import
description: Migrate existing design tokens into refract and export back out via the DTCG (W3C tokens.json) interop. Use when onboarding from Figma / Tokens Studio / Style Dictionary, or exporting a refract theme as standard tokens. Triggers: "import tokens.json", "Figma tokens", "Tokens Studio", "Style Dictionary", "DTCG", "refract import", "refract tokens", "export design tokens".
tier: core
---

# DTCG import / export

DTCG (the W3C Design Token Community Group `tokens.json` format) is refract's **interop** surface,
not an adapter. It's how you get *into* refract from existing tokens and *out* to a standard
format. It is Model-first and **property-tokens-only** — recipes and composition are out of scope
(they have no DTCG equivalent).

## Import — seed a theme from tokens

```
refract import tokens.json
refract import tokens.json --out theme.raw.ts --breakpoints sm:576,md:768,lg:992
refract import tokens.json --importer ./tokens.importer.ts   # your own placement rules (below)
```

Turns a DTCG document into a `createTheme` raw input (and, unless `--raw-only`, a starter
`theme.config`). Flags: `--out <file>`, `--raw-only`, `--force`, `--breakpoint-group <name>`,
`--breakpoints <n:px,…>` (DTCG has no breakpoint concept, so supply them). It prints a report:
counts per subsystem, chosen bases, renames and unmapped tokens with reasons. After importing, the
palettes/scales are plain tokens — to layer refract's synthesis on a colour (`steps`, named tones),
remove its `tones: false` first; then add recipes and composition by hand.

### What import reads (DTCG 2025.10 and the 2024 draft)

Every import first parses the document into a token graph (`parseDTCGGraph`). Both DTCG versions
parse into the same canonical shapes, so you don't need to convert an older file first.

- **Colours** — 2025.10 objects `{ colorSpace, components, alpha?, hex? }` or 2024 strings. `srgb`,
  `srgb-linear`, `hsl`, `hwb`, `oklab`, `oklch` convert natively; `display-p3`, `lab`, `rec2020` and
  the other spaces are read through `hex`, and are an **error without it** (the token is left out).
- **Dimensions / durations** — `{ value, unit }` or `"16px"` / `"200ms"`. Units outside
  `px`/`rem`/`ms`/`s` are kept with a warning.
- **Font weight** — 1–1000 or a spec name (`regular` → 400, `bold` → 700).
- **`$root`** — a group's own token (`{group.$root}`). `fromDTCG` reads it as that group's `base`.
- **Aliases** — `{a.b}` and JSON Pointer `$ref` (including into part of a value). An untyped alias
  takes its target's type. A `#/…` pointer to nothing is an error; a curly alias to nothing is external.
- **`$extends`** (deep merge), **`$deprecated`**, and every tool's **`$extensions`** are kept.

Nothing is guessed: check `parseDTCGGraph(doc).diagnostics` before trusting an import. Codes:
`type-unknown`, `type-mismatch`, `invalid-value`, `color-space-unsupported`, `color-space-fallback`,
`dimension-unit`, `alias-unresolved`, `extends-unresolved`. A circular alias or `$extends` throws
`REFRACT_E_CYCLE`.

### Where tokens land

`refract import` (and `importDTCG(doc)` → `{ raw, report }`) places each token on its own:

| Token | Lands in |
| --- | --- |
| `color` | `colors["<group path>"]`, token name = variant, `$root` = base, minus a leading `color` group. `panel.alert.danger.hover` → `colors.panel-alert-danger.hover`. Always `tones: false`. |
| `dimension` | By path keyword: radius → `borders.radius`; border-width → `borders.width`; font size / line height / letter spacing → `typography`; blur → `effects.blur`; gutter → `layout.gutters`; padding / gap / spacing → `layout.spacing`; size / width / height → `layout.sizes`. |
| `shadow` | `effects.shadow.<name>` as structured layers; each layer's `color` is the `colors.*` path of the colour it aliases (a literal gets its own `colors.shadow-<name>`). |
| `typography` | A typography **recipe** per text style (`typography.recipes.text.heading-h1` → class `…-typography-text-heading-h1`), its fields naming per-style typography variants. |
| `fontFamily` / `fontWeight` / `duration` / `cubicBezier` / `strokeStyle` / `transition` / `border` | The matching `typography`, `animation`, `borders` or `effects` property. |

Rules worth knowing when you review the result:

- A property with no `$root`/`base` member takes `default` as base, else the **first member in name
  order** (`005` before `100`) — listed in `report.bases`. Tell the user which bases were chosen.
- Names keep their case; spaces and punctuation become `-` (`Slate Blue 4` → `Slate-Blue-4`). A member
  that would overwrite another gets `-2` (`report.renamed`).
- Lengths keep their unit: `px` → number, `1.5rem` stays `"1.5rem"` (no assumed 16px root).
- Values are **resolved literals** — aliases are kept in the graph, not yet in the raw theme.
- Tokens it can't place are in `report.unmapped` with a reason. A primitive that's only used inside
  another token (a `dimension.100` a padding token aliases) says "used by …, which carries its value".
- `groupMapping: { <top-level group>: subsystem | "ignore" }` overrides placement for a whole group.

After importing, read the printed report with the user: chosen bases and unmapped tokens are the
places a human decision may be needed.

## Custom importers — change one placement rule

When the default rules put a group in the wrong place, don't hand-edit the result after every
re-import: write an importer that overrides only that rule and hands the rest to `next`.

```ts
// tokens.importer.ts
import { defineImporter } from "@theme-registry/refract/dtcg";

export default defineImporter({
  name: "scale-is-spacing",
  version: 1,
  place(token, ctx, next) {
    if (token.path[0] === "scale" && token.type === "dimension") {
      return { kind: "token", subsystem: "layout", property: "spacing", member: token.path.slice(1).join("-") };
    }
    return next(token);
  },
});
```

```
refract import tokens.json --importer ./tokens.importer.ts
```

- Hooks: `parse` (document → graph), `place` (→ a placement or `{ skip: reason }`), `value` (→ the raw
  value or `{ skip }`), `finalize` (`{ raw, report }` → `{ raw, report }`). Leave out what you don't change.
- `extends: otherImporter` makes `next` that importer's hook instead of the default's.
- `ctx.placed(id)` is where a token landed; `ctx.add(...)` adds a member to another property;
  `ctx.note(message)` adds to the report. The report stays complete whatever the hooks do.
- `version` must be `1` (`IMPORTER_CONTRACT_VERSION`); another version throws `REFRACT_E_IMPORTER`.
- `groupMapping` still covers the simple case (a whole top-level group to one subsystem); reach for an
  importer when the rule depends on more than the group name.

## Export — emit standard tokens

```
refract tokens                 # → tokens.json
refract tokens --out design-tokens.json
```

Walks the built theme's flat token map and writes a DTCG document. It's **adapter-free** (uses
core's built-in noop adapter), reading only `theme.tokens` / `resolveToken` / breakpoints — so it
ignores recipes and needs no output adapter. Handy for handing tokens back to design tooling, or
as the machine-readable companion when **publishing a theme** (see **consuming-the-output**).

## Lossless round-trip (opt-in) — `refract → DTCG → refract`

The **standard** DTCG surface carries property tokens as *resolved literals* — so appearance
`modes`, `responsive` overrides, derivation refs (`{ ref, modifiers }`), and recipes don't survive a
plain round-trip. For a lossless refract-to-refract trip, opt in:

```ts
import { toDTCG, fromDTCGTheme } from "@theme-registry/refract/dtcg";

const doc = toDTCG(theme, { includeRecipes: true }); // stashes the whole built Model under a $extensions key
const restored = fromDTCGTheme(doc, { adapter: createCssAdapter() }); // byte-identical Model back
```

- `toDTCG(theme, { includeRecipes: true })` writes the built **property Model** (incl. modes /
  responsive / derivations / external) **and** rule-set / keyframe / container IR under the
  reverse-DNS `$extensions` key **`com.theme-registry.refract`** (with a `version`). Off by default →
  standard output is byte-identical.
- `fromDTCGTheme(doc, { adapter })` is the lossless entry — `fromDTCG` for the portable tokens **plus**
  re-injects the stashed Model, reproducing a byte-identical theme.
- **Not portable:** other DTCG tools ignore that extension and see the resolved property tokens only.

## External tokens ↔ DTCG aliases

An `external` token (a passthrough to a **parent-owned** var) is kept out of the portable token
surface (a `var(--…)` colour can't be re-imported) — it round-trips via the extension above. Going
the other way, a DTCG **alias** `"{group.token}"` whose target is **absent** from the document is
treated as genuinely external and imported as a refract `external` token (`{color.brand}` →
`{ external: "colors.brand" }`, named by the same colour rules as an import of the parent); a
**resolvable** same-document alias flattens to its literal as before.

## Programmatic API

The same conversions are on the `@theme-registry/refract/dtcg` subpath:

- `importDTCG(doc, opts?)` → `{ raw, report }` — the raw theme plus `placements`, `unmapped` (with
  reasons), `bases`, `renamed`, `notes`, `diagnostics`.
- `fromDTCG(doc, opts?)` → a raw theme input (`importDTCG(doc).raw`).
- `defineImporter(spec)` → an importer; pass it as `importDTCG(doc, { importer })`. `dtcgImporter` is
  the default; `runImporter(importer, doc, opts)` runs one directly.
- `toDTCG(theme, opts?)` → a DTCG document (`opts.includeRecipes` adds the round-trip extension).
- `fromDTCGTheme(doc, { adapter, ... })` → a built `Theme` with recipes restored (lossless round-trip).
- `readRefractExtension(doc)` → the `com.theme-registry.refract` payload, or `undefined`.
- `parseDTCGGraph(doc)` → the token graph: `tokens` (typed, canonical values, `alias` / `external` /
  `references`, `deprecated`, `extensions`), `byId`, `diagnostics`, and the document's `extensions`.
- `parseDTCGDocument(doc)` — the graph flattened to resolved tokens with 2024-style string values.
