# @theme-registry/refract-css

The **CSS adapter** for [refract](https://www.npmjs.com/package/@theme-registry/refract) — lowers a
theme Model to `:root` custom properties + class rules. The batteries-included default adapter.

**Docs, live playground & API:** <https://theme-registry.github.io/refract/>

```bash
npm install @theme-registry/refract @theme-registry/refract-css
```

```ts
import { createTheme } from "@theme-registry/refract";
import { createCssAdapter } from "@theme-registry/refract-css";

const theme = createTheme(raw, { adapter: createCssAdapter() });
theme.css;        // full stylesheet — :root vars + .classes
theme.classes;    // recipe → className map
```

Emit modes (`single` / `split` / `subsystem` / `components`), inline value baking, scope namespacing,
an opt-in cascade `@layer`, and naming overrides — see the [CSS adapter docs](https://theme-registry.github.io/refract/a-css).
Peer-depends on `@theme-registry/refract`.

MIT © Petyo Stoyanov
