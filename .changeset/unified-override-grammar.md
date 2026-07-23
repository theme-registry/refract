---
"@theme-registry/refract": minor
---

Unify the override grammar — `modes`, `states`, and `responsive` are now three arrays of overrides
over one shared spine (WHEN · WHERE · WHAT). **Breaking authoring change** (pre-1.0).

**Breaking:**

- **Property `modes` is a LIST**, not a map: `modes: [{ mode: "dark", base: "#111" }]` (was
  `modes: { dark: "#111" }`). The bare `dark: "#hex"` shorthand is gone — spell the value with `base:`.
- **Recipe / globals `states` is a LIST**: `states: [{ state: "hover", … }]` (was
  `states: { hover: { … } }`). The legacy map form is still accepted at authoring during the
  transition and normalizes to the list.
- **Colour derivation-spec variants use a `modifiers` chain**: `{ modifiers: [{ darken: 10 }] }`
  (was the single dial `{ darken: 10 }`). The chain applies left-to-right and the same shape is the
  value form for a mode and a responsive entry.

**New capabilities:**

- **Cross-property derivations** — a variant/mode may derive from another property
  (`{ ref: "colors.brand", modifiers: [{ darken: 12 }] }`); resolved post-build and re-derived on
  `override()`.
- **`target` on modes and states** — scope an override into a variant's var (modes) or onto a
  recipe variant's `<item>-<variant>` sibling (states).
- **Top-level `modes` registry** — `modes: ["dark", "light", "hc"]` declares valid appearance modes
  (undeclared modes throw).
- **Variant `base` is optional and inherits** the property base; a property `responsive` entry gains
  a `mode` condition; responsive `ref` (read) + `target` (write) compose.

**DTCG interop:** `toDTCG(theme, { includeRecipes: true })` now round-trips the **whole Model**
losslessly (modes / responsive / derivations / external) via the `com.theme-registry.refract`
extension; a genuinely-external DTCG alias imports as an `external` token.
