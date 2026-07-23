// Step 3 of the docs build: inject the compiled library IIFE + the preset
// RawThemes into template.html, producing the self-contained showcase page.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

const tpl = readFileSync(here("../template.html"), "utf8");
const bundle = readFileSync(here("../out/refract.iife.js"), "utf8");
// De-export presets.mjs so it runs inline inside the page's <script>.
const presets = readFileSync(here("../presets.mjs"), "utf8").replace(/^export\s+/gm, "");

// A closing </script> anywhere in the injected JS would terminate the inline
// script early — escape it.
const guard = (s) => s.replace(/<\/script>/gi, "<\\/script>");

let out = tpl.replace("/*__REFRACT_BUNDLE__*/", () => guard(bundle));
out = out.replace("/*__PRESETS__*/", () => guard(presets));
if (out.includes("/*__REFRACT_BUNDLE__*/") || out.includes("/*__PRESETS__*/")) {
  throw new Error("inject marker not replaced — template.html markers missing");
}

writeFileSync(here("../refract-showcase.html"), out);
console.log("built website/refract-showcase.html", (out.length / 1024).toFixed(1) + "KB");
