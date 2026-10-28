---
"@theme-registry/refract": patch
---

Read DTCG 2025.10 documents on import.

**2025.10 values are now understood.** Colour objects (`{ colorSpace, components, alpha?, hex? }`), `{ value, unit }` dimensions and durations, and font-weight names used to reach `fromDTCG` as objects and land in the raw theme as `"[object Object]"`. On a real Figma export most such values came out this way. They now parse into canonical shapes; 2024-draft strings parse into the same shapes, so both versions import the same way. `srgb`, `srgb-linear`, `hsl`, `hwb`, `oklab` and `oklch` convert natively; other colour spaces are read through their `hex` fallback.

**`$root`, `$ref`, `$extends`, `$deprecated`.** A group's `$root` token was skipped, leaving every `{group.$root}` alias unresolved; it is now read as the group's `base`. JSON Pointer `$ref`s resolve (including into part of another value), `$extends` groups are deep-merged, and `$deprecated` and every tool's `$extensions` are kept.

**New: `parseDTCGGraph(doc)`** on `@theme-registry/refract/dtcg` returns the parsed document as a token graph: typed tokens with canonical values, alias edges kept rather than flattened, and a diagnostic for anything the spec doesn't allow, where the old walker fell back silently (an untyped token used to be read as a colour). `parseDTCGDocument` is now a view over the graph. A `#/…` pointer to nothing is an error rather than an external alias.

Mapping groups onto subsystems is unchanged, including its known limits (colour-name collisions, shadows that don't build). The `./dtcg` size budget rises from 4.5 KB to 7.5 KB gzip for the parser.
