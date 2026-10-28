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
```

Turns a DTCG document into a `createTheme` raw input (and, unless `--raw-only`, a starter
`theme.config`). Flags: `--out <file>`, `--raw-only`, `--force`, `--breakpoint-group <name>`,
`--breakpoints <n:px,…>` (DTCG has no breakpoint concept, so supply them). After importing, the
palettes/scales are plain tokens — layer refract's synthesis (`steps`, `ratio`), recipes, and
composition on top by hand.

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

### Known limits — tell the user

The parse is complete, but **mapping to subsystems is still heuristic** (by `$type` and group name):

- Colour properties are keyed by the **second path segment**, so `border.primary`, `brand.primary`
  and `panel.main` collide and overwrite each other.
- Groups the heuristic can't place are **dropped without a warning**; mixed groups (e.g. an
  `elevation` group with a colour `$root` and dimension children) land in one subsystem.
- **Shadows don't build yet**: the import writes a CSS string, which `effects.shadow` rejects. Remove
  or hand-author shadows in the generated `theme.raw.ts`.
- Aliases are kept in the graph, but the generated raw theme still holds **resolved literals**.

So after `refract import`, diff the token count against the source document and review the raw theme.

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
`{ external: "colors.brand" }`); a **resolvable** same-document alias flattens to its literal as before.

## Programmatic API

The same conversions are on the `@theme-registry/refract/dtcg` subpath:

- `fromDTCG(doc, opts?)` → a raw theme input.
- `toDTCG(theme, opts?)` → a DTCG document (`opts.includeRecipes` adds the round-trip extension).
- `fromDTCGTheme(doc, { adapter, ... })` → a built `Theme` with recipes restored (lossless round-trip).
- `readRefractExtension(doc)` → the `com.theme-registry.refract` payload, or `undefined`.
- `parseDTCGGraph(doc)` → the token graph: `tokens` (typed, canonical values, `alias` / `external` /
  `references`, `deprecated`, `extensions`), `byId`, `diagnostics`, and the document's `extensions`.
- `parseDTCGDocument(doc)` — the graph flattened to resolved tokens with 2024-style string values.
