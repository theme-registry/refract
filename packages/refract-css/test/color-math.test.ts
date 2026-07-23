/**
 * Step 10a gate — the `emit` contract + the vendorable colour-math helper (Option A: single source).
 *
 * Under Option A there is NO second copy of the colour math: `lighten`/`darken` live only in
 * `src/subsystems/colors/utils.ts`, and the vendored artifact is that same module transpiled
 * standalone. So this proves:
 *  1. The CSS adapter's `emit()` returns just the theme-specific `theme.css` — it does NOT re-embed
 *     the shared colour-math (that's the build layer's job, from the single source).
 *  2. The registered source (`src/build/vendor.ts` → `color-math`) is genuinely vendorable: it is
 *     self-contained (import-free) and, transpiled standalone + re-imported in isolation, its
 *     `lighten`/`darken` match the live functions refract runs (so the emitted CSS + a live
 *     runtime adjustment agree). Because it IS the live source, drift is structurally impossible;
 *     this guards that the transpile pipeline yields a runnable, self-contained module.
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import ts from "typescript";
import { createTheme } from "@theme-registry/refract";
import { createCssAdapter } from "../src";
import {
  lighten as liveLighten,
  darken as liveDarken,
  setL as liveSetL,
  rotateHue as liveRotateHue,
  adjust as liveAdjust,
} from "@theme-registry/refract/color-math";
import {
  buildMediaDescriptor,
  mediaQueryString,
  resolveMediaConfig,
} from "@theme-registry/refract";
import { findVendorHelper } from "@theme-registry/refract/build";
import { reactSc } from "@theme-registry/theme-fixtures";

// The vendorable source (`src/subsystems/colors/utils.ts`) ships inside the refract *core* package
// (post monorepo split), and `helper.source` is package-root-relative to it — so resolve the refract
// package root from its exported package.json rather than assuming a repo layout.
const REFRACT_ROOT = dirname(createRequire(import.meta.url).resolve("@theme-registry/refract/package.json"));

/** Bind the CSS adapter the way `createTheme` does, so we can reach `emit()` (not on the theme). */
const emitReactSc = () => {
  const adapter = createCssAdapter();
  const theme = createTheme(reactSc.rawTheme as any, { adapter }) as any;
  const breakpoints = reactSc.rawTheme.breakpoints as Record<string, number>;
  const media = buildMediaDescriptor(breakpoints, o => mediaQueryString(o, resolveMediaConfig(undefined)));
  const bound = adapter.bind(theme.model, { media, resolve: theme.resolveToken } as any) as any;
  return bound.emit();
};

describe("CSS adapter emit", () => {
  it("returns just the theme.css stylesheet — shared color-math is not re-embedded", () => {
    const emitted = emitReactSc();

    expect(Object.keys(emitted.files)).toEqual(["theme.css"]);
    expect(emitted.files["theme.css"]).toContain(":root {");
    // A real recipe class rides along (colors solid recipe → `.dt-color-solid-primary`).
    expect(emitted.files["theme.css"]).toMatch(/\.dt-colors-solid-primary\s*\{/);
    // color-math is a SHARED static helper vendored by the build layer, not by the adapter.
    expect(emitted.vendorHelpers).toBeUndefined();
  });
});

describe("vendorable color-math (single source)", () => {
  const helper = findVendorHelper("color-math")!;
  const sourcePath = join(REFRACT_ROOT, helper.source);
  const sourceText = readFileSync(sourcePath, "utf8");

  it("is registered pointing at the live colors utility (no duplicate)", () => {
    expect(helper).toBeDefined();
    expect(helper.source).toBe("src/subsystems/colors/utils.ts");
    expect(helper.outfile).toBe("color-math.js");
    expect(helper.exports).toEqual(expect.arrayContaining(["lighten", "darken"]));
  });

  it("its source module is self-contained (import-free)", () => {
    // The vendored artifact must stand alone in a consumer that has dropped refract.
    expect(sourceText).not.toMatch(/^\s*import\s/m);
    expect(sourceText).not.toMatch(/\brequire\s*\(/);
    expect(sourceText).not.toMatch(/\bfrom\s+["']/);
  });

  describe("transpiled standalone + re-imported in isolation", () => {
    const dir = mkdtempSync(join(tmpdir(), "refract-color-math-"));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it("matches the live lighten/darken/setL/rotateHue exactly (build↔runtime parity, §20.8)", async () => {
      // Transpile the SINGLE source to standalone ESM (type-strip) — what the build layer will do.
      const js = ts.transpileModule(sourceText, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
      }).outputText;
      expect(js).not.toMatch(/^\s*import\s/m); // still self-contained after transpile

      const file = join(dir, "color-math.mjs");
      writeFileSync(file, js, "utf8");
      const vendored = (await import(pathToFileURL(file).href)) as {
        lighten: (hex: string, delta: number) => string;
        darken: (hex: string, delta: number) => string;
        setL: (hex: string, L: number) => string;
        rotateHue: (hex: string, deg: number) => string;
        adjust: (hex: string, dials: { l?: number; c?: number; h?: number }) => string;
      };

      // The OKLCH path adds float transcendentals + a gamut search; parity must be EXACT because a
      // consumer computing a value live must match refract's baked CSS variable. Grid over a range
      // of bases (near-neutral, saturated, extremes) × args (incl. clamp-hitting 0/100).
      const hexes = ["#4dabf7", "#fff", "#000", "#123456", "#abc", "#e03131", "#2f9e44", "#f08c00"];
      const deltas = [0, 5, 12, 20, 37, 50, 80, 95, 100];
      for (const hex of hexes) {
        for (const delta of deltas) {
          expect(vendored.lighten(hex, delta)).toBe(liveLighten(hex, delta));
          expect(vendored.darken(hex, delta)).toBe(liveDarken(hex, delta));
          expect(vendored.setL(hex, delta)).toBe(liveSetL(hex, delta));
        }
      }
      for (const hex of hexes) {
        for (const deg of [0, 30, 90, 180, 270, 360, -45]) {
          expect(vendored.rotateHue(hex, deg)).toBe(liveRotateHue(hex, deg));
        }
      }
      const dialSets = [{ l: 40 }, { c: 0 }, { c: 0.5 }, { h: 40 }, { l: 55, c: 0.7, h: -20 }, {}];
      for (const hex of hexes) {
        for (const dials of dialSets) {
          expect(vendored.adjust(hex, dials)).toBe(liveAdjust(hex, dials));
        }
      }
    });
  });
});

describe("OKLCH synthesis golden snapshot (§20.8)", () => {
  it("bakes a stable absolute-L ladder + named-set for representative bases", () => {
    const labels = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
    const ladder = (base: string) =>
      Object.fromEntries(labels.map(l => [l, liveSetL(base, (1000 - l) / 10)]));
    // Named set at the shipped default ΔL (§20.3) — light/lighter and dark/darker each compound.
    const D = 10;
    const namedSet = (base: string) => ({
      light: liveLighten(base, D),
      lighter: liveLighten(liveLighten(base, D), D),
      dark: liveDarken(base, D),
      darker: liveDarken(liveDarken(base, D), D),
    });
    const bases = { blue: "#4dabf7", red: "#e03131", green: "#2f9e44", amber: "#f08c00" };
    const golden = Object.fromEntries(
      Object.entries(bases).map(([name, hex]) => [name, { ladder: ladder(hex), namedSet: namedSet(hex) }]),
    );
    expect(golden).toMatchSnapshot();
  });
});
