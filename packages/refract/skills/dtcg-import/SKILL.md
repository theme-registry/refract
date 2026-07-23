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
- `parseDTCGDocument(doc)` — low-level walker resolving `{ref}` chains.
