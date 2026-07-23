/**
 * `refract audit` — score the theme's colour pairings for WCAG 2 contrast (+ advisory APCA).
 *
 * Adapter-free like `refract tokens`: the audit reads only `theme.tokens` / `theme.resolveToken` /
 * `theme.model`, so we build with core's `createNoopAdapter`. Reports by default; `--strict` makes the
 * command exit non-zero (via an aggregated throw from `audit`). Returns a serializable summary so the
 * gate test can drive it directly.
 *
 * `audit` is imported as a relative `../subsystems/colors/audit` (not a package subpath) so the in-repo
 * gate resolves with no dist build — the same pattern as the rest of `src/build/`.
 */
import { createTheme } from "../core/createTheme";
import { createNoopAdapter } from "../core/noopAdapter";
import { audit, type AuditResult, type WcagLevel } from "../subsystems/colors/audit";
import { loadConfig } from "./config";

export interface AuditCommandOptions {
  readonly cwd?: string;
  /** `--config` override — a path to the config file. */
  readonly configPath?: string;
  /** `--strict` — throw (non-zero exit) when any pairing fails. */
  readonly strict?: boolean;
  /** `--min-wcag` — pass bar (`"AA"` default). */
  readonly minWcag?: WcagLevel;
  /** `--large` — score against large-text thresholds. */
  readonly largeText?: boolean;
}

export interface AuditCommandResult {
  /** Absolute path the config was loaded from. */
  readonly configPath: string;
  readonly result: AuditResult;
}

/** Load the config, build the theme (adapter-free), and audit its colour pairings. */
export async function runAudit(options: AuditCommandOptions = {}): Promise<AuditCommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const { config, path } = await loadConfig({ cwd, configPath: options.configPath });

  const theme = createTheme(config.raw, { adapter: createNoopAdapter() });
  const result = audit(theme, {
    strict: options.strict,
    minWcag: options.minWcag,
    largeText: options.largeText,
  });
  return { configPath: path, result };
}
