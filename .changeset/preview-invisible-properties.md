---
"@theme-registry/refract": patch
---

Make `preview.html` aware of CSS properties that paint nothing on their own, and stop presenting comparable colour recipes two different ways.

**`border-color` was rendering as a blank box.** A `colors.border` recipe emits exactly one declaration — `border-color` — and `border-style` initially resolves to `none`, so nothing was drawn at all. The specimen now supplies the missing companion (`border-style` + `border-width`) so the declared colour can be seen, and **says on the page that it did**, because a reader must never conclude their theme sets a 3px border when the preview added it. The emitted stylesheet is untouched; this is a specimen affordance only. The same applies to `outline-color`, `text-decoration-color` and `column-rule-color`, and to the symmetric case where a rule-set sets a width but no style.

**`colors.surface` and `colors.container` looked unrelated.** Both are background + foreground pairings, but `container` declares states, which routed it to the state matrix where cells rendered at text size — so one appeared as full swatches and the other as tiny blobs, for no reason a reader could see. Matrix cells now get the same swatch treatment as the grid.

**Filling is for rule-sets that express a value, not for components.** A `components` recipe is shown at whatever size it really is, even when that is text-sized, because that is the truth about the recipe; stretching a button to fill its stage would misrepresent it.

A rule-set that emits no declarations and composes nothing now says so rather than rendering an unexplained empty box.
