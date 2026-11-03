/**
 * `refract tokens` — export the theme as a DTCG `tokens.json` (Node-only, §7 Step 10d).
 *
 * A SEPARATE command from `build`, not part of it: DTCG is adapter-free data-interchange, not an
 * output adapter. So this reads ONLY the config's `raw` (never its `targets`/`emitTheme`) and writes a
 * single JSON document — no `theme.css`, no vendored helpers.
 *
 * `toDTCG` needs a *built* `Theme` (it walks the flat `theme.tokens` + `theme.resolveToken` +
 * `theme.model.breakpoints`), so we `createTheme(raw, { adapter })` first. The adapter choice is
 * IMMATERIAL to the output — `toDTCG` never touches adapter-produced strings — so we use core's own
 * built-in `createNoopAdapter` as the trivial builder. (Before the monorepo split this reached for
 * `createCssAdapter`, which forced a core→adapter dependency; the null adapter keeps `src/build` free
 * of every adapter package — the guiding rule is the dependency arrow points ONLY into core.)
 *
 * `toDTCG` is imported as a relative `../dtcg` static import (NOT the `./dtcg` package subpath) so the
 * in-repo gate resolves with no dist build — the same pattern as everything else in `src/build/`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { createTheme } from "../core/createTheme";
import { createNoopAdapter } from "../core/noopAdapter";
import { toDTCG } from "../dtcg";
import { loadConfig } from "./config";

const DEFAULT_OUT = "tokens.json";

export interface TokensOptions {
  readonly cwd?: string;
  /** `--config` override — a path to the config file. */
  readonly configPath?: string;
  /** `--out` override — the JSON file to write (default `tokens.json`; with `profile`, the folder, default `tokens/`). */
  readonly out?: string;
  /** `--profile` — write Refract DTCG profile files (a resolver + token files) instead of one plain document. */
  readonly profile?: boolean;
}

export interface TokensResult {
  /** Absolute path the config was loaded from. */
  readonly configPath: string;
  /** Absolute path of the written `tokens.json`. */
  readonly outFile: string;
  /** Number of top-level DTCG groups written (excludes `$`-prefixed document keys). */
  readonly groupCount: number;
  /** With `profile`: every file written (the resolver first). */
  readonly files?: readonly string[];
}

/** Load the config, build the theme, and write its DTCG document to disk. Returns a summary. */
export async function runTokens(options: TokensOptions = {}): Promise<TokensResult> {
  const cwd = options.cwd ?? process.cwd();
  const { config, path } = await loadConfig({ cwd, configPath: options.configPath });

  if (options.profile) {
    const dir = options.out ? (isAbsolute(options.out) ? options.out : resolve(cwd, options.out)) : resolve(cwd, "tokens");
    const { resolver, files } = toDTCG(config.raw, { profile: true });
    mkdirSync(dir, { recursive: true });
    const written = [resolve(dir, "resolver.json")];
    writeFileSync(written[0], `${JSON.stringify(resolver, null, 2)}\n`, "utf8");
    for (const [name, doc] of Object.entries(files)) {
      const file = resolve(dir, name);
      writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
      written.push(file);
    }
    const base = files["base.tokens.json"] as Record<string, unknown>;
    return { configPath: path, outFile: written[0], groupCount: Object.keys(base).filter(k => !k.startsWith("$")).length, files: written };
  }

  // Adapter choice is immaterial — `toDTCG` reads only `theme.tokens`/`resolveToken`/`model`.
  const theme = createTheme(config.raw, { adapter: createNoopAdapter() });
  const doc = toDTCG(theme);

  // `--out` is a command-line path (relative to cwd); absolute passes through.
  const outFile = options.out
    ? isAbsolute(options.out)
      ? options.out
      : resolve(cwd, options.out)
    : resolve(cwd, DEFAULT_OUT);

  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(doc, null, 2)}\n`, "utf8");

  const groupCount = Object.keys(doc).filter(k => !k.startsWith("$")).length;
  return { configPath: path, outFile, groupCount };
}
