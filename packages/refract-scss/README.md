# @theme-registry/refract-scss

> **Experimental.** Reachable via the npm `experimental` dist-tag; the output shape may still change.

The **SCSS adapter** for [refract](https://www.npmjs.com/package/@theme-registry/refract) — emits Sass
`$variables` + classes.

**Docs, live playground & API:** <https://theme-registry.github.io/refract/>

```bash
npm install @theme-registry/refract @theme-registry/refract-scss
```

```ts
import { createTheme } from "@theme-registry/refract";
import { createScssAdapter } from "@theme-registry/refract-scss";

const theme = createTheme(raw, { adapter: createScssAdapter() });
theme.scss;   // $variables + classes
```

Options: `inline`, `indent`, `prefix`, cascade `@layer`. Peer-depends on `@theme-registry/refract`.
See the [SCSS adapter docs](https://theme-registry.github.io/refract/a-scss).

MIT © Petyo Stoyanov
