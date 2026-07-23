// Reproducible perf benchmark — times a full `createTheme` + `theme.css` compile and an
// `override(delta)` + `.css` re-compile on this site's richest preset, so the docs' perf numbers have
// a committed source anyone can re-run: `node scripts/bench.mjs`. Zero deps; requires a prior build.
//
// Method: pick the largest root preset (by emitted CSS), warm up, then take the MEDIAN of N runs in
// V8 (Node). Numbers scale with theme size and hardware — treat as order-of-magnitude.
import { PRESETS } from "../website/presets.mjs";
import { createTheme } from "../packages/refract/dist/index.esm.js";
import { createCssAdapter } from "../packages/refract-css/dist/index.esm.js";

const N = 400;
const WARMUP = 50;

// The richest root preset — most emitted CSS.
const roots = PRESETS.filter((p) => p.kind !== "override");
let richest = null;
for (const p of roots) {
  const css = createTheme(p.raw, { adapter: createCssAdapter() }).css;
  if (!richest || css.length > richest.len) richest = { id: p.id, raw: p.raw, len: css.length };
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const timeIt = (fn) => {
  const t0 = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - t0) / 1e6; // ms
};

// createTheme + .css
const compile = () => createTheme(richest.raw, { adapter: createCssAdapter() }).css;
for (let i = 0; i < WARMUP; i++) compile();
const compileMs = [];
for (let i = 0; i < N; i++) compileMs.push(timeIt(compile));

// override(delta) + .css
const parent = createTheme(richest.raw, { adapter: createCssAdapter() });
const delta = { colors: { brand: { base: "#8aa2ff", text: "#0b1020" } } };
const reTheme = () => parent.override(delta).css;
for (let i = 0; i < WARMUP; i++) reTheme();
const overrideMs = [];
for (let i = 0; i < N; i++) overrideMs.push(timeIt(reTheme));

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return { median: median(s), p95: s[Math.floor(s.length * 0.95)], min: s[0] };
};
const c = stats(compileMs);
const o = stats(overrideMs);
const f = (n) => `${n.toFixed(3)} ms`;

const meta = createTheme(richest.raw, { adapter: createCssAdapter() });
const classes = (meta.css.match(/\.dt-[a-z0-9-]+\s*\{/g) || []).length;
const media = (meta.css.match(/@media/g) || []).length;

console.log(`\n  refract perf — preset "${richest.id}" (${classes} recipe classes · ${media} @media rules)`);
console.log(`  ${N} runs in V8 (Node ${process.version}), median:\n`);
console.log(`  createTheme() + theme.css   median ${f(c.median)}   p95 ${f(c.p95)}   min ${f(c.min)}`);
console.log(`  override(delta) + .css      median ${f(o.median)}   p95 ${f(o.p95)}   min ${f(o.min)}`);
console.log(`  override vs fresh compile:   ${(100 * (1 - o.median / c.median)).toFixed(0)}% faster\n`);
