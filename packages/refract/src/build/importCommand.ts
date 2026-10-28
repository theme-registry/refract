/**
 * `refract import` — seed a theme from a DTCG `tokens.json` (Node-only, §7 Step 10f).
 *
 * DTCG is edge interchange, NOT a build input: rather than load `tokens.json` on every build, this
 * runs `importDTCG` ONCE and writes a `theme.raw.ts` the user then owns and edits — the same ownership
 * model as `init` (blank template), just seeded from a DTCG document instead. Two reasons it must be a
 * one-shot scaffold, not a live loader:
 *   - the import places tokens by `$type` and path keywords and resolves aliases to literals (drops the DTCG `border` composite's
 *     color, rounds rem→px). Baking those guesses in on every build would hide them; as generated
 *     source they land as an editor-reviewable diff.
 *   - DTCG carries **property tokens only** — recipes / composition / states / components have no DTCG
 *     representation, so the seed is always incomplete and needs hand-authoring on top.
 *
 * Emits a typed `theme.raw.ts` (`export const raw: RawTheme = …`) and, unless `--raw-only`, a runnable
 * `theme.config.ts` that imports it (the §8b sibling-`.ts` graph-compile makes the extensionless
 * `./theme.raw` import resolve). Refuses to clobber either file unless `--force`.
 *
 * `importDTCG` is imported as a relative `../dtcg` static import (NOT the `./dtcg` package subpath) so the
 * in-repo gate resolves with no dist build — the same pattern as the rest of `src/build/`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import {
  dtcgImporter,
  importDTCG,
  isImporter,
  type DTCGDocument,
  type DTCGImportReport,
  type Importer,
  type ImportDTCGOptions,
} from "../dtcg";
import { importConfigModule } from "./config";
import { readOwnPackageName, CSS_ADAPTER_PACKAGE } from "./init";

const DEFAULT_RAW_OUT = "theme.raw.ts";
const DEFAULT_CONFIG_OUT = "theme.config.ts";

export interface ImportOptions {
  /** Project dir to scaffold into (default `process.cwd()`). */
  readonly cwd?: string;
  /** Path to the DTCG `tokens.json` to import (relative to cwd or absolute). Required. */
  readonly input: string;
  /** `--out` — the raw-theme file to write (default `theme.raw.ts`, resolved against cwd). */
  readonly out?: string;
  /** `--raw-only` — write only `theme.raw.ts`, skip the companion `theme.config.ts` (default false). */
  readonly rawOnly?: boolean;
  /** `--force` — overwrite existing files instead of refusing (default false). */
  readonly force?: boolean;
  /** `--breakpoint-group` — DTCG group whose dimension tokens seed the breakpoints. */
  readonly breakpointGroup?: string;
  /** `--breakpoints` — explicit `{ name: px }` fallback when the doc carries no breakpoint group. */
  readonly breakpoints?: Record<string, number>;
  /** `--importer` — the importer to run (resolve a flag with {@link loadImporter}; default `dtcgImporter`). */
  readonly importer?: Importer;
  /** Package name the generated files import from (default: this package's own `name`). */
  readonly packageName?: string;
}

export interface ImportResult {
  /** Absolute path of the DTCG document read. */
  readonly inputFile: string;
  /** Absolute path of the written `theme.raw.ts`. */
  readonly rawFile: string;
  /** Absolute path of the written `theme.config.ts`, or `undefined` when `--raw-only`. */
  readonly configFile?: string;
  /** Top-level raw keys produced (e.g. `["breakpoints", "colors", "typography"]`). */
  readonly sections: readonly string[];
  /** The raw theme that was written. */
  readonly raw: Readonly<Record<string, unknown>>;
  /** Per-subsystem property count seeded from the document (excludes `breakpoints`). */
  readonly counts: Readonly<Record<string, number>>;
  /** What happened to every token: placements, unmapped (with reasons), chosen bases, renames, diagnostics. */
  readonly report: DTCGImportReport;
}

/** Importers `--importer` names directly; anything else is a path to a module exporting one. */
export const BUILT_IN_IMPORTERS: Readonly<Record<string, Importer>> = { dtcg: dtcgImporter };

/**
 * Resolve an `--importer` flag: a built-in name (`dtcg`), else a `.ts`/`.mjs`/`.js` module (relative to
 * `cwd`) whose default (or `importer`) export is a `defineImporter(...)` result.
 */
export async function loadImporter(spec: string, cwd: string = process.cwd()): Promise<Importer> {
  const builtIn = BUILT_IN_IMPORTERS[spec];
  if (builtIn) return builtIn;
  const path = isAbsolute(spec) ? spec : resolve(cwd, spec);
  if (!existsSync(path)) {
    throw new Error(
      `No importer "${spec}": not a built-in (${Object.keys(BUILT_IN_IMPORTERS).join(", ")}) and no file at "${path}".`,
    );
  }
  const mod = await importConfigModule(path);
  const importer = mod.default ?? mod.importer;
  if (!isImporter(importer)) {
    throw new Error(`"${path}" must export (default) a defineImporter({ name, version, … }) result.`);
  }
  return importer;
}

/** Parse a `--breakpoints "sm:576,md:768"` flag into `{ sm: 576, md: 768 }`. Ignores malformed pairs. */
export function parseBreakpointsFlag(spec: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const pair of spec.split(",")) {
    const [name, raw] = pair.split(":");
    const key = name?.trim();
    const value = Number.parseFloat((raw ?? "").trim());
    if (key && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

/** The generated `theme.raw.ts` body — a typed `RawTheme` the user then owns and extends. */
export function scaffoldRaw(packageName: string, raw: unknown, sourceLabel: string, importer: Importer = dtcgImporter): string {
  const body = JSON.stringify(raw, null, 2);
  return `// Generated by \`refract import\` from ${sourceLabel} with the "${importer.name}" importer (contract v${importer.version}).
// Tokens are placed by \`$type\` and path keywords; text styles become typography recipes. Aliases are
// resolved to their values, and components, composition and states are not imported. Review the
// tokens (\`refract import\` printed what it chose and what it left out), then author the rest below.
import type { RawTheme } from "${packageName}/build";

export const raw: RawTheme = ${body};
`;
}

/** The generated companion `theme.config.ts` — a runnable build config importing the seeded raw. */
export function scaffoldImportConfig(packageName: string, rawImportSpec: string): string {
  return `import { defineConfig } from "${packageName}/build";
import { createCssAdapter } from "${CSS_ADAPTER_PACKAGE}";
import { raw } from "${rawImportSpec}";

// Generated by \`refract import\`. This is your build config — edit it freely. Add adapter options at
// construction (\`createCssAdapter({ … })\`) and extra targets (SC/JSON/…) as their packages install.
export default defineConfig({
  raw,
  targets: [
    { adapter: createCssAdapter(), outDir: "dist/theme" },
  ],
});
`;
}

/** Count seeded properties per subsystem for the summary (each subsystem value is a `{ prop: … }` map). */
function summarizeCounts(raw: Record<string, unknown>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "breakpoints") continue;
    counts[key] = value && typeof value === "object" ? Object.keys(value).length : 0;
  }
  return counts;
}

/**
 * Read the DTCG document at `input`, convert it via `importDTCG`, and write a `theme.raw.ts` (plus, unless
 * `rawOnly`, a companion `theme.config.ts`) into `cwd`. Returns a summary of what was seeded. Throws on a
 * missing/unparseable input or when an output file exists and `force` is not set (never clobbers).
 */
export function runImport(options: ImportOptions): ImportResult {
  const cwd = options.cwd ?? process.cwd();
  const packageName = options.packageName ?? readOwnPackageName();

  // --- Read + parse the DTCG document ---
  const inputFile = isAbsolute(options.input) ? options.input : resolve(cwd, options.input);
  if (!existsSync(inputFile)) {
    throw new Error(`No DTCG document found at "${options.input}" (resolved to "${inputFile}").`);
  }
  let doc: unknown;
  try {
    doc = JSON.parse(readFileSync(inputFile, "utf8"));
  } catch (err) {
    throw new Error(`"${inputFile}" is not valid JSON: ${(err as Error).message}`);
  }

  // --- Convert (one-shot at import time only; the report says what was placed, chosen or left out) ---
  const importer = options.importer ?? dtcgImporter;
  const fromOpts: ImportDTCGOptions = { importer };
  if (options.breakpointGroup) fromOpts.breakpointGroup = options.breakpointGroup;
  if (options.breakpoints && Object.keys(options.breakpoints).length) {
    fromOpts.breakpoints = options.breakpoints;
  }
  const { raw, report } = importDTCG(doc as DTCGDocument, fromOpts);

  // --- Write theme.raw.ts (refuse to clobber unless --force) ---
  const rawFile = options.out
    ? isAbsolute(options.out)
      ? options.out
      : resolve(cwd, options.out)
    : resolve(cwd, DEFAULT_RAW_OUT);
  if (existsSync(rawFile) && !options.force) {
    throw new Error(`${basename(rawFile)} already exists at "${rawFile}". Pass --force to overwrite it.`);
  }
  mkdirSync(dirname(rawFile), { recursive: true });
  writeFileSync(rawFile, scaffoldRaw(packageName, raw, JSON.stringify(basename(inputFile)), importer), "utf8");

  // --- Write the companion theme.config.ts (unless --raw-only; refuse to clobber unless --force) ---
  let configFile: string | undefined;
  if (!options.rawOnly) {
    configFile = resolve(dirname(rawFile), DEFAULT_CONFIG_OUT);
    if (existsSync(configFile) && !options.force) {
      throw new Error(
        `${DEFAULT_CONFIG_OUT} already exists at "${configFile}". Pass --force to overwrite it, or ` +
          `--raw-only to skip writing a config.`,
      );
    }
    // Extensionless sibling spec — the §8b graph-compile rewrites it to the emitted `.mjs`.
    const rawImportSpec = `./${basename(rawFile).replace(/\.(ts|mts|cts|tsx)$/, "")}`;
    writeFileSync(configFile, scaffoldImportConfig(packageName, rawImportSpec), "utf8");
  }

  return {
    inputFile,
    rawFile,
    configFile,
    sections: Object.keys(raw),
    raw,
    counts: summarizeCounts(raw),
    report,
  };
}

/** How many entries of a list to print before "… N more". */
const REPORT_LIMIT = 8;

const listLines = <T>(items: readonly T[], line: (item: T) => string): string[] => {
  const shown = items.slice(0, REPORT_LIMIT).map(i => `    ${line(i)}`);
  if (items.length > REPORT_LIMIT) shown.push(`    … ${items.length - REPORT_LIMIT} more`);
  return shown;
};

/**
 * The import report as CLI lines: what landed per subsystem, then every base that was chosen, every
 * token left out (with why), every rename and every parse diagnostic. Pure, so it's testable.
 */
export function importReportLines(raw: Record<string, unknown>, report: DTCGImportReport): string[] {
  const lines: string[] = [];
  for (const [sub, slice] of Object.entries(raw)) {
    if (sub === "breakpoints") {
      lines.push(`  breakpoints  ${Object.keys(slice as object).length}`);
      continue;
    }
    const entries = Object.entries(slice as Record<string, unknown>);
    const props = entries.filter(([k]) => k !== "recipes");
    const variants = props.reduce(
      (n, [, v]) => n + Object.keys(((v as { variants?: object }).variants) ?? {}).length,
      0,
    );
    const recipeGroups = (slice as { recipes?: Record<string, object> }).recipes;
    const recipes = recipeGroups ? Object.values(recipeGroups).reduce((n, g) => n + Object.keys(g).length, 0) : 0;
    lines.push(
      `  ${sub.padEnd(11)}  ${props.length} propert${props.length === 1 ? "y" : "ies"} · ${variants} variant${variants === 1 ? "" : "s"}` +
        (recipes ? ` · ${recipes} recipe${recipes === 1 ? "" : "s"}` : ""),
    );
  }
  if (report.bases.length) {
    lines.push(`  base chosen (no $root or base member): ${report.bases.length}`);
    lines.push(...listLines(report.bases, b => `${b.property} ← "${b.from}"`));
  }
  if (report.renamed.length) {
    lines.push(`  renamed: ${report.renamed.length}`);
    lines.push(...listLines(report.renamed, r => `${r.path}: ${r.from} → ${r.to}`));
  }
  lines.push(`  unmapped: ${report.unmapped.length || "none"}`);
  lines.push(...listLines(report.unmapped, u => `${u.path} — ${u.reason}`));
  if (report.notes.length) lines.push(...listLines(report.notes, n => `${n.path}: ${n.message}`));
  if (report.diagnostics.length) {
    lines.push(`  diagnostics: ${report.diagnostics.length}`);
    lines.push(...listLines(report.diagnostics, d => `${d.severity} ${d.code} ${d.path} — ${d.message}`));
  }
  return lines;
}
