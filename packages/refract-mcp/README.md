# @theme-registry/refract-mcp

> A [Model Context Protocol](https://modelcontextprotocol.io) server for refract. It
> lets an AI agent (Claude Code, claude.ai, or any MCP client) **query and validate your project's
> theme** while authoring — the "middleware" that keeps an agent bound to the theme's real vocabulary
> instead of guessing.

It is **project-scoped**: it loads your `theme.config.(ts|js|mjs)` once at startup and serves queries
against it, so the agent asks about *your* theme without ever resending it. It reloads on change.

## Tools

| Tool | Answers |
| --- | --- |
| `resolveToken` | What does `colors.brand.dark` resolve to — its value, CSS `varName`, `unit`, and `derivedFrom`? |
| `listTokens` | What token paths exist (the addressable vocabulary)? |
| `findToken` | Which token paths start with a prefix? |
| `searchTokens` | Which tokens match a query on their path OR resolved value? |
| `listRecipes` | What recipes are defined? |
| `getClass` | What real class (and composed class-list) does a recipe get — with the project's configured prefix? |
| `renderRecipe` | What exact CSS does one recipe emit? |
| `checkContrast` | Do the theme's colour pairings pass WCAG-2 (+ advisory APCA)? |
| `validateTheme` | Is a candidate theme valid on every configured target? — returns **every** problem at once (collect-all), per target. |
| `diffTheme` | What's the blast radius of a candidate edit — which tokens moved, classes changed, pairings crossed a threshold, targets stopped building? |

`diffTheme` is the plan-then-apply guardrail: pass a **candidate edit** and it builds it against the
project's real adapters and reports the blast radius *before* the agent writes — the claim a token file
can't make. `validateTheme` surfaces refract's collect-all errors with their stable `code` per target, so
an agent fixes all problems in one pass and catches adapter-level rules (unknown state, naming collision)
a generic check would miss. `getClass` / `resolveToken` read the real emitted names, so the prefix matches
what ships. The query tools take no
`theme` argument — they read the loaded project theme.

## Architecture

Pure tools (`src/tools.ts`, unit-tested) operate on a built `Theme` the server holds; `callTool`
(`src/server.ts`) is the transport-agnostic dispatch core; the transport is the official
`@modelcontextprotocol/sdk` over stdio.

```
agent ⇄ (MCP stdio, SDK) ⇄ callTool ⇄ tools.ts ⇄ the project theme (loaded once from theme.config)
```

## Connect

Register the server with your agent. Once published:

```sh
claude mcp add refract -- npx -y @theme-registry/refract-mcp
```

Or from a local build:

```sh
pnpm --filter @theme-registry/refract-mcp build      # → dist/server.js (a runnable bin)
claude mcp add refract -- node ./packages/refract-mcp/dist/server.js
```

The server auto-discovers `theme.config.(ts|js|mjs)` in the working directory; pass `--config <path>`
to point elsewhere. A `.ts` config needs the `typescript` optional peer (same as `refract build`).

For project scope, commit a `.mcp.json`:

```json
{ "mcpServers": { "refract": { "command": "npx", "args": ["-y", "@theme-registry/refract-mcp", "--config", "theme.config.ts"] } } }
```

## Test

```sh
pnpm --filter @theme-registry/refract-mcp test
```

## Notes

- **Stable** — published on the npm `latest` tag in lockstep with core and the adapters.
- It's the **refract half** of a *Figma → refract → AI* loop: an agent reads a design, authors a theme,
  and `validateTheme` is the guardrail that stops it drifting.
