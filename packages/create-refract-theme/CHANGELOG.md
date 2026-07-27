# create-refract-theme

## 0.2.0

### Minor Changes

- Offer AI skills and the MCP server while scaffolding. A new "Agent tooling" prompt installs refract's
  bundled skills for the agent CLIs you pick, and wires a project-scoped `.mcp.json` plus the
  `@theme-registry/refract-mcp` dependency. Flags: `--skills`, `--agent <a,b>`, `--mcp`, `--no-agent`.

## 0.1.0

Initial release.

`npm create refract-theme my-theme` scaffolds a publishable design-system package from one seed
colour: a `theme.raw.(ts|js|json)`, a build config wired to it, and a `package.json` with real
exports and `prepublishOnly`.

Requires `@theme-registry/refract` 0.1.3 or later — it calls the theme generator that shipped there.
