import typescript from "@rollup/plugin-typescript";

// @theme-registry/refract-mcp — bundles the MCP server (`src/server.ts` + the pure `tools.ts`) into a
// single runnable ESM bin (`dist/server.js`, shebang'd). ESM output because the official
// `@modelcontextprotocol/sdk` is ESM-only. refract and the SDK are runtime DEPENDENCIES, so both stay
// external — the installed copies are shared, not bundled.
export default {
  input: "src/server.ts",
  external: [/^@theme-registry\/refract(\/.*)?$/, /^@modelcontextprotocol\/sdk(\/.*)?$/, /^node:/],
  output: {
    file: "dist/server.js",
    format: "esm",
    banner: "#!/usr/bin/env node",
    sourcemap: false,
  },
  plugins: [typescript({ tsconfig: "./tsconfig.json" })],
};
