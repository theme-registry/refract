import typescript from "@rollup/plugin-typescript";

// @theme-registry/refract-figma — bundles the plugin sandbox entry (`src/code.ts` + the pure
// `plan.ts`) into a single `dist/code.js` that Figma's plugin runtime executes. The only refract
// import is a type (`DTCGDocument`), erased at build, so `code.js` is self-contained — no runtime dep.
// `format: "iife"` produces the bare top-to-bottom script Figma expects; `__html__`/`figma` stay as
// the runtime-injected globals declared in `src/figma-env.d.ts`.
export default {
  input: "src/code.ts",
  external: [/^@theme-registry\/refract(\/.*)?$/],
  output: {
    file: "dist/code.js",
    format: "iife",
    sourcemap: false,
  },
  plugins: [typescript({ tsconfig: "./tsconfig.json" })],
};
