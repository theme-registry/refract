---
"@theme-registry/refract-mcp": minor
---

Add `@theme-registry/refract-mcp` — a Model Context Protocol server that exposes a project's refract theme to an AI agent as live tools (`resolveToken`, `listTokens`, `findToken`, `listRecipes`, `getClass`, `validateTheme`). It is **project-scoped**: it loads the project's `theme.config.(ts|js|mjs)` once at startup (auto-discovered, or via `--config`), serves queries against the held theme without the agent resending it, and reloads on file change. Built on the official `@modelcontextprotocol/sdk` over stdio; published on the `latest` tag in lockstep with core and the adapters.
