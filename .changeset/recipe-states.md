---
"@theme-registry/refract": patch
"@theme-registry/refract-css": patch
"@theme-registry/refract-scss": patch
"@theme-registry/refract-styled-components": patch
---

Recipe states for design-system components. A list-form state entry now answers up to four
questions: `state` (what the element is), `has` (what it contains), `within` (whose element it is)
and `target` (which variant).

- **State names**: a CSS state (`hover`, `focus`, `focus-visible`, `focus-within`, `active`,
  `checked`, `indeterminate`, `placeholder-shown`, `disabled`, `link`, `visited`) or `aria-<name>`
  for a WAI-ARIA state (`aria-selected` → `[aria-selected="true"]`). Anything else still fails the
  build. `pressed` is now an alias of `aria-pressed` and writes `[aria-pressed="true"]` (it wrote
  `[aria-pressed]`, which also matched `aria-pressed="false"`).
- **`has`** (components): `has: "checked"` or `has: { state: "checked" }` → `:has(:checked)`, so a
  wrapper (a label, a field box) is styled from the control inside it. An entry needs `state`, `has`
  or both (`:hover:has(:checked)`).
- **`within`** (components, CSS adapter): `within: "root"` applies the entry while a sibling recipe of
  the same component meets the condition — `.<group>-root:has(:checked) .<group>-tick` — including
  each variant of that recipe, and with `target` for one variant of the part.
- The SCSS and styled-components adapters render the new states and `has`; they fail on `within`
  for now. The Refract DTCG profile reads and writes `has` and `within`.

Themes that use none of these emit the same CSS as before, except `pressed`.
