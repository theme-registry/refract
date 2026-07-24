// Validates template.html + the compiled bundle without a browser:
//   1. balance   — HTML tag balance across the static markup
//   2. render    — every RENDER fn returns non-thin output for all 4 presets
//   3. exist     — every dt- class the renderers emit exists in the compiled CSS
//   4. dom       — the full page script executes clean under a minimal DOM shim
//   5. drift     — Errors-table messages + emitted colour snippet match the live library (docs↔code gate)
//   6. cssvalid  — every emitted declaration's property is a real CSS property (would have caught SITE-1)
//   7. naming    — no documented variable name carries a double-dash separator (guards DOC-1)
//   8. perf      — documented recipe-class / @media counts match a live compile
//   9. quality   — status-page test counts + size-budget ceilings match reality (guards the rigor claims)
// Run after `bundle.mjs`. Exits non-zero on any failure.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PRESETS } from "../presets.mjs";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const read = (p) => readFileSync(here(p), "utf8");

const tpl = read("../template.html");
const bundleSrc = read("../out/refract.iife.js");
const refract = new Function(bundleSrc + "; return refract;")();
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const mkHost = () => ({ shadowRoot: null, attachShadow() { this.shadowRoot = { innerHTML: "" }; return this.shadowRoot; } });

// Compile every preset once (noir is an override child of halcyon).
const roots = {}, themes = {};
for (const p of PRESETS) {
  themes[p.id] = p.kind === "override"
    ? roots[p.from].override(p.raw)
    : (roots[p.id] = refract.createTheme(p.raw, { adapter: refract.createCssAdapter() }));
}

// Extract the RENDER map + its render* fns from the template source.
const renderBlock =
  tpl.slice(tpl.indexOf("function renderColors"), tpl.indexOf("var RENDER =")) +
  tpl.slice(tpl.indexOf("var RENDER ="), tpl.indexOf("var RENDER =") + tpl.slice(tpl.indexOf("var RENDER =")).indexOf(";") + 1);
const RENDER = new Function("esc", "mkHost", renderBlock + "\nreturn RENDER;")(esc, mkHost);

let failures = 0;
const fail = (msg) => { console.log("  ✗", msg); failures++; };

// ── 1. balance ──
{
  const s = tpl.split('<style id="refract-out"')[0];
  let bad = 0;
  for (const t of ["div", "section", "table", "thead", "tbody", "tr", "td", "th", "pre"]) {
    const o = (s.match(new RegExp("<" + t + "\\b", "g")) || []).length;
    const c = (s.match(new RegExp("</" + t + ">", "g")) || []).length;
    if (o !== c) { fail(`tag <${t}> unbalanced: ${o} open / ${c} close`); bad++; }
  }
  if (!bad) console.log("  ✓ balance — all tracked tags balanced");
}

// ── 2. render ──
{
  let bad = 0;
  for (const p of PRESETS) for (const k of Object.keys(RENDER)) {
    try {
      const html = k === "globals" ? RENDER.globals(themes[p.id], mkHost()) : RENDER[k](themes[p.id]);
      if (k !== "globals" && (typeof html !== "string" || html.length < 20)) { fail(`thin output: ${p.id}/${k}`); bad++; }
    } catch (e) { fail(`threw: ${p.id}/${k} — ${e.message.slice(0, 60)}`); bad++; }
  }
  if (!bad) console.log(`  ✓ render — all ${Object.keys(RENDER).length} RENDER fns OK across ${PRESETS.length} presets`);
}

// ── 2b. formats — the live adapter-output tabs compile all 4 formats for every preset ──
{
  const facts = {
    css: refract.createCssAdapter, scss: refract.createScssAdapter,
    json: refract.createJsonAdapter, sc: refract.createStyledComponentsAdapter,
  };
  let bad = 0;
  for (const fmt of Object.keys(facts)) {
    if (typeof facts[fmt] !== "function") { fail(`adapter missing from bundle: ${fmt}`); bad++; continue; }
    const roots = {}, ts = {};
    try {
      for (const p of PRESETS) {
        ts[p.id] = p.kind === "override" ? roots[p.from].override(p.raw)
          : (roots[p.id] = refract.createTheme(p.raw, { adapter: facts[fmt]() }));
      }
      for (const p of PRESETS) {
        // §8: the styled-components adapter emits TS/JS modules, not a stylesheet — its surface is a
        // literal `theme` object + `recipes` (no `.css`). Validate the serialized theme object instead.
        const out = fmt === "json" ? JSON.stringify(ts[p.id].json)
          : fmt === "scss" ? ts[p.id].scss
          : fmt === "sc" ? JSON.stringify(ts[p.id].theme)
          : ts[p.id].css;
        if (typeof out !== "string" && fmt !== "json") { fail(`${fmt}/${p.id}: non-string output`); bad++; }
        else if (!out || out.length < 100) { fail(`${fmt}/${p.id}: empty/thin output`); bad++; }
      }
    } catch (e) { fail(`${fmt}: threw — ${e.message.slice(0, 70)}`); bad++; }
  }
  if (!bad) console.log(`  ✓ formats — all 4 adapters compile every preset (incl. override children)`);
}

// ── 3. exist ──
{
  const t = themes[PRESETS[0].id];
  const cssClasses = new Set((t.css.match(/\.dt-[a-z0-9-]+/g) || []).map((c) => c.slice(1)));
  const missing = new Set();
  for (const k of Object.keys(RENDER)) {
    const html = k === "globals" ? RENDER.globals(t, mkHost()) : RENDER[k](t);
    for (const m of html.match(/class="([^"]*dt-[^"]*)"/g) || []) {
      for (const cls of m.replace(/class="|"/g, "").split(/\s+/)) {
        if (cls.startsWith("dt-") && !cls.startsWith("dt-cq") && !cssClasses.has(cls)) missing.add(cls);
      }
    }
  }
  if (missing.size) fail(`classes not in compiled CSS: ${[...missing].join(", ")}`);
  else console.log("  ✓ exist — every rendered dt- class exists in the compiled CSS");
}

// ── 4. dom (run last: pollutes globalThis with window/document shims) ──
{
  const ui = tpl.match(/\/\*__PRESETS__\*\/([\s\S]*?)<\/script>/)[1];
  const presetsSrc = read("../presets.mjs").replace(/^export\s+/gm, "");
  const mkEl = (tag) => {
    const e = {
      tag, _attr: {}, _html: "", dataset: {}, style: { setProperty() {} }, className: "", shadowRoot: null, hidden: false,
      set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; },
      set textContent(v) { this._text = v; }, get textContent() { return this._text; },
      setAttribute(k, v) { this._attr[k] = v; }, getAttribute(k) { return this._attr[k] != null ? this._attr[k] : null; },
      addEventListener() {}, appendChild() {}, insertBefore() {},
      querySelector() { return mkEl("x"); }, querySelectorAll() { return []; }, closest() { return null; },
      classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} }, offsetWidth: 0,
      attachShadow() { this.shadowRoot = { innerHTML: "" }; return this.shadowRoot; },
    };
    return e;
  };
  const byId = {};
  ["refract-out", "activeLabel", "activeBlurb", "sweep", "presets", "themeToggle", "menuBtn", "navBackdrop"].forEach((id) => (byId[id] = mkEl(id)));
  const subs = ["colors", "typography", "effects", "borders", "animation", "layout", "components", "globals"];
  const qsa = (sel) => {
    if (sel === "[data-raw]") return subs.map((w) => { const e = mkEl("pre"); e._attr = { "data-raw": w }; return e; });
    if (sel === "[data-render]") return subs.map((w) => { const e = mkEl("div"); e._attr = { "data-render": w }; return e; });
    if (sel === ".panel") return subs.map((w) => { const e = mkEl("section"); e.id = "p-" + w; return e; });
    return [];
  };
  const documentShim = {
    getElementById: (id) => byId[id] || mkEl(id), querySelectorAll: qsa, querySelector: () => mkEl("x"),
    createElement: mkEl, documentElement: { setAttribute() {}, getAttribute() { return null; } }, addEventListener() {},
  };
  const windowShim = { matchMedia: () => ({ matches: false }), refract: null, addEventListener() {}, scrollTo() {}, innerWidth: 1280 };
  globalThis.location = { hash: "" };
  globalThis.IntersectionObserver = class { observe() {} };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => "" });
  windowShim.refract = new Function(bundleSrc + "; return refract;")();
  globalThis.window = windowShim;
  globalThis.document = documentShim;
  try {
    new Function("window", "document", "IntersectionObserver", "getComputedStyle", presetsSrc + "\n" + ui)(
      windowShim, documentShim, globalThis.IntersectionObserver, globalThis.getComputedStyle,
    );
    const out = byId["refract-out"]._text || "";
    if (/:where/.test(out)) fail("dom — globals :where() rules leaked into the global inject");
    else if (!/^\s*:root/.test(out)) fail("dom — globals block (bare element rules) not stripped: inject must start at :root");
    else if (!/dt-comp/.test(out)) fail("dom — global inject missing :root vars or component classes");
    else console.log("  ✓ dom — full page script executed clean; global inject correct");
  } catch (e) { fail(`dom — page script threw: ${e.message}`); }
}

// ── 5. drift — docs strings must match the live library (errors table + emitted colour snippet) ──
// Guards the doc↔code drift class: a thrown message or a synthesized colour value that changes in the
// library but not in template.html fails CI here.
{
  const unesc = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const stripTags = (s) => unesc(s.replace(/<[^>]+>/g, ""));
  let bad = 0;

  // 5a — every driven invalid theme throws a message that matches its documented Errors-table row.
  // Only reliably-reachable colour-domain rows are driven (logged as coverage — this is not the whole table).
  const errFrag = tpl.slice(tpl.indexOf('id="errors"'));
  const errTable = errFrag.slice(0, errFrag.indexOf("</section>")); // the whole Errors section (all subsection tables)
  const docRows = [...errTable.matchAll(/<tr>\s*<td>\s*<code>([\s\S]*?)<\/code>/g)].map((m) => stripTags(m[1]));
  const drivers = [
    { label: "Invalid colour", raw: { colors: { x: { base: "nope" } } } },
    { label: "steps must be numbers", raw: { colors: { x: { base: "#4c6ef5", steps: [1200] } } } },
    { label: "declare only one of", raw: { layout: { spacing: { base: 8, ratio: 1.5, step: 2, steps: ["a"] } } } },
    { label: "unknown preset", raw: { globals: { preset: "bogus" } } },
    // CORE-1 — three guarantees the Errors page publishes; each must actually fire.
    {
      label: "cannot set both",
      raw: {
        colors: { brand: { base: "#4c6ef5" }, recipes: { solid: { a: { background: "brand" }, brand: { background: "brand", responsive: [{ breakpoint: "lg", variant: "a", target: "a" }] } } } },
        breakpoints: { lg: 1024 },
      },
    },
    {
      label: "references unknown container",
      raw: {
        colors: { brand: { base: "#4c6ef5" }, recipes: { solid: { brand: { background: "brand", responsive: [{ container: "nope", size: "sm", background: "brand" }] } } } },
        containers: { card: { type: "inline-size", sizes: { sm: 280 } } },
      },
    },
    {
      label: "is not defined in",
      raw: {
        colors: { brand: { base: "#4c6ef5" }, recipes: { solid: { brand: { background: "brand" } } } },
        components: { recipes: { buttons: { primary: { colors: "solid.ghost" } } } },
      },
    },
  ];
  let covered = 0;
  for (const d of drivers) {
    let msg = "";
    try { refract.createTheme(d.raw, { adapter: refract.createCssAdapter() }); }
    catch (e) { msg = e.message; }
    if (!msg) { fail(`drift 5a — expected a throw for "${d.label}" but the library accepted it`); bad++; continue; }
    const row = docRows.find((r) => r.includes(d.label));
    if (!row) { fail(`drift 5a — no Errors-table row documents "${d.label}"`); bad++; continue; }
    // Split the doc row into literal segments on its placeholders (… and <name>/<v>), require in-order containment.
    const segs = row.split(/…|<[a-z]+>/i).map((s) => s.trim()).filter(Boolean);
    let pos = 0, ok = true;
    for (const seg of segs) { const at = msg.indexOf(seg, pos); if (at < 0) { ok = false; break; } pos = at + seg.length; }
    if (!ok) { fail(`drift 5a — Errors-table row for "${d.label}" is stale:\n      doc: ${row}\n      lib: ${msg}`); bad++; }
    else covered++;
  }

  // 5b — the emitted colour snippet's `--dt-colors-…: value` lines match the compiler, compared by
  // canonical colour value so hex-in-docs vs rgb()-from-adapter is not a false mismatch.
  const canon = (v) => {
    v = v.trim();
    let m;
    if ((m = /^#([0-9a-f]{3,8})$/i.exec(v))) {
      let h = m[1];
      if (h.length === 3) h = h.split("").map((c) => c + c).join("");
      const n = (i) => parseInt(h.slice(i, i + 2), 16);
      const a = h.length === 8 ? +(n(6) / 255).toFixed(3) : 1;
      return a === 1 ? `${n(0)},${n(2)},${n(4)}` : `${n(0)},${n(2)},${n(4)},${a}`;
    }
    if ((m = /^rgba?\(([^)]+)\)$/i.exec(v))) {
      const p = m[1].split(",").map((x) => x.trim());
      const a = p[3] !== undefined ? +(+p[3]).toFixed(3) : 1;
      return a === 1 ? `${+p[0]},${+p[1]},${+p[2]}` : `${+p[0]},${+p[1]},${+p[2]},${a}`;
    }
    return v; // non-colour (var(), keyword) — compare literally
  };
  // Each documented emitted-CSS snippet, keyed by its codeblock cb-file marker + the exact authored
  // theme it documents. Every `--dt-colors-…: value` line the docs show must match the compiler.
  // Extend this list as more deterministic emitted snippets land — coverage is logged (no silent caps).
  const snippets = [
    {
      marker: 'dist/theme.css  ·  emitted (colorFormat: "hex")',
      raw: {
        colors: {
          brand: { base: "#4c6ef5", text: "#fff", lightenBy: 10, darkenBy: 12, variants: { light: "#91a7ff", dark: "#3b5bdb" } },
          accent: { base: [230, 73, 128], text: "#fff", variants: { hover: { modifiers: [{ darken: 12 }] }, ghost: { modifiers: [{ alpha: 12 }] } } },
          recipes: {
            solid: { brand: { background: "brand", color: "brand.text", states: [{ state: "hover", background: "brand.dark" }, { state: "disabled", background: "brand.lighter", color: "brand.dark" }] } },
            outline: { brand: { backgroundColor: "transparent", color: "brand", borderColor: "brand", cursor: "pointer" } },
          },
        },
      },
    },
    {
      // Build-CLI section — a minimal brand palette + solid recipe on default derivation.
      marker: "dist/theme/theme.css  ·  emitted",
      raw: { colors: { brand: { base: "#4c6ef5", text: "#fff" }, recipes: { solid: { brand: { background: "brand", color: "brand.text" } } } } },
    },
  ];
  let checkedVars = 0, checkedSnippets = 0;
  for (const snip of snippets) {
    const idx = tpl.indexOf(snip.marker);
    if (idx < 0) { fail(`drift 5b — emitted snippet marker not found: "${snip.marker}"`); bad++; continue; }
    const emitPre = tpl.slice(tpl.indexOf("<pre>", idx) + 5, tpl.indexOf("</pre>", idx));
    const css = refract.createTheme(snip.raw, { adapter: refract.createCssAdapter() }).css;
    const emittedVar = {};
    for (const m of css.matchAll(/(--dt-colors-[a-z-]+):\s*([^;]+);/g)) emittedVar[m[1]] = m[2].trim();
    for (const line of stripTags(emitPre).split("\n")) {
      const m = /(--dt-colors-[a-z-]+):\s*([^;/]+)/.exec(line);
      if (!m) continue;
      const name = m[1], docVal = m[2].trim();
      if (!(name in emittedVar)) { fail(`drift 5b — doc emits ${name} but the compiler doesn't (${snip.marker})`); bad++; continue; }
      if (canon(docVal) !== canon(emittedVar[name])) { fail(`drift 5b — ${name}: doc "${docVal}" ≠ compiled "${emittedVar[name]}" (${snip.marker})`); bad++; }
      else checkedVars++;
    }
    checkedSnippets++;
  }

  // 5c — the Playground's default RawTheme must compile clean on the CURRENT grammar. It's live input
  // a reader edits, so a stale escape (a removed `{ css: … }`) or a bare token-path-as-literal would
  // render a broken preview. Compile it and assert the output has no `undefined` and no literal token path.
  let playgroundOk = false;
  const pg = tpl.match(/<textarea id="pgSrc"[^>]*>([\s\S]*?)<\/textarea>/);
  if (!pg) { fail("drift 5c — playground textarea (#pgSrc) not found"); bad++; }
  else {
    let raw;
    try { raw = JSON.parse(pg[1]); } catch (e) { fail(`drift 5c — playground default isn't valid JSON: ${e.message}`); bad++; }
    if (raw) {
      try {
        const pcss = refract.createTheme(raw, { adapter: refract.createCssAdapter() }).css;
        if (/:\s*undefined/.test(pcss)) { fail("drift 5c — playground default emits `undefined` (stale css grammar — a removed { css: … } escape?)"); bad++; }
        else if (/:\s*colors\.[a-z]/.test(pcss)) { fail("drift 5c — playground default emits a token path as a literal (use { ref: … } for a css token)"); bad++; }
        else playgroundOk = true;
      } catch (e) { fail(`drift 5c — playground default doesn't compile: ${e.message.slice(0, 80)}`); bad++; }
    }
  }

  if (!bad) console.log(`  ✓ drift — ${covered} errors-table message(s) + ${checkedVars} emitted colour var(s) across ${checkedSnippets} snippet(s)${playgroundOk ? " + playground default" : ""} match the live library`);
}

// ── 6. cssvalid — every emitted declaration's property is real CSS ──
// The check that would have caught SITE-1: a typo'd recipe key (`ref: subtle;`) reaching the
// stylesheet as a literal declaration. Reuses the library's own known-CSS-property predicate, so the
// gate and the build-time fail-loud check share one allow-list.
{
  const isKnownCssProperty = refract.isKnownCssProperty;
  if (typeof isKnownCssProperty !== "function") {
    fail("cssvalid — refract.isKnownCssProperty missing from the bundle (rebuild)");
  } else {
    // A declaration property sits right after `{` or `;` (a selector/at-rule param does not) and is
    // followed by `:`. Custom properties (`--…`) are always valid. Enough to lint emitted CSS.
    const declRe = /[{;]\s*(--[a-z0-9-]+|[a-z][a-z0-9-]*)\s*:/gi;
    const bad = new Map(); // "preset/prop" → true (dedup)
    let checked = 0;
    for (const p of PRESETS) {
      const css = themes[p.id].css;
      for (const m of css.matchAll(declRe)) {
        const prop = m[1];
        if (prop.startsWith("--")) continue;
        checked++;
        if (!isKnownCssProperty(prop)) bad.set(`${p.id}/${prop}`, true);
      }
    }
    if (bad.size) fail(`cssvalid — emitted declaration(s) whose property is not real CSS: ${[...bad.keys()].join(", ")}`);
    else console.log(`  ✓ cssvalid — every emitted declaration across ${PRESETS.length} presets uses a real CSS property (${checked} checked)`);
  }
}

// ── 7. naming — no documented variable name carries a double-dash separator ──
// Guards DOC-1: the emitted names are single-dash throughout (`--dt-effects-shadow-sm`, no `--base`).
// A `<code>` fragment with an internal `--` (`shadow--base`, `…--dark`, `spacing--xl`) is stale prose.
// The leading `--` of a custom property is fine — only an INTERNAL double-dash (flanked by name chars)
// is flagged.
{
  const offenders = new Set();
  for (const m of tpl.matchAll(/<code>([\s\S]*?)<\/code>/g)) {
    const inner = m[1];
    if (/[a-z0-9…]--[a-z0-9…]/.test(inner)) offenders.add(inner.trim().slice(0, 60));
  }
  if (offenders.size) fail(`naming — documented variable name(s) with a double-dash separator (single-dash is emitted): ${[...offenders].join(" · ")}`);
  else console.log("  ✓ naming — no documented variable name carries a stale double-dash separator");
}

// ── 8. perf — documented recipe-class / @media counts match a live compile (guards L7/F3) ──
// The perf numbers went stale because `bench.mjs` is not CI-gated. Counting the same way bench does
// (largest root preset by emitted CSS; `.dt-…{` selectors and `@media` at-rules), assert every perf
// figure printed in the prose matches the live compile — so a preset change can't drift the docs again.
{
  let richest = null;
  for (const id of Object.keys(roots)) {
    const css = roots[id].css;
    if (!richest || css.length > richest.len) richest = { id, css, len: css.length };
  }
  const liveClasses = (richest.css.match(/\.dt-[a-z0-9-]+\s*\{/g) || []).length;
  const liveMedia = (richest.css.match(/@media/g) || []).length;
  const pairs = [...tpl.matchAll(/(\d+)\s+recipe classes[\s\S]{0,40}?(\d+)\s*<code>@media/g)];
  let bad = 0;
  if (!pairs.length) { fail("perf — no documented 'N recipe classes · M @media' perf claim found in template"); bad++; }
  for (const [, cls, med] of pairs) {
    if (+cls !== liveClasses) { fail(`perf — doc says ${cls} recipe classes; live compile of "${richest.id}" has ${liveClasses}`); bad++; }
    if (+med !== liveMedia) { fail(`perf — doc says ${med} @media rules; live compile of "${richest.id}" has ${liveMedia}`); bad++; }
  }
  if (!bad) console.log(`  ✓ perf — ${pairs.length} documented perf claim(s) match the live "${richest.id}" compile (${liveClasses} recipe classes · ${liveMedia} @media)`);
}

// ── 9. quality — the status page's test counts + size-budget ceilings match reality ──
// Guards the "surface the rigor" claims: if the committed size budget or the live test count moves but
// the status page doesn't, this fails — the numbers an adopter reads can't drift from the repo.
{
  let bad = 0;

  // 9a — size-budget ceilings shown per package match size-budget.json (the committed source).
  const budget = JSON.parse(readFileSync(here("../../size-budget.json"), "utf8"));
  const kbOf = (bytes) => bytes / 1024;
  for (const [key, spec] of Object.entries(budget)) {
    const npm = key.replace(/\s*\(runtime core\)/, "");
    const esc = npm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = tpl.match(new RegExp(`data-pkg="${esc}"[\\s\\S]*?≤(?:&nbsp;|\\s)*([\\d.]+)(?:&nbsp;|\\s)*KB`));
    if (!m) { fail(`quality 9a — no size-budget row on the status page for "${npm}" (data-pkg)`); bad++; continue; }
    if (parseFloat(m[1]) !== kbOf(spec.maxGzip)) {
      fail(`quality 9a — "${npm}": status page says ≤${m[1]} KB, size-budget.json says ≤${kbOf(spec.maxGzip)} KB`); bad++;
    }
  }

  // 9b — the documented test-file / test-case counts match a live count of the repo's *.test.ts files.
  const walk = (dir) => {
    const out = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === "dist" || e.name.startsWith(".")) continue;
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) out.push(...walk(p));
      else if (e.name.endsWith(".test.ts")) out.push(p);
    }
    return out;
  };
  const files = [...walk(here("../../packages")), ...walk(here("../../tests"))];
  const liveFiles = files.length;
  let liveCases = 0;
  for (const f of files) liveCases += (readFileSync(f, "utf8").match(/\b(?:it|test)\(/g) || []).length;

  const docFiles = [...tpl.matchAll(/data-q="testfiles">(\d+)</g)].map((m) => +m[1]);
  const docCases = [...tpl.matchAll(/data-q="testcases">(\d+)</g)].map((m) => +m[1]);
  if (!docFiles.length) { fail("quality 9b — no test-file count on the status page (data-q=\"testfiles\")"); bad++; }
  if (!docCases.length) { fail("quality 9b — no test-case count on the status page (data-q=\"testcases\")"); bad++; }
  for (const n of docFiles) if (n !== liveFiles) { fail(`quality 9b — status page says ${n} test files; live count is ${liveFiles}`); bad++; }
  for (const n of docCases) if (n !== liveCases) { fail(`quality 9b — status page says ${n} test cases; live count is ${liveCases}`); bad++; }

  if (!bad) console.log(`  ✓ quality — ${Object.keys(budget).length} size ceilings + ${liveFiles} test files · ${liveCases} cases match the status page`);
}

console.log(failures ? `\n✗ ${failures} check(s) failed` : "\n✓ all validation checks passed");
process.exit(failures ? 1 : 0);
