---
"@theme-registry/refract": patch
"@theme-registry/refract-css": patch
---

Redesign `preview.html` as a proper style guide.

The first version was a token dump: a flat row per token, one at-rest specimen per recipe, and chrome that competed with the theme's own colours. It now reads as a specimen sheet — sticky section rail with counts, colour families as contiguous ladders with live WCAG contrast readouts on each `text` pairing, the type ramp set in its own sizes, leading shown on wrapped text, spacing rendered as a measure *and* as an applied inset and gap, and a copy-on-click identifier beside every specimen. Sections appear only when the theme actually has tokens of that kind, and full DTCG coverage means `lineHeight`, `letterSpacing`, `borderWidth`, `borderStyle`, `outlineOffset`, `blur`, `opacity`, `zIndex`, `gutters`, `sizes`, `aspectRatio` and `transition` now all appear; an unrecognized group still renders rather than being dropped.

Three additions show what only a compiler's specimen sheet can:

- **State matrix.** Recipe states render side by side instead of on hover. A CSS pseudo-class can't be triggered from markup, so the CSS adapter emits parallel pinnable rules (`.cls.rfp-s-hover`) that are inlined into the page — and deliberately never added to the emitted stylesheet a consumer ships.
- **Appearance-mode diff.** A table of the tokens that actually carry an override, base value → override value. The toggle shows the result; this shows the cause.
- **Composition breakdown.** A component's class list split into its parts, each attributed to the recipe it came from.

Bare elements themed by the `globals` subsystem get their own prose specimen, since they carry no class at all. `PreviewDescriptor` gains five optional fields for this (`tokenName`, `states`, `statePinClass`, `statePinCss`, `composition`); all are optional, so the adapter contract stays additive.

Two legibility bugs fixed along the way: specimen geometry used the page ground on a barely-different stage, which made radius, border and padding specimens near-invisible in dark mode, and the chrome assumed a light theme. Geometry now uses a dedicated mid-tone that reads at the same weight on both grounds.
