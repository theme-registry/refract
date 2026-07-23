/**
 * `theme.config.(ts|js|mjs)` — the primary build interface + the adapter seam (Node-only, §7 10b).
 *
 * The config is USER CODE in the user's project: it `import`s the adapter from wherever it lives
 * (refract for CSS, an external package for SC/third-party) and hands the CLI a fully-constructed
 * adapter object per target. That `import` IS the extensibility seam — same model as
 * Rollup/Vite/PostCSS/Jest — so adapter *options* (`prefix`/…) are passed at construction in the
 * config, not as CLI flags. Multiple targets let one theme emit CSS + SC at once.
 *
 * Loader (chosen 2026-07-11 — NO new dep): reuse `typescript` (an OPTIONAL peer, lazy-loaded as of
 * Step 10e — only a `.ts` config pays for it). A `.ts` config is compiled via a `ts.createProgram`
 * **graph compile** (§8b): the config **and its local relative `.ts` graph** are type-stripped to
 * adjacent hidden `.mjs` files, so a `.ts` config can `import` a sibling `theme.raw.ts` (the 8a
 * `RawTheme` payoff). Bare specifiers and relative `.mjs`/`.js`/`.json` stay external (resolved at
 * their original adjacent location). `.mjs`/`.js` configs import directly. See {@link compileTsConfigGraph}
 * for the emit-location + specifier-rewrite details. Rejected jiti/esbuild (both absent → a new dep).
 */
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ThemeAdapter, Emit } from "../core/ThemeAdapter";
import type { RawTheme } from "../core/rawTheme";
import type { MediaConfig } from "../core/media";
import type { UnitsConfig } from "../core/units";
import type { GuideConfig } from "./emitTheme";
import { compileTsConfigGraph } from "./paths";

/** One emit target: an adapter + where to write it, plus which shared vendored helpers it wants. */
export interface EmitTarget {
  readonly adapter: ThemeAdapter;
  readonly outDir: string;
  readonly helpers?: readonly string[];
  /** Optional label — lets `refract build --target <name>` select this target (else index/outDir). */
  readonly name?: string;
  /** Optional output-shape directive (§9): single / split / subsystem / components. Default = single. */
  readonly emit?: Emit;
  /**
   * §C — emit a self-documenting `llms.txt` + `manifest.json` into this target's `outDir`, so a
   * published/zipped theme carries its own AI consumption guide (real class names / token paths) for
   * a downstream dev who has neither refract nor its skills. `true` uses defaults; an object tunes the
   * file names or adds a `packageName` for a by-specifier import overlay. Off by default.
   */
  readonly guide?: boolean | GuideConfig;
}

/** The `theme.config` shape: the raw theme + one or more emit targets. */
export interface ThemeConfig {
  readonly raw: RawTheme;
  readonly targets: readonly EmitTarget[];
  /**
   * Media-query output config (§10.5) — `{ unit: "px" | "em" | "rem"; baseFontSize }`. Applies to
   * both the viewport `@media` and container `@container` widths (breakpoints/container thresholds are
   * authored as px numbers; `unit` controls the emitted unit). Defaults to px.
   */
  readonly media?: MediaConfig;
  /**
   * Declaration-value length units (§21) — a token-path role map (`units.default`, `units["<subsystem>"]`,
   * `units["<subsystem>.<property>"]`), most-specific wins over the built-in seed. Resolved once, format-
   * neutrally, so every target emits the same unit. The build-time twin of `createTheme`'s `units` option.
   */
  readonly units?: UnitsConfig;
  /** Divisor when a deferred length resolves to `rem` (§21). Defaults to 16. */
  readonly baseFontSize?: number;
}

/** Identity fn — types the config authored in `theme.config.(ts|js|mjs)`. */
export const defineConfig = (config: ThemeConfig): ThemeConfig => config;

const CONFIG_BASENAME = "theme.config";
const EXT_ORDER = [".ts", ".mjs", ".js"] as const;

/** Find `theme.config.{ts,mjs,js}` in `fromDir`, honoring the ts→mjs→js resolution order. */
export const findConfigFile = (fromDir: string = process.cwd()): string | undefined => {
  for (const ext of EXT_ORDER) {
    const candidate = join(fromDir, `${CONFIG_BASENAME}${ext}`);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
};

/**
 * Import a config module. A `.ts` file is graph-compiled (config + its relative `.ts` graph → adjacent
 * hidden `.mjs` files; see {@link compileTsConfigGraph}) then the emitted entry is dynamically imported
 * and every temp file removed; `.mjs`/`.js` are imported directly.
 */
let importCounter = 0;
async function importConfigModule(path: string): Promise<Record<string, unknown>> {
  if (extname(path) !== ".ts") {
    // Cache-bust the ESM import: Node caches modules by URL, so a repeated `loadConfig` on an *edited*
    // config (e.g. a long-lived MCP server watching `theme.config.mjs`) would otherwise re-get the stale
    // module. A fresh query key forces a re-read. Harmless for one-shot CLI use. (A `.ts` config already
    // re-reads: `compileTsConfigGraph` emits a fresh temp file each call.)
    const url = `${pathToFileURL(path).href}?v=${++importCounter}`;
    return (await import(url)) as Record<string, unknown>;
  }
  const { entry, cleanup } = await compileTsConfigGraph(path);
  try {
    return (await import(pathToFileURL(entry).href)) as Record<string, unknown>;
  } finally {
    cleanup();
  }
}

export interface LoadedConfig {
  readonly config: ThemeConfig;
  /** Absolute path the config was loaded from. */
  readonly path: string;
}

/**
 * Resolve + load a `theme.config`. `configPath` (a CLI `--config` override) wins; otherwise the
 * ts→mjs→js search in `cwd`. Returns the `defineConfig(...)` object (default or named `config` export).
 */
export async function loadConfig(
  options: { cwd?: string; configPath?: string } = {},
): Promise<LoadedConfig> {
  const cwd = options.cwd ?? process.cwd();
  const path = options.configPath ? resolve(cwd, options.configPath) : findConfigFile(cwd);
  if (!path || !existsSync(path)) {
    const where = options.configPath ? `"${options.configPath}"` : `${CONFIG_BASENAME}.(ts|mjs|js) in "${cwd}"`;
    throw new Error(`No theme config found at ${where}.`);
  }

  const mod = await importConfigModule(path);
  const config = (mod.default ?? mod.config ?? mod) as ThemeConfig;
  if (!config || typeof config !== "object" || !Array.isArray(config.targets)) {
    throw new Error(`"${path}" must export (default) a defineConfig({ raw, targets }) object.`);
  }
  return { config, path };
}
