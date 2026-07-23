---
"@theme-registry/refract": minor
---

Split the toolkit into a pnpm monorepo. Core (`@theme-registry/refract`) now ships zero adapter
implementations — every adapter is its own installable package: `@theme-registry/refract-css`,
`@theme-registry/refract-styled-components`, `@theme-registry/refract-scss`,
`@theme-registry/refract-json`. Install core plus only the adapter formats you use; the
`styled-components` peer now lands only on `@theme-registry/refract-styled-components`.

Core keeps everything adapter-*enabling*: the `createTheme`/`defineAdapter`/`ThemeAdapter` contract,
the Model/RawTheme types, the DTCG interop (`./dtcg`), the OKLCH color-math (`./color-math`), the
shared naming helpers (new `./adapter-kit` subpath), and the `refract` CLI. The DTCG export is
unchanged — it now builds through a trivial built-in `createNoopAdapter`, so the CLI no longer depends
on any adapter package.

All five packages version and publish in lockstep through `0.x` (Changesets `fixed` group).
