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

// ── Agent-readable + crawler surfaces at the site root ──
// The docs deep pages are prerendered above, but an agent or a crawler also wants a single index it
// can fetch without executing JS. Emit four root files from the same route list: llms.txt (the
// llmstxt.org convention), manifest.json (machine index), sitemap.xml, and robots.txt.
const origin = SITE_URL || base.replace(/\/$/, ""); // full origin+base in CI; bare base path otherwise
const urlFor = (id) => (id === "top" ? `${origin}/` : `${origin}/${id}`);
const descFor = (id) => (leadOf(id) || GENERIC).replace(/\s+/g, " ").slice(0, 300);
const xmlEsc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

// llms.txt — H1 + summary blockquote + a bullet per page (title, URL, one-line description).
const llms = [
  "# refract",
  "",
  "> @theme-registry/refract — a framework-agnostic theme compiler. Author one RawTheme; compile it to"
    + " CSS, SCSS, JSON, or styled-components through a pluggable adapter. It stores a reference graph"
    + " (not frozen values), so override() is a delta-merge and diffTheme shows a change's blast radius"
    + " before you apply it.",
  "",
  "This file indexes the documentation for language models. Each link is a standalone, prerendered page.",
  "",
  "## Documentation",
  "",
  ...pages.map(({ id, title }) => `- [${id === "top" ? "Overview" : title}](${urlFor(id)}): ${descFor(id)}`),
  "",
  "## Tooling",
  "",
  "- The `@theme-registry/refract-mcp` package runs an MCP server exposing live theme queries"
    + " (resolveToken, listTokens, listRecipes, getClass, checkContrast, validateTheme, diffTheme) plus"
    + " `llms.txt` and `manifest.json` resources rendered from a project's own compiled theme.",
  "",
].join("\n");
writeFileSync(`${distDir}/llms.txt`, llms);

// manifest.json — machine index of the doc pages (schema-versioned so agents can bind to it).
const manifest = {
  name: "@theme-registry/refract",
  description: GENERIC,
  homepage: `${origin}/`,
  schema: "docs-index/1",
  generator: "website/scripts/prerender.mjs",
  llms: `${origin}/llms.txt`,
  pages: pages.map(({ id, title }) => ({
    id,
    title: id === "top" ? "Overview" : title,
    url: urlFor(id),
    description: descFor(id),
  })),
};
writeFileSync(`${distDir}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");

// sitemap.xml — one <url> per prerendered route.
const sitemap = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...pages.map(({ id }) => `  <url><loc>${xmlEsc(urlFor(id))}</loc></url>`),
  "</urlset>",
  "",
].join("\n");
writeFileSync(`${distDir}/sitemap.xml`, sitemap);

// robots.txt — allow all; point crawlers at the sitemap (absolute URL only when SITE_URL is set).
const robots = ["User-agent: *", "Allow: /", ...(SITE_URL ? [`Sitemap: ${SITE_URL}/sitemap.xml`] : []), ""].join("\n");
writeFileSync(`${distDir}/robots.txt`, robots);

console.log(
  `prerendered ${n} routes to static HTML (${SITE_URL || "relative"} canonicals) + 404.html + .nojekyll`
    + `\nwrote root: llms.txt · manifest.json (${pages.length} pages) · sitemap.xml · robots.txt`,
);
