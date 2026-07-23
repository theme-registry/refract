import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// Paths are resolved relative to THIS file so the build is location-independent
// (no absolute paths baked in). Output lands in website/out/refract.iife.js.
const here = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  // The CSS adapter never touches styled-components at runtime; stub it so the
  // bundle stays React-free and small.
  resolve: { alias: { "styled-components": here("./sc-stub.js") } },
  logLevel: "warn",
  build: {
    lib: {
      entry: here("./entry.js"),
      name: "refract",
      formats: ["iife"],
      fileName: () => "refract.iife.js",
    },
    outDir: here("../out"),
    emptyOutDir: false,
    minify: true,
  },
});
