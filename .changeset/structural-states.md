---
"@theme-registry/refract-css": patch
"@theme-registry/refract-styled-components": patch
"@theme-registry/refract-scss": patch
---

Recipe `states` gain the structural states a design system's components need: `focus-visible`,
`focus-within`, `checked`, `indeterminate`, `selected` (`[aria-selected="true"]`), `expanded`
(`[aria-expanded="true"]`), `placeholder-shown`, `invalid` (`[aria-invalid="true"]`), and the wrapper
forms `has-focus-visible`, `has-checked`, `has-indeterminate`, `has-invalid`, `has-disabled`
(`:has(…)`), so a label or field box is styled from the control inside it. The existing states keep
their order, so themes that don't use the new ones emit byte-identical output.
