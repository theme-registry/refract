/**
 * Design Token Community Group (DTCG / W3C) interop — a **data-interchange** surface,
 * NOT an output adapter. It reads/writes the standard `tokens.json` format so a theme
 * can round-trip through Figma / Style Dictionary / other DTCG tooling.
 *
 *  - `fromDTCG(doc, opts?) -> raw` — a DTCG document → a `createTheme` raw input.
 *  - `importDTCG(doc, { importer? })` — the same plus a report; `defineImporter` builds an importer from
 *    the default `dtcgImporter` by overriding its `parse` / `place` / `value` / `finalize` hooks.
 *  - `toDTCG(theme, opts?) -> doc` — a built theme's flat `theme.tokens` → a DTCG document.
 *  - `parseDTCGGraph(doc)` — the token graph: DTCG 2025.10 (or 2024-draft) tokens with canonical
 *    values, alias edges, `$root`, resolved `$extends` / `$ref`, preserved `$extensions`, diagnostics.
 *  - `parseDTCGDocument(doc)` — the flat 2024-string view of the graph that `fromDTCG` maps from.
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
export { parseDTCGGraph } from "./graph";
export type { DTCGTokenGraph, DTCGGraphToken, DTCGDiagnostic, DTCGDiagnosticCode } from "./graph";
export * from "./parse";
export * from "./import";
export { IMPORTER_CONTRACT_VERSION, runImporter, isImporter, isImportSkip } from "./importer";
export type {
  DTCGImportSubsystem,
  FromDTCGOptions,
  DTCGImportReport,
  DTCGImportResult,
  ImportSkip,
  ImportPlacement,
  ImportContext,
  Importer,
  ImporterSpec,
} from "./importer";
export { dtcgImporter } from "./dtcgImporter";
export * from "./export";
