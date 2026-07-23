/**
 * CSS variable / class naming (§17) — the CSS adapter uses the shared uniform text-adapter naming
 * (single adapter-wide `prefix`/`classPrefix`, subsystem carried in the token path, single-dash
 * separators), identical to the SC adapter. This module just re-exports those shared helpers under
 * the CSS adapter's local names so the lowering call sites stay stable.
 */
export {
  sanitizeSegment as sanitizeIdentifierSegment,
  varNameFromPath,
  recipeClassName,
  resolveNaming,
  createNamer,
} from "@theme-registry/refract/adapter-kit";
export type { AdapterNaming, AdapterNamer, NamingOverrides, VarNamer } from "@theme-registry/refract/adapter-kit";
