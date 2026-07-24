# @theme-registry/refract-styled-components

The **styled-components adapter** for [refract](https://www.npmjs.com/package/@theme-registry/refract) —
emits TS/JS theme modules: a literal `theme` object, tree-shakeable `css` recipes, a `GlobalStyle`, and
(in TS) a `theme.d.ts` that augments styled-components' `DefaultTheme`.

**Docs, live playground & API:** <https://theme-registry.github.io/refract/>

```bash
npm install @theme-registry/refract @theme-registry/refract-styled-components styled-components
```

```ts
import { createTheme } from "@theme-registry/refract";
import { createStyledComponentsAdapter } from "@theme-registry/refract-styled-components";

const theme = createTheme(raw, { adapter: createStyledComponentsAdapter() });
```

Peer-depends on `@theme-registry/refract` and `styled-components`. See the
[styled-components adapter docs](https://theme-registry.github.io/refract/a-sc).

MIT © Petyo Stoyanov
