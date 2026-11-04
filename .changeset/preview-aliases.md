---
"@theme-registry/refract": patch
---

`preview.html`: an aliased colour now shows its target's colour instead of a blank swatch (the alias
path was written into the swatch's `background`), and is tagged **alias** rather than **gen**. Recipe
specimens are clipped to their stage, so a layer that positions itself absolutely no longer escapes
over the page.
