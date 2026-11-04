---
"@theme-registry/refract": patch
"@theme-registry/refract-css": patch
"@theme-registry/refract-styled-components": patch
"@theme-registry/refract-scss": patch
---

Component recipe states take an optional `within: "<recipe>"`: the override applies to the part while
that sibling recipe of the same group (usually `root`) is in the state, so an inner part follows its
component's hover / checked / invalid state: `.t-components-checkbox-root:has(:checked)
.t-components-checkbox-tick`. CSS adapter; an unknown `within` fails the build. The SCSS and
styled-components adapters skip `within` entries for now.
