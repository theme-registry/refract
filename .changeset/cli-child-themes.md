---
"@theme-registry/refract": patch
---

`refract build` builds the child themes of a Refract DTCG profile's `"as": "themes"` modifiers instead of refusing the profile. The default context builds into each target's `outDir` as before; every other context builds into `<outDir>/<context>/` (`<modifier>-<context>` when there are several such modifiers) as a complete theme with the same class names and its own values. `loadConfig` returns the child themes as `themes`.
