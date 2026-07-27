---
"@theme-registry/refract": patch
---

Fix `__dirname is not defined` when the `./build` subpath is used from an ESM consumer. Package-root
discovery defaulted to `__dirname`, which only exists in the CJS bundle — so `runInit`, `runCreate`
and `runSkillsInstall` all threw for ESM callers. It went unnoticed because the only consumer was
refract's own CLI, which ships as CJS.
