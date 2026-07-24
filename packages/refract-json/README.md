# @theme-registry/refract-json

> **Experimental.** Reachable via the npm `experimental` dist-tag; the output shape may still change.

The **JSON adapter** for [refract](https://www.npmjs.com/package/@theme-registry/refract) — emits
refract's own richer document (tokens plus rule-sets, keyframes, and composition) as address-keyed JSON.
Proves the adapter contract is format-generic (`TUnit = object`).

**Docs, live playground & API:** <https://theme-registry.github.io/refract/>

```bash
npm install @theme-registry/refract @theme-registry/refract-json
```

```ts
import { createTheme } from "@theme-registry/refract";
import { createJsonAdapter } from "@theme-registry/refract-json";

const theme = createTheme(raw, { adapter: createJsonAdapter() });
theme.json;   // the Model as data
```

> For standardized W3C **DTCG** token interchange (Figma / Style Dictionary), use core's `./dtcg`
> subpath instead — that's property-token interop, not this richer app-facing document.

Peer-depends on `@theme-registry/refract`. See the [JSON adapter docs](https://theme-registry.github.io/refract/a-json).

MIT © Petyo Stoyanov
