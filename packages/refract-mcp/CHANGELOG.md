# @theme-registry/refract-mcp

## 0.1.1

### Patch Changes

- Updated dependencies
  - @theme-registry/refract@0.1.1

## 0.1.0

Initial public release — a Model Context Protocol server that exposes a project's refract theme to an
AI agent as live tools (`resolveToken`, `listTokens`, `findToken`, `searchTokens`, `listRecipes`,
`getClass`, `renderRecipe`, `checkContrast`, `validateTheme`, `diffTheme`, `reload`) plus two resources
(`refract://llms.txt`, `refract://manifest.json`). Project-scoped: it loads the project's
`theme.config.(ts|js|mjs)` once at startup (auto-discovered, or via `--config`), serves queries against
the held theme without the agent resending it, and reloads on file change. Built on the official
`@modelcontextprotocol/sdk` over stdio.
