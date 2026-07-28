---
"@theme-registry/refract": patch
---

Fix two ways `preview.html` misrepresented a theme's palette, both found by rendering a real theme in a browser rather than by reading the code.

**The base-rung marker never fired, and the page claimed otherwise.** The palette note read "the marked rung is the family's `base`", but the marker was chosen by comparing the base's hex against each rung's hex. A numeric `steps` ladder is an absolute lightness scale (`L = (1000 − label) / 10`) and refract deliberately does **not** snap the seed onto it — `refract create` reports where a seed lands rather than moving it — so that equality essentially never held and nothing was ever marked. The preview now finds the nearest rung by OKLCH lightness and says where the base *lands* (`#14b8a6` → `lands ≈ 300`), which is both true and the question a reader actually has.

**Contrast was scored on tokens that never declared a pairing.** Every member of a colour family was rendered against the family's `text`, including synthesized tints like `brand.dark` and `surface.lighter`. Those were never meant to carry that text, so the page filled with `fail` badges that read as a defect in the user's theme when nothing was wrong. Contrast is now scored only where the pairing is genuinely declared — the family base against its own `text` — and derived tints render as plain swatches.

