# @theme-registry/refract-mcp

## 0.1.7

### Patch Changes

- 27719be: Fix an endless reload loop when the MCP server runs against a `.ts` `theme.config`.

  Loading a `.ts` config graph-compiles it to hidden `.<base>.<pid>-<n>.mjs` files emitted beside each
  compiled source (adjacency is what keeps relative sibling specifiers resolvable), which are imported and
  then unlinked. Those writes and deletes matched the config watcher's source pattern and weren't ignored,
  so every load woke the watcher, which reloaded, which emitted them again — a self-sustaining loop with no
  user edit involved, churning the config's directory (visible in an editor as a file tree that never stops
  refreshing).

  The watcher now skips any hidden path — which also stops spurious reloads from `.next` / `.turbo` /
  `.cache` build churn when the config sits at a monorepo root — and reloads no longer overlap, so nothing
  a load writes can start another one. Edits landing mid-reload are still picked up.
  - @theme-registry/refract@0.1.7

## 0.1.6

### Patch Changes

- Updated dependencies [5a8f126]
  - @theme-registry/refract@0.1.6

## 0.1.5

### Patch Changes

- Updated dependencies [6a87cb1]
  - @theme-registry/refract@0.1.5

## 0.1.4

### Patch Changes

- Updated dependencies [e6861d2]
  - @theme-registry/refract@0.1.4

## 0.1.3

### Patch Changes

- Updated dependencies [1c439a1]
  - @theme-registry/refract@0.1.3

## 0.1.2

### Patch Changes

- The bin entry resolves symlinks on both sides, so the server starts when launched through a `node_modules/.bin/refract-mcp` symlink instead of silently exiting 0; a start-up failure now exits non-zero with a message. Documents the `reload` tool (the README listed 10 of 11) and the named-vs-positional `getClass` argument shapes.
- Updated dependencies
  - @theme-registry/refract@0.1.2

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
