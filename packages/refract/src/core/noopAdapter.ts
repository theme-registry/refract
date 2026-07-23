/**
 * `createNoopAdapter` — the trivial, built-in null adapter (monorepo split, friction 2).
 *
 * `createTheme` requires an `adapter`, but some consumers of the built `Theme` never touch
 * adapter-produced strings — they read only the format-neutral `theme.tokens` / `theme.resolveToken`
 * / `theme.model` (the DTCG export is the canonical example: `toDTCG` walks the flat token map and the
 * breakpoints, never a rendered rule). Those callers need *a* valid adapter purely to satisfy the
 * contract; the output is discarded.
 *
 * Before the split the CLI's `tokens` command reached for `createCssAdapter` as that throwaway builder
 * — which forced a core→adapter dependency (`src/build` importing `src/adapters/css`). The monorepo
 * guiding rule is that the dependency arrow points ONLY into core, so core now ships its own null
 * object: `createNoopAdapter()` emits nothing (empty strings, an empty `emit()`), lets `createTheme`
 * build the Model + token map exactly as any adapter would, and keeps `src/build` free of every
 * adapter package.
 *
 * It's a `ThemeAdapter` like any other (built through {@link defineAdapter}, so it gets the defaulted
 * aggregators for free), just with render primitives that produce empty output.
 */

import { defineAdapter } from "./defineAdapter";
import type { ThemeAdapter } from "./ThemeAdapter";

/**
 * A no-op adapter: every render primitive returns an empty string and `emit()` writes no files. Use it
 * whenever a `Theme` is needed only for its format-neutral data (`tokens` / `resolveToken` / `model`)
 * and the rendered output is irrelevant — e.g. the `refract tokens` DTCG export.
 */
export function createNoopAdapter(): ThemeAdapter<string> {
  return defineAdapter<string>({
    name: "noop",
    version: 1,
    bind: () => ({
      recipeName: () => "",
      renderRecipe: () => "",
      renderVariables: () => "",
      join: parts => parts.join(""),
      emit: () => ({ files: {} }),
    }),
  });
}
