// Generate the real Vite site (website/site/) FROM template.html — so template.html stays the
// single source and the self-contained artifact pipeline (build.mjs) is untouched. The difference:
// the site imports the REAL package (via the Vite alias in site/vite.config.mjs) instead of an
// inlined IIFE, and Vite gives it a dev server + a static production build.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const tpl = readFileSync(here("../template.html"), "utf8");
const presets = readFileSync(here("../presets.mjs"), "utf8").replace(/^export\s+/gm, "");

const title = (tpl.match(/<title>([\s\S]*?)<\/title>/) || [, "refract"])[1];
const styles = tpl.slice(tpl.indexOf("<style>") + "<style>".length, tpl.indexOf("</style>"));

// Body: the whole app markup + the runtime <style id="refract-out"> target, minus the scripts.
const bodyStart = tpl.indexOf('<div class="app">');
const bodyEnd = tpl.indexOf("<script>/*__REFRACT_BUNDLE__*/");   // first script after the body
let body = tpl.slice(bodyStart, bodyEnd).trim();

// Base path for a subpath deploy (must match site/vite.config.mjs). Normalized to a leading + trailing
// slash so `${base}${id}` is a valid absolute path (e.g. "/refract/errors"); default "/" → "/errors".
const base = (() => {
  let b = process.env.SITE_BASE || "/";
  if (b.charAt(0) !== "/") b = "/" + b;
  if (b.charAt(b.length - 1) !== "/") b += "/";
  return b;
})();

// Rewrite page-route hrefs #<pageId> → <base><pageId> so crawlers see real, per-page URLs. The set of
// page ids is exactly the sidebar nav targets; heading anchors (#h-…) are left as hash.
const navBlocks = tpl.match(/<nav class="sub"[^>]*>[\s\S]*?<\/nav>/g) || [];
const pageIds = [...new Set(navBlocks.flatMap((n) => [...n.matchAll(/href="#([^"]+)"/g)].map((m) => m[1])))];
for (const id of pageIds) {
  body = body.split(`href="#${id}"`).join(`href="${base}${id === "top" ? "" : id}"`);
}

// The UI script (after the bundle-marker script): its <script> body, with the presets marker filled.
const bundleIdx = tpl.indexOf("/*__REFRACT_BUNDLE__*/");
const uiOpen = tpl.indexOf(">", tpl.indexOf("<script>", bundleIdx)) + 1;
const uiClose = tpl.indexOf("</script>", uiOpen);
const ui = tpl.slice(uiOpen, uiClose).replace("/*__PRESETS__*/", "\n" + presets + "\n");

const DESC = "Documentation & live playground for @theme-registry/refract — a framework-agnostic theme compiler: one RawTheme, refracted into CSS, SCSS, JSON or styled-components.";

const indexHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <meta name="description" content="${DESC}" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${DESC}" />
  <meta property="og:type" content="website" />
</head>
<body>
${body}
  <script type="module" src="/src/main.js"></script>
</body>
</html>
`;

// The library reaches window.refract in the artifact; the site sets it from real imports so the
// (unchanged) app code keeps working via `var refract = window.refract`.
const mainJs = `import "./styles.css";
import { createTheme } from "@theme-registry/refract";
import { createCssAdapter } from "@theme-registry/refract-css";
import { createScssAdapter } from "@theme-registry/refract-scss";
import { createJsonAdapter } from "@theme-registry/refract-json";
import { createStyledComponentsAdapter } from "@theme-registry/refract-styled-components";

// Expose Vite's configured base path to the (framework-free) router in the app script. Undefined in
// the self-contained artifact (no bundler) → the router falls back to "/".
window.__SITE_BASE__ = import.meta.env.BASE_URL;
window.refract = { createTheme, createCssAdapter, createScssAdapter, createJsonAdapter, createStyledComponentsAdapter };

${ui}
`;

mkdirSync(here("../site/src"), { recursive: true });
writeFileSync(here("../site/index.html"), indexHtml);
writeFileSync(here("../site/src/styles.css"), styles);
writeFileSync(here("../site/src/main.js"), mainJs);
console.log("generated website/site/ (index.html + src/main.js + src/styles.css) from template.html");
