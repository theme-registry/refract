# refract-mcp — live smoke test

A 5-minute check that the server works inside a real MCP client (Claude Code) — the thing unit tests
and a hand-fed stdio session can't prove. Run it after any change to the server or its transport.

## 1. Throwaway config

Save as `~/refract-mcp-smoke/theme.config.mjs` (self-contained — no imports, so it loads anywhere):

```js
export default {
  raw: {
    colors: {
      brand:  { base: "#4c6ef5", text: "#ffffff" },
      accent: { base: "#e8590c", text: "#ffffff" },
      recipes: {
        solid: {
          brand:  { background: "brand",  color: "brand.text",  states: { hover: { background: "brand.dark" } } },
          accent: { background: "accent", color: "accent.text" },
        },
      },
    },
    components: {
      recipes: {
        buttons: {
          primary: { colors: "solid.brand", css: { padding: "10px 16px", borderRadius: "8px", cursor: "pointer" } },
        },
      },
    },
  },
  targets: [],
};
```

## 2. Build + register

```sh
pnpm --filter @theme-registry/refract-mcp build     # → dist/server.js

# register with Claude Code, pointing at the config by absolute path
claude mcp add refract -- \
  node "$(git rev-parse --show-toplevel)/packages/refract-mcp/dist/server.js" \
  --config ~/refract-mcp-smoke/theme.config.mjs
```

Alternatively, drop `--config` and run `claude` **from** `~/refract-mcp-smoke/` — the server
auto-discovers `theme.config.mjs` in the launch directory.

## 3. Verify

Start a session (`claude`), then:

```
/mcp
```

→ **refract** should be connected with 6 tools: `resolveToken · listTokens · findToken · listRecipes ·
getClass · validateTheme`.

Ask things that force each tool (confirm it *calls the tool*, not guesses):

| Ask | Tool | Expected |
| --- | --- | --- |
| "Use the refract MCP: what class for `components buttons primary`?" | `getClass` | `dt-components-buttons-primary` + `dt-colors-solid-brand` |
| "What does `colors.brand.dark` resolve to?" | `resolveToken` | `rgb(51, 77, 210)` |
| "List every recipe in the theme." | `listRecipes` | includes `colors/solid/brand`, `components/buttons/primary` |
| "Which tokens start with `colors.accent`?" | `findToken` | `colors.accent`, `colors.accent.dark`, … |
| "Is this valid: `{ colors: { x: { base: 'nope' } } }`?" | `validateTheme` | `ok:false`, `perTarget[].code` `REFRACT_E_COLOR_INPUT` |

**Pass** = `/mcp` shows it connected and at least `getClass` returns the real class above (not a guess).

## 4. Cleanup

```sh
claude mcp remove refract
rm -rf ~/refract-mcp-smoke
```

## Notes

- Not published yet, so this uses the local `dist/server.js`. Once published: `claude mcp add refract
  -- npx -y @theme-registry/refract-mcp`.
- A `.ts` config that imports `@theme-registry/refract/build` won't resolve inside *this* pnpm
  workspace (workspace packages aren't in the root `node_modules`); a normal `npm install` project
  resolves it fine. This smoke config avoids the issue by importing nothing.
