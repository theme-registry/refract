/**
 * Vendorable-helper registry (build-time, Node-only) — the SINGLE source of truth for which live
 * helper modules get shipped into a consumer's build output.
 *
 * Option A vendoring (locked 2026-07-11): a helper is authored ONCE in its natural home (e.g.
 * `lighten`/`darken` in `src/subsystems/colors/utils.ts`) and stays there for refract's own
 * runtime use. This registry merely POINTS at that source; the build layer (`src/build/`, added in
 * 10b) transpiles it (type-strip) and writes the standalone result to the consumer's output. There
 * is NO second copy of the function bodies anywhere, so drift is structurally impossible.
 *
 * Requirement on a listed source: it must be **self-contained** (import-free, or its imports are
 * themselves vendored) so the transpiled artifact is standalone — the "package not needed at
 * runtime" promise. `test/color-math.test.ts` asserts this for `color-math`.
 *
 * This module is build metadata (plain data, no `node:fs`), deliberately NOT re-exported from the
 * runtime `.` barrel — it belongs to the Node-only build/CLI surface (the `./build` subpath, 10e).
 *
 * NOTE (packaging, resolved in 10b): `source` is repo-relative. The published package ships only
 * `dist/`, so the build layer will either ship these helper sources or read a built standalone
 * artifact; that resolution detail is 10b's, not baked in here.
 */

/** A shared, static helper refract can vendor into a consumer's build output. */
export interface VendorHelperSource {
  /** Stable id — also the key a build target opts in by. */
  readonly id: string;
  /** Filename written into the consumer's output directory. */
  readonly outfile: string;
  /** Repo-relative path to the single-source module whose transpiled output is the vendored artifact. */
  readonly source: string;
  /** The named exports the vendored module provides (for docs / validation). */
  readonly exports: readonly string[];
  /** What the helper is for. */
  readonly description: string;
}

/** The shared vendorable helpers. Theme-specific helpers (e.g. the SC media module with baked
 *  `@media` strings) are NOT here — those are generated per-theme by the owning adapter's `emit()`. */
export const VENDOR_HELPERS: readonly VendorHelperSource[] = [
  {
    id: "color-math",
    outfile: "color-math.js",
    source: "src/subsystems/colors/utils.ts",
    exports: [
      "lighten",
      "darken",
      "alpha",
      "setL",
      "rotateHue",
      "complement",
      "adjust",
      "rgbToOklch",
      "oklchToRgb",
      "toHexColor",
      "toOklchColor",
      "convertHexToRGB",
      "convertRgbToHex",
    ],
    description:
      "Pure OKLCH colour math — the exact lighten/darken/setL/rotateHue/complement/adjust (+ OKLCH and hex converters) refract synthesizes palette steps/variants with, so a value computed live in the consumer matches the emitted CSS variables.",
  },
];

/** Look up a vendorable helper by id. */
export const findVendorHelper = (id: string): VendorHelperSource | undefined =>
  VENDOR_HELPERS.find(h => h.id === id);
