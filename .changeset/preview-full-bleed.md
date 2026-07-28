---
"@theme-registry/refract": patch
---

Make `preview.html` fill the viewport.

The page capped itself at 1260px while painting its background only on its own shell, so on a wide screen it floated as a panel over an unpainted body — with mismatched bands down both edges. Three causes, all fixed: the width cap is gone (the shell is now `width:100%` + `min-height:100vh`, so the ground covers the viewport), the UA's default 8px body margin is reset, and the page declares `color-scheme: light dark` so the browser's own canvas and scrollbars match in dark mode.

The two document-level rules are written with `:where()`, giving them zero specificity — a theme's own `globals` rules still win, so the chrome never outranks the theme it is displaying. Per-element measure caps (prose at 64ch, leading samples at 52ch) are unchanged, so text stays readable at any window width while ladders, the state matrix and the swatch grid get the room they were being denied.
