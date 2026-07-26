---
"@theme-registry/refract": patch
---

Add `refract create` — generate a complete `RawTheme` from one seed colour, with a WCAG contrast pass
that runs before the file is written. `refract init` now detects an existing `theme.raw.*` and writes
a config that imports it instead of carrying its own starter palette (unchanged when no theme is
found). Ships the `theme-scaffold` skill.
