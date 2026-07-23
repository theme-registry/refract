import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// The site imports each package by its published name; the website is a workspace member depending on
// all five (workspace:* → each package's built dist), so Vite resolves them straight from node_modules
// — no dist aliases needed post monorepo split. styled-components is still stubbed: the CSS-adapter path
// never uses it at runtime (same as the artifact bundle), keeping the browser bundle React-free.
const here = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here("."),
  resolve: {
    alias: [
      { find: "styled-components", replacement: here("../bundle/sc-stub.js") },
    ],
  },
  build: { outDir: here("dist"), emptyOutDir: true },
});
