// Bundle entry for the docs showcase.
//
// The showcase compiles themes in the browser using the REAL library — this re-exports just the
// runtime surface the page needs from the published packages (resolved via the website workspace's
// workspace:* links → each package's built dist). `scripts/bundle.mjs` wraps this into a single IIFE
// (`window.refract`), stubbing styled-components so the CSS adapter path bundles without pulling React.
//
// Post monorepo split each adapter is its own package (not a subpath of core): createTheme comes from
// `@theme-registry/refract`; every adapter from its own `@theme-registry/refract-<format>` package.
export { createTheme, isKnownCssProperty } from "@theme-registry/refract";
export { createCssAdapter } from "@theme-registry/refract-css";
export { createScssAdapter } from "@theme-registry/refract-scss";
export { createJsonAdapter } from "@theme-registry/refract-json";
export { createStyledComponentsAdapter } from "@theme-registry/refract-styled-components";
