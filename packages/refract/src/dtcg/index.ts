/**
 * Design Token Community Group (DTCG / W3C) interop — a **data-interchange** surface,
 * NOT an output adapter. It reads/writes the standard `tokens.json` format so a theme
 * can round-trip through Figma / Style Dictionary / other DTCG tooling.
 *
 *  - `fromDTCG(doc, opts?) -> raw` — a DTCG document → a `createTheme` raw input.
 *  - `toDTCG(theme, opts?) -> doc` — a built theme's flat `theme.tokens` → a DTCG document.
 *  - `parseDTCGDocument(doc)` — the low-level walker (resolves `{ref}` chains → resolved tokens).
 *  - `fromDTCGTheme(doc, { adapter })` — the lossless `refract → DTCG → refract` round-trip entry.
 *
 * Model-first: `toDTCG` walks the flat `theme.tokens` map + `theme.resolveToken` + the Model's
 * breakpoints. The interoperable surface is **property tokens only** — recipes / composition are out
 * of standard DTCG scope. Opt-in `toDTCG(theme, { includeRecipes: true })` stashes the built rule-set
 * IR under the reverse-DNS `com.theme-registry.refract` `$extensions` key so a document round-trips
 * back through `fromDTCGTheme`; other DTCG tools ignore that key. DTCG does not go through the
 * `ThemeAdapter` contract.
 */
export * from "./types";
export * from "./parse";
export * from "./import";
export * from "./export";
