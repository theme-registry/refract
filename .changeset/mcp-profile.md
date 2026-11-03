---
"@theme-registry/refract-mcp": patch
"@theme-registry/refract": patch
---

refract-mcp works with Refract DTCG profile files: a config whose `raw` is a profile path loads and reloads like any other, and the server also watches the profile's folder when it's outside the config's. `validateTheme` and `diffTheme` accept a candidate written as a profile (a token file, or `{ resolver, files }`). `loadConfig` returns the profile's absolute path as `profilePath`.
