---
"@theme-registry/refract": patch
---

Read and write themes as Refract DTCG profile files: DTCG 2025.10 tokens plus one extension key, `com.theme-registry.refract.profile`, for what the spec can't express. Modes use the DTCG Resolver. The format is described by a JSON Schema, `schema/dtcg-profile/v1.json` in the package, also served at `https://theme-registry.github.io/refract/schema/dtcg-profile/v1.json`.

- `raw` in a build config can be a profile file path: `raw: "./tokens/resolver.json"` (or a `.tokens.json`).
- `./dtcg`: `importDTCGProfile(input)` and `fromDTCGProfile(input)` read a token file or `{ resolver, files }`; `toDTCG(raw, { profile: true })` writes a raw theme as profile files that read back into the same theme.
- `./build`: `loadDTCG(path)` and `loadDTCGProfile(path)` read a resolver and its files from disk.
- CLI: `refract tokens --profile` writes `resolver.json` plus token files; `refract validate <file>` reads and builds a profile and reports what it found.
- New error code `REFRACT_E_PROFILE`.

The `./dtcg` size budget moves from 10 KB to 19 KB gzip for the profile reader and writer. Plain `toDTCG(theme)` output is unchanged.
