// Step 2 of the docs build: bundle the real library into a single browser IIFE.
// (Step 1 = `npm run build` at the repo root, which produces dist/.)
import { build } from "vite";
import { fileURLToPath } from "node:url";

const configFile = fileURLToPath(new URL("../bundle/vite.config.mjs", import.meta.url));
await build({ configFile });
console.log("bundled → website/out/refract.iife.js");
