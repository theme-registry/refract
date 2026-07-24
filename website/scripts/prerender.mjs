// Static per-route prerender (SSG) for the Vite site. After `vite build`, this reads the built
// SPA shell (dist/index.html) and writes one crawlable HTML file per route: the route's page is
// shown, every other page section is `hidden`, and the <title> / description / canonical are the
// page's own. A no-JS crawler sees exactly that page's content at a real URL; the client router
// (path-aware) hydrates for humans. Run: `node website/scripts/prerender.mjs`.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const distDir = here("../site/dist");
// SITE_URL is the FULL public origin+base (e.g. https://theme-registry.github.io/refract), so the
// canonical is SITE_URL + "/" + id and needs no separate base handling here.
const SITE_URL = (process.env.SITE_URL || "").replace(/\/$/, "");
// Base path the nav hrefs were generated with (gen-site) — strip it to recover the bare route id.
const base = (() => {
  let b = process.env.SITE_BASE || "/";
  if (b.charAt(0) !== "/") b = "/" + b;
  if (b.charAt(b.length - 1) !== "/") b += "/";
  return b;
})();
const shell = readFileSync(distDir + "/index.html", "utf8");

// Page id → sidebar title, from the nav (href="<base>id"; top is href="<base>").
const navBlocks = shell.match(/<nav class="sub"[^>]*>[\s\S]*?<\/nav>/g) || [];
const pages = [];
for (const nav of navBlocks) {
  for (const m of nav.matchAll(/<a href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const raw = m[1];
    if (raw.indexOf(base) !== 0) continue; // route links only (skip any stray hash/external anchor)
    const id = raw.slice(base.length).replace(/^\/+/, "") || "top";
    const title = m[2].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim();
    pages.push({ id, title });
  }
}
const allIds = pages.map((p) => p.id);

const leadOf = (id) => {
  const at = shell.indexOf(`id="${id}">`);
  if (at < 0) return "";
  const m = shell.slice(at, at + 2600).match(/class="lead">([\s\S]*?)<\/p>/);
  return m ? m[1].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim() : "";
};

const GENERIC = "Documentation & live playground for @theme-registry/refract — a framework-agnostic theme compiler.";

let n = 0;
for (const { id, title } of pages) {
  let html = shell;
  // hide every OTHER page section
  for (const oid of allIds) {
    if (oid === id) continue;
    html = html.replace(`id="${oid}">`, `id="${oid}" hidden>`);
  }
  const pageTitle = id === "top" ? "refract — one base theme, every brand and format" : `${title} · refract`;
  const desc = (leadOf(id) || GENERIC).slice(0, 300);
  const path = id === "top" ? "/" : `/${id}`;
  html = html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${pageTitle}</title>`)
    .replace(/<meta name="description" content="[^"]*"\s*\/>/, `<meta name="description" content="${desc}" />`)
    .replace(/<meta property="og:title" content="[^"]*"\s*\/>/, `<meta property="og:title" content="${pageTitle}" />`)
    .replace(/<meta property="og:description" content="[^"]*"\s*\/>/, `<meta property="og:description" content="${desc}" />`)
    .replace("</head>", `  <link rel="canonical" href="${SITE_URL}${path}" />\n</head>`);

  const outDir = id === "top" ? distDir : `${distDir}/${id}`;
  mkdirSync(outDir, { recursive: true });
  writeFileSync(`${outDir}/index.html`, html);
  n++;
}

// SPA fallback for unknown deep links (the prerendered shell, which hydrates and routes client-side),
// and .nojekyll so GitHub Pages serves the tree verbatim.
writeFileSync(`${distDir}/404.html`, shell);
writeFileSync(`${distDir}/.nojekyll`, "");
console.log(`prerendered ${n} routes to static HTML (${SITE_URL || "relative"} canonicals) + 404.html + .nojekyll`);
