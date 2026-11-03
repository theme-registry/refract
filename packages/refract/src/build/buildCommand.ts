/**
 * `refract build` — load the config, emit every target to disk (Node-only, §7 Step 10c).
 *
 * The config is the adapter seam (10b): `loadConfig` returns fully-constructed adapter objects, and
 * this command drives each through the adapter-agnostic `emitTheme` (10b). The CLI imports zero
 * adapters itself. A target's `outDir` is resolved relative to the config file's directory (so a
 * config is portable regardless of the invoking cwd); an absolute `outDir` is used as-is.
 *
 * Overrides (flags): `--config <path>` picks the config; `--target <name|index|outDir>` limits the
 * build to one target; `--out <dir>` overrides the selected target's `outDir`. `--out` without
 * `--target` is only allowed when the config has exactly one target (otherwise it is ambiguous).
 * Per-target `helpers` are always honored.
 */
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { RawTheme } from "../core/rawTheme";
import { loadConfig, type EmitTarget } from "./config";
import { emitTheme } from "./emitTheme";

export interface BuildOptions {
  readonly cwd?: string;
  /** `--config` override — a path to the config file. */
  readonly configPath?: string;
  /** `--target` override — a target name, numeric index, or outDir to build in isolation. */
  readonly target?: string;
  /** `--out` override — replaces the selected target's outDir. */
  readonly out?: string;
}

export interface BuildTargetSummary {
  readonly name?: string;
  /** For a child theme of a profile's `"as": "themes"` modifier: its folder name (`b`, or `brand-b`). */
  readonly theme?: string;
  readonly adapter: string;
  /** Absolute outDir the target was written to. */
  readonly outDir: string;
  /** Absolute paths of every file written for this target. */
  readonly files: string[];
}

export interface BuildResult {
  readonly configPath: string;
  readonly targets: BuildTargetSummary[];
}

/** Select the target(s) to build. `--target` matches by name, then numeric index, then outDir. */
function selectTargets(targets: readonly EmitTarget[], selector?: string): EmitTarget[] {
  if (selector === undefined) return [...targets];

  const byName = targets.filter(t => t.name === selector);
  if (byName.length) return byName;

  if (/^\d+$/.test(selector)) {
    const idx = Number(selector);
    if (idx >= 0 && idx < targets.length) return [targets[idx]];
  }

  const byOutDir = targets.filter(t => t.outDir === selector);
  if (byOutDir.length) return byOutDir;

  throw new Error(
    `No target matched "${selector}". Config has ${targets.length} target(s): ` +
      targets.map((t, i) => t.name ?? `#${i} (${t.outDir})`).join(", ") + ".",
  );
}

/**
 * The child themes of a profile's `"as": "themes"` modifiers as whole raw themes: each partial (whole
 * changed properties) merged over the base. One folder per context — `<context>`, or
 * `<modifier>-<context>` when there are several such modifiers.
 */
const childThemes = (
  raw: RawTheme,
  themes: Readonly<Record<string, Readonly<Record<string, Partial<RawTheme>>>>>,
): Array<{ folder: string; raw: RawTheme }> => {
  const modifiers = Object.keys(themes);
  const out: Array<{ folder: string; raw: RawTheme }> = [];
  for (const modifier of modifiers) {
    for (const [context, partial] of Object.entries(themes[modifier])) {
      const merged: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
      for (const [sub, slice] of Object.entries(partial as Record<string, unknown>)) {
        merged[sub] = { ...((merged[sub] as Record<string, unknown> | undefined) ?? {}), ...(slice as Record<string, unknown>) };
      }
      out.push({ folder: modifiers.length > 1 ? `${modifier}-${context}` : context, raw: merged as RawTheme });
    }
  }
  return out;
};

/** Load the config and emit every (selected) target to disk. */
export async function runBuild(options: BuildOptions = {}): Promise<BuildResult> {
  const cwd = options.cwd ?? process.cwd();
  const { config, path, themes } = await loadConfig({ cwd, configPath: options.configPath });
  const children = childThemes(config.raw, themes);

  if (!config.targets.length) {
    throw new Error(`"${path}" has no targets to build.`);
  }

  const selected = selectTargets(config.targets, options.target);

  if (options.out !== undefined && selected.length > 1) {
    throw new Error(
      `--out is ambiguous across ${selected.length} targets; pass --target to pick one first.`,
    );
  }

  const configDir = dirname(path);
  const summaries: BuildTargetSummary[] = [];
  for (const target of selected) {
    // A config-relative `outDir` resolves against the config file (portable); a `--out` override is
    // relative to the invoking cwd (it's a command-line path). Absolute paths pass through.
    const outDir =
      options.out !== undefined
        ? isAbsolute(options.out)
          ? options.out
          : resolve(cwd, options.out)
        : isAbsolute(target.outDir)
          ? target.outDir
          : resolve(configDir, target.outDir);
    const emitWith = (raw: typeof config.raw, dir: string) =>
      emitTheme({
        raw,
        adapter: target.adapter,
        outDir: dir,
        helpers: target.helpers,
        emit: target.emit,
        media: config.media,
        units: config.units,
        baseFontSize: config.baseFontSize,
        guide: target.guide,
        preview: target.preview,
      });
    const result = await emitWith(config.raw, outDir);
    summaries.push({
      name: target.name,
      adapter: target.adapter.name,
      outDir: result.outDir,
      files: result.files,
    });
    // A child theme is a complete theme of its own — same class names, its own values — built into a
    // subfolder, so an app switches theme by swapping the stylesheet (or module).
    for (const child of children) {
      const childResult = await emitWith(child.raw, join(outDir, child.folder));
      summaries.push({ name: target.name, theme: child.folder, adapter: target.adapter.name, outDir: childResult.outDir, files: childResult.files });
    }
  }

  return { configPath: path, targets: summaries };
}
