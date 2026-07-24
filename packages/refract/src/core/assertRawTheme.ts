/**
 * Fail-loud shape guard for a value that is *supposed* to be a {@link RawTheme}.
 *
 * `createTheme` accepts a bare object, and an empty `{}` is a valid (empty) theme — so a value of the
 * *wrong* shape doesn't necessarily throw during a build. That's the trap `refract diff` fell into: hand
 * it a `defineConfig({ raw, targets })` where it wanted the raw theme and it built the config as an
 * (effectively empty) theme, then reported a nonsense "every token removed" diff and exited 0. A
 * governance tool must not quietly mis-report. This guard is the loud, coded gate for that class of
 * mistake — used by `diff` (and available to `validate` / the MCP server) before anything is compared.
 *
 * It is deliberately narrow: it rejects only values that cannot be a RawTheme (non-objects, arrays,
 * `null`) or that are affirmatively something else (a `defineConfig`, spotted by its `targets` array).
 * A bare `{}` still passes — an empty theme is legitimately empty.
 */
import { RefractError } from "./errors";
import type { RawTheme } from "./rawTheme";

export function assertRawTheme(value: unknown, source?: string): asserts value is RawTheme {
  const at = source ? ` (${source})` : "";

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    const got = Array.isArray(value) ? "an array" : value === null ? "null" : typeof value;
    throw new RefractError(
      "REFRACT_E_RAW_SHAPE",
      `Expected a RawTheme object${at}, got ${got}. Pass the raw theme (a module's default export, or a .json raw theme).`,
    );
  }

  // The documented mistake: a defineConfig({ raw, targets }) passed where the bare RawTheme was wanted.
  // A RawTheme never has a top-level `targets`; a config always does.
  if (Array.isArray((value as { targets?: unknown }).targets)) {
    throw new RefractError(
      "REFRACT_E_RAW_SHAPE",
      `Expected a RawTheme object${at}, but got what looks like a defineConfig({ raw, targets }). Pass its \`raw\` (or a module that default-exports the raw theme), not the whole config.`,
    );
  }
}
