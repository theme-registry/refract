// Compile every self-contained RawTheme example in the prose docs against the REAL library, so a
// documented snippet can never drift from the engine (the "copy-paste runnable" promise). This gates
// the markdown surfaces the site's own drift checks (validate.mjs) don't reach: the package READMEs and
// docs/*.md. Fragments and schematic blocks (a `/* … */` placeholder, an elision, a relative import, a
// `defineConfig` build example, or a reference to a `raw` defined nowhere runnable) are skipped and
// counted — no silent caps. Run after `bundle.mjs`. Exits non-zero on any snippet that fails to compile.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const bundle = readFileSync(here("../out/refract.iife.js"), "utf8");
const refract = new Function(bundle + "; return refract;")();

const SOURCES = [
  "../../README.md",
  "../../packages/refract/README.md",
  "../../docs/authoring.md",
  "../../docs/css-adapter.md",
];

/** Fenced code blocks with language + 1-based starting line of the code. */
function codeBlocks(md) {
  const out = [];
  const lines = md.split("\n");
  let inBlock = false, lang = "", buf = [], start = 0;
  for (let i = 0; i < lines.length; i++) {
    const open = /^```(\w+)?\s*$/.exec(lines[i]);
    if (!inBlock && open) { inBlock = true; lang = (open[1] || "").toLowerCase(); buf = []; start = i + 2; continue; }
    if (inBlock && /^```\s*$/.test(lines[i])) { out.push({ lang, code: buf.join("\n"), start }); inBlock = false; continue; }
    if (inBlock) buf.push(lines[i]);
  }
  return out;
}

/** Comments removed, so an ellipsis inside a `//` note isn't mistaken for a structural elision. */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** A block worth compiling: it builds a theme, and nothing in it needs something we can't provide. */
function isRunnableThemeBlock(code) {
  const bare = stripComments(code);
  if (!/\bcreateTheme\(|\bconst raw\b|satisfies RawTheme/.test(bare)) return false; // not a theme example
  if (/from ["']\.\.?\//.test(code)) return false;   // relative import — needs an external file
  if (/\bdefineConfig\b/.test(bare)) return false;   // build-config example, not a raw compile
  if (/\b(?:from|to)DTCG\b/.test(bare)) return false; // DTCG interop — needs the /dtcg subpath + external token input
  if (/\.\.\.|…/.test(bare)) return false;           // a real structural elision in code → a fragment
  // References `raw` but never defines it in-block → depends on prior context we don't thread.
  if (/\braw\b/.test(bare) && !/\b(?:const|let|var)\s+raw\b/.test(bare)) return false;
  return true;
}

/** TS-ish snippet → runnable JS against the bundle. */
function toRunnable(code) {
  let c = stripComments(code)                   // strip first, so a trailing `// note` can't swallow the next line
    .replace(/^\s*import[\s\S]*?;\s*$/gm, "")   // drop import lines (incl. multi-line)
    .replace(/\bsatisfies\s+\w+/g, "")           // `satisfies RawTheme`
    .replace(/:\s*RawTheme\b/g, "")              // `: RawTheme` annotations
    .replace(/\bexport\s+default\s+/g, "")
    .replace(/\bexport\s+/g, "");
  if (!/\bcreateTheme\(/.test(c)) c += "\ncreateTheme(raw, { adapter: createCssAdapter() });"; // compile a bare `const raw`
  return c;
}

const API = ["createTheme", "createCssAdapter", "createScssAdapter", "createJsonAdapter", "createStyledComponentsAdapter"];
let checked = 0, skipped = 0, failed = 0;

for (const rel of SOURCES) {
  let md;
  try { md = readFileSync(here(rel), "utf8"); } catch { continue; }
  for (const b of codeBlocks(md)) {
    if (!["ts", "tsx", "js", "jsx"].includes(b.lang)) continue;
    if (!isRunnableThemeBlock(b.code)) {
      if (/\bcreateTheme\(|\bconst raw\b|satisfies RawTheme/.test(b.code)) skipped++; // a theme-ish block we chose not to run
      continue;
    }
    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function(...API, toRunnable(b.code));
      fn(refract.createTheme, refract.createCssAdapter, refract.createScssAdapter, refract.createJsonAdapter, refract.createStyledComponentsAdapter);
      checked++;
    } catch (e) {
      failed++;
      console.log(`  ✗ ${rel.replace("../../", "")}:${b.start} — ${String(e.message).slice(0, 140)}`);
    }
  }
}

console.log(
  failed
    ? `\n✗ ${failed} doc snippet(s) failed to compile (${checked} ok, ${skipped} schematic/skipped)`
    : `✓ snippets — ${checked} self-contained doc RawTheme snippet(s) compile against the live library (${skipped} schematic/skipped)`,
);
process.exit(failed ? 1 : 0);
