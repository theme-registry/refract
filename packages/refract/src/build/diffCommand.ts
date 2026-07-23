/**
 * `refract diff <candidate>` — build the project's theme and a candidate, and report the blast radius
 * (tokens moved, classes changed, contrast crossings). Optional thresholds make it a CI gate: fail the
 * PR if a token change alters more than N classes or drops a pairing below a WCAG bar.
 *
 * Adapter-free like `tokens`/`audit`: it builds against the config's own target adapters (whatever the
 * config imported), picking a class-emitting one so the class axis is populated. The candidate is a
 * module (default-exported raw theme) or a `.json` raw theme.
 */
import { existsSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { RawTheme } from "../core/rawTheme";
import type { Theme, ThemeAdapter } from "../core";
import { createTheme } from "../core/createTheme";
import { createNoopAdapter } from "../core/noopAdapter";
import { loadConfig } from "./config";
import { compileTsConfigGraph } from "./paths";
import { diffThemes, type ThemeDiff } from "./diff";

const WCAG_RANK: Record<string, number> = { fail: 0, "AA-large": 1, AA: 2, AAA: 3 };

export interface DiffCommandOptions {
  cwd?: string;
  configPath?: string;
  /** Path to the candidate theme (`.ts` / `.mjs` / `.js` default-export, or `.json`). */
  candidatePath: string;
  /** CI gate: fail if more than this many classes changed. */
  maxClassChanges?: number;
  /** CI gate: fail if more than this many tokens changed. */
  maxTokenChanges?: number;
  /** CI gate: fail if any pairing's `after` level drops below this WCAG bar. */
  failBelow?: string;
}

export interface TargetStatus {
  name: string;
  ok: boolean;
  errors: string[];
}

export interface DiffCommandResult {
  configPath: string;
  candidatePath: string;
  diff: ThemeDiff;
  /** Per configured target: does the candidate still build? */
  targets: TargetStatus[];
  /** CI-gate verdict: false when any threshold was breached (or a target stopped building). */
  ok: boolean;
  violations: string[];
}

let counter = 0;

/** Load a candidate raw theme from a module (default export) or a `.json` file. */
async function loadCandidate(path: string): Promise<RawTheme> {
  if (!existsSync(path)) throw new Error(`candidate theme not found at "${path}".`);
  if (extname(path) === ".json") {
    return JSON.parse(readFileSync(path, "utf8")) as RawTheme;
  }
  if (extname(path) === ".ts") {
    const { entry, cleanup } = await compileTsConfigGraph(path);
    try {
      const mod = (await import(pathToFileURL(entry).href)) as Record<string, unknown>;
      return (mod.default ?? mod.raw ?? mod) as RawTheme;
    } finally {
      cleanup();
    }
  }
  const mod = (await import(`${pathToFileURL(path).href}?v=${++counter}`)) as Record<string, unknown>;
  return (mod.default ?? mod.raw ?? mod) as RawTheme;
}

/** Does this built theme expose the class-emitting surface (CSS-style adapter)? */
const emitsClasses = (theme: Theme): boolean => typeof (theme as { renderRecipe?: unknown }).renderRecipe === "function";

export async function runDiff(options: DiffCommandOptions): Promise<DiffCommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const { config, path: configPath } = await loadConfig({ cwd, configPath: options.configPath });
  const candidatePath = resolve(cwd, options.candidatePath);
  const candidateRaw = await loadCandidate(candidatePath);
  const buildOpts = { units: config.units, baseFontSize: config.baseFontSize, media: config.media };

  const adapters: Array<{ name: string; adapter: ThemeAdapter }> = config.targets.map((t, i) => ({
    name: t.name ?? t.outDir ?? `target-${i}`,
    adapter: t.adapter,
  }));

  // Per-target: does the candidate still build? (a "targets now fail" signal for CI).
  const targets: TargetStatus[] = adapters.map(({ name, adapter }) => {
    try {
      createTheme(candidateRaw, { adapter, ...buildOpts });
      return { name, ok: true, errors: [] };
    } catch (e) {
      const err = e as { failures?: readonly string[]; message?: string };
      return { name, ok: false, errors: err.failures ? [...err.failures] : [err.message ?? String(e)] };
    }
  });

  // Choose the adapter to diff through: a class-emitting target if any, else the first target, else noop.
  const pick =
    adapters.find(({ adapter }) => emitsClasses(createTheme(config.raw, { adapter, ...buildOpts }))) ??
    adapters[0] ?? { name: "noop", adapter: createNoopAdapter() };
  const base = createTheme(config.raw, { adapter: pick.adapter, ...buildOpts });
  // The candidate may not build (that's a real, reportable outcome — see `targets`). When it doesn't,
  // there's nothing to diff; return the empty diff and let the target-failure violation carry the news.
  const EMPTY_DIFF: ThemeDiff = { tokens: [], classes: [], contrast: [], summary: { tokensChanged: 0, classesChanged: 0, pairingsCrossed: 0 } };
  let diff = EMPTY_DIFF;
  try {
    diff = diffThemes(base, createTheme(candidateRaw, { adapter: pick.adapter, ...buildOpts }));
  } catch {
    /* candidate doesn't build — captured in `targets` below */
  }

  // CI-gate evaluation.
  const violations: string[] = [];
  if (options.maxClassChanges !== undefined && diff.summary.classesChanged > options.maxClassChanges) {
    violations.push(`${diff.summary.classesChanged} classes changed (max ${options.maxClassChanges})`);
  }
  if (options.maxTokenChanges !== undefined && diff.summary.tokensChanged > options.maxTokenChanges) {
    violations.push(`${diff.summary.tokensChanged} tokens changed (max ${options.maxTokenChanges})`);
  }
  if (options.failBelow) {
    const bar = WCAG_RANK[options.failBelow] ?? 0;
    for (const c of diff.contrast) {
      const afterRank = c.after?.level ? (WCAG_RANK[c.after.level] ?? 0) : 0;
      const beforeRank = c.before?.level ? (WCAG_RANK[c.before.level] ?? 0) : 0;
      if (c.after && afterRank < bar && afterRank < beforeRank) {
        violations.push(`${c.label} drops to ${c.after.level} (below ${options.failBelow})`);
      }
    }
  }
  const failedTargets = targets.filter((t) => !t.ok).map((t) => t.name);
  if (failedTargets.length) violations.push(`candidate no longer builds for: ${failedTargets.join(", ")}`);

  return { configPath, candidatePath, diff, targets, ok: violations.length === 0, violations };
}
