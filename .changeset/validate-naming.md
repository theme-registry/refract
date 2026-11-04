---
"@theme-registry/refract": patch
---

`refract validate` now catches names that collide once written as CSS variables or classes — two token or recipe names that differ only in case, or `a-b` + `c` against `a` + `b-c` — with the same `REFRACT_E_NAMING` error `refract build` throws. Before, validate passed such a file and the build was the first to fail.
