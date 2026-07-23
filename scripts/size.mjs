// Size gate — measures the gzipped size of each publishable package's runtime surface against a
// committed budget (`size-budget.json`). Zero deps: `node:zlib` gzip on the real rollup-emitted dist,
// so the number is reproducible by anyone. Exits non-zero when a budget is exceeded.
//
//   node scripts/size.mjs           # measure + enforce budgets
//   node scripts/size.mjs --report  # measure only (never fails) — use to (re)set budgets
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reportOnly = process.argv.includes("--report");

const budgetPath = join(root, "size-budget.json");
const budgets = existsSync(budgetPath) ? JSON.parse(readFileSync(budgetPath, "utf8")) : {};

/** Resolve a file spec (a path under the repo, optionally with one `*` in the basename) to real files. */
const resolveSpec = (spec) => {
  const abs = join(root, spec);
  if (!spec.includes("*")) return existsSync(abs) ? [abs] : [];
  const dir = dirname(abs);
  const base = abs.slice(dir.length + 1);
  const [pre, post] = base.split("*");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith(pre) && f.endsWith(post))
    .map((f) => join(dir, f));
};

/**
 * Follow relative ESM imports from an entry file, returning the whole reachable closure. This measures
 * exactly what a consumer bundles when they import the entry — and, crucially, ignores stale hashed
 * chunks left in `dist` by an earlier build (which a bare glob would wrongly sum).
 */
const collectClosure = (entryAbs) => {
  const seen = new Set();
  const stack = [entryAbs];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f) || !existsSync(f)) continue;
    seen.add(f);
    const src = readFileSync(f, "utf8");
    const dir = dirname(f);
    for (const m of src.matchAll(/(?:from|import)\s*["'](\.\.?\/[^"']+)["']/g)) {
      stack.push(resolve(dir, m[1]));
    }
  }
  return [...seen];
};

let failures = 0;
const rows = [];
for (const [label, entry] of Object.entries(budgets)) {
  const files = entry.entry
    ? collectClosure(join(root, entry.entry))
    : entry.files.flatMap(resolveSpec);
  if (files.length === 0) {
    console.log(`  ✗ ${label}: no files matched ${JSON.stringify(entry.entry ?? entry.files)} — run \`pnpm -r build\` first`);
    failures++;
    continue;
  }
  const buf = Buffer.concat(files.sort().map((f) => readFileSync(f)));
  const raw = buf.length;
  const gzip = gzipSync(buf, { level: 9 }).length;
  const over = !reportOnly && entry.maxGzip != null && gzip > entry.maxGzip;
  if (over) failures++;
  rows.push({ label, raw, gzip, max: entry.maxGzip, over });
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const pad = (s, n) => s.padEnd(n);
console.log(`\n  ${pad("Surface", 40)}${pad("raw", 12)}${pad("gzip", 12)}budget`);
for (const r of rows) {
  const flag = r.over ? "✗" : "✓";
  const budget = r.max != null ? `${kb(r.max)}${r.over ? " — OVER" : ""}` : "(report)";
  console.log(`  ${flag} ${pad(r.label, 38)}${pad(kb(r.raw), 12)}${pad(kb(r.gzip), 12)}${budget}`);
}

if (failures > 0) {
  console.log(`\n✗ ${failures} surface(s) over budget. Trim the change, or raise the budget in size-budget.json if intended.`);
  process.exit(1);
}
console.log(reportOnly ? "\n(report only — budgets not enforced)" : "\n✓ all surfaces within budget");
