/**
 * `refract create` gate — the guided raw-theme scaffolder.
 *
 * Drives the generator (`scaffoldTheme`) and the writer (`runCreate`) directly: both are pure of the
 * prompting layer, so the whole feature is testable without a TTY. The properties that matter:
 *
 *  - a generated theme always COMPILES (it's worthless if it doesn't);
 *  - harmony members become their own palettes with their own ladders, never variants;
 *  - the contrast pass actually clears the bar it was given, and `none` leaves the seed alone;
 *  - the three file formats are equally faithful — same theme, byte-identical CSS;
 *  - generation is deterministic, and refuses to clobber authored work.
 */
import { describe, expect, it, afterAll } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  scaffoldTheme,
  runCreate,
  renderRawTheme,
  deriveLeading,
  deriveTracking,
  nearestLadderStep,
  schemesFor,
  defaultSchemeFor,
  FEEL_PRESETS,
  runInit,
  findRawTheme,
  type Feel,
} from "@theme-registry/refract/build";
import { createTheme, audit } from "@theme-registry/refract";
import { createCssAdapter } from "@theme-registry/refract-css";

const SEED = "#4c6ef5";
const tmpDirs: string[] = [];
const makeTmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "refract-create-"));
  tmpDirs.push(dir);
  return dir;
};
afterAll(() => tmpDirs.forEach(d => rmSync(d, { recursive: true, force: true })));

const compile = (raw: unknown) => createTheme(raw as never, { adapter: createCssAdapter() });
const varsOf = (css: string) => [...css.matchAll(/^\s*(--dt-[a-z0-9-]+):/gm)].map(m => m[1]);
const colorsOf = (raw: unknown) => (raw as { colors: Record<string, { base?: string; steps?: number[] }> }).colors;

describe("scaffoldTheme — output shape", () => {
  it("produces every subsystem and no recipes", () => {
    const { raw } = scaffoldTheme({ seed: SEED });
    expect(Object.keys(raw as object).sort()).toEqual(
      ["animation", "borders", "colors", "effects", "globals", "layout", "typography"].sort(),
    );
    // No recipes anywhere — a scaffolded theme is tokens, and `create` says so.
    expect(JSON.stringify(raw)).not.toContain('"recipes"');
  });

  it("compiles, and every emitted variable name is unique", () => {
    const css = compile(scaffoldTheme({ seed: SEED }).raw).css;
    const names = varsOf(css);
    expect(names.length).toBeGreaterThan(100);
    expect(new Set(names).size).toBe(names.length);
  });

  it("writes the type scale as a declaration, not a baked ladder", () => {
    const { raw } = scaffoldTheme({ seed: SEED, ratio: "major-third" });
    const typography = (raw as { typography: Record<string, unknown> }).typography;
    // The engine synthesizes xs…4xl from base + ratio — baking it would throw the intent away.
    expect(typography.fontSize).toEqual({ base: 16, ratio: "major-third" });
    // …but the compiled output still has the full ladder.
    const css = compile(raw).css;
    for (const step of ["xs", "sm", "lg", "xl", "2xl", "3xl", "4xl"]) {
      expect(css).toContain(`--dt-typography-fontsize-${step}:`);
    }
  });

  it("uses the linear spacing curve so every stop lands on the 4px grid", () => {
    const { raw } = scaffoldTheme({ seed: SEED, feel: "neutral" });
    const spacing = (raw as { layout: { spacing: Record<string, unknown> } }).layout.spacing;
    expect(spacing.step).toBe(4);
    expect(spacing).not.toHaveProperty("ratio");
    const css = compile(raw).css;
    for (const m of css.matchAll(/--dt-layout-spacing[a-z0-9-]*:\s*([\d.]+)px/g)) {
      expect(Number(m[1]) % 4).toBe(0);
    }
  });

  it("emits no keyframes — nothing would reference one without recipes", () => {
    const css = compile(scaffoldTheme({ seed: SEED }).raw).css;
    expect(css).not.toContain("@keyframes");
    expect(css).toContain("--dt-animation-duration:");
  });
});

describe("scaffoldTheme — brand colours are palettes, not variants", () => {
  it.each([1, 2, 3, 4, 5])("count %i yields that many brand palettes, each with a ladder", n => {
    const { raw, report } = scaffoldTheme({ seed: SEED, brandCount: n });
    expect(report.brand).toHaveLength(n);
    const colors = colorsOf(raw);
    for (const b of report.brand) {
      expect(colors[b.name]).toBeDefined();
      expect(colors[b.name].steps).toEqual([50, 100, 200, 300, 400, 500, 600, 700, 800, 900]);
    }
    // The companion is a sibling family, never `primary-complement`.
    const css = compile(raw).css;
    expect(css).not.toMatch(/--dt-colors-primary-(complement|triadic|analogous|split|tetradic|pentadic)/);
    if (n > 1) expect(css).toContain("--dt-colors-secondary-500:");
  });

  it("rotates hue only — the primary keeps the seed the user typed", () => {
    const { raw, report } = scaffoldTheme({ seed: SEED, brandCount: 3, contrast: "none" });
    expect(colorsOf(raw).primary.base).toBe(SEED);
    expect(report.brand.map(b => b.rotation)).toEqual([0, 120, 240]);
  });

  it("offers only schemes whose member count matches, and defaults sensibly", () => {
    expect(schemesFor(2)).toEqual(["complement"]);
    expect(schemesFor(3)).toEqual(expect.arrayContaining(["analogous", "split-complement", "triadic"]));
    expect(schemesFor(4)).toEqual(["tetradic"]);
    expect(schemesFor(5)).toEqual(["pentadic"]);
    expect(defaultSchemeFor(2)).toBe("complement");
    expect(defaultSchemeFor(5)).toBe("pentadic");
  });

  it("takes manual colours verbatim", () => {
    const { raw, report } = scaffoldTheme({
      seed: SEED, mode: "manual", extraColors: ["#e64980", "#2f9e44"], contrast: "none",
    });
    expect(report.brand.map(b => b.hex)).toEqual([SEED, "#e64980", "#2f9e44"]);
    expect(colorsOf(raw).tertiary.base).toBe("#2f9e44");
  });
});

describe("scaffoldTheme — the contrast gate", () => {
  it("clears WCAG AA for every text pairing it adjusts", () => {
    const { raw, report } = scaffoldTheme({ seed: SEED, contrast: "AA" });
    expect(report.contrast.length).toBeGreaterThan(0);
    expect(report.contrast.filter(c => c.unresolved)).toEqual([]);
    // Re-audit the real theme rather than trusting the report.
    const result = audit(compile(raw), { minWcag: "AA", includeRecipes: false });
    const scored = result.pairings.filter(p => !p.skipped);
    expect(scored.length).toBeGreaterThan(0);
    expect(scored.filter(p => !p.pass)).toEqual([]);
  });

  it("catches the case a hand-rolled palette gets wrong — white on a mid green", () => {
    const { report } = scaffoldTheme({ seed: SEED, contrast: "AA" });
    const success = report.contrast.find(c => c.name === "success")!;
    expect(success.ratioBefore).toBeLessThan(4.5); // the naive anchor fails
    expect(success.ratioAfter).toBeGreaterThanOrEqual(4.5);
    expect(success.nudge).toBeGreaterThan(0);
  });

  it("AAA nudges at least as hard as AA", () => {
    const aa = scaffoldTheme({ seed: SEED, contrast: "AA" }).report.contrast;
    const aaa = scaffoldTheme({ seed: SEED, contrast: "AAA" }).report.contrast;
    for (const a of aa) {
      const b = aaa.find(x => x.name === a.name)!;
      expect(b.nudge).toBeGreaterThanOrEqual(a.nudge);
    }
  });

  it("`none` writes the colours exactly as given", () => {
    const { raw, report } = scaffoldTheme({ seed: SEED, contrast: "none" });
    expect(report.contrast).toEqual([]);
    expect(colorsOf(raw).primary.base).toBe(SEED);
    expect(colorsOf(raw).success.base).toBe("#2f9e44");
  });
});

describe("scaffoldTheme — derived typography", () => {
  it("leading falls and tracking crosses zero as size grows", () => {
    const { report } = scaffoldTheme({ seed: SEED, ratio: "major-third", baseFontSize: 16 });
    const byStep = Object.fromEntries(report.type.map(t => [t.step, t]));
    expect(byStep["4xl"].leading).toBeLessThan(byStep.md.leading);
    expect(byStep.md.leading).toBeLessThan(byStep.xs.leading);
    expect(Number.parseFloat(byStep["4xl"].tracking)).toBeLessThan(0);
    expect(Number.parseFloat(byStep.xs.tracking)).toBeGreaterThan(0);
    expect(byStep.md.tracking).toBe("0em"); // anchored at the base size
  });

  it("a more dramatic ratio produces tighter display leading", () => {
    const tight = scaffoldTheme({ seed: SEED, ratio: "major-second" }).report.type.at(-1)!;
    const loud = scaffoldTheme({ seed: SEED, ratio: "perfect-fourth" }).report.type.at(-1)!;
    expect(loud.px).toBeGreaterThan(tight.px);
    expect(loud.leading).toBeLessThan(tight.leading);
  });

  it("names the derived variants after the size step they were tuned for", () => {
    const css = compile(scaffoldTheme({ seed: SEED }).raw).css;
    // The pairing has to document itself — there are no recipes to bind them.
    for (const step of ["xs", "sm", "lg", "xl", "2xl", "3xl", "4xl"]) {
      expect(css).toContain(`--dt-typography-lineheight-${step}:`);
      expect(css).toContain(`--dt-typography-letterspacing-${step}:`);
    }
    expect(css).not.toContain("--dt-typography-lineheight-tight:");
  });

  it("clamps leading at both ends", () => {
    expect(deriveLeading(400)).toBeGreaterThanOrEqual(1.1);
    expect(deriveLeading(1)).toBeLessThanOrEqual(1.7);
    expect(deriveTracking(16)).toBe("0em");
  });
});

describe("scaffoldTheme — feels and the ladder report", () => {
  it.each(Object.keys(FEEL_PRESETS) as Feel[])("%s compiles and stays on the grid", feel => {
    const { raw, report } = scaffoldTheme({ seed: "#e64980", feel });
    expect(() => compile(raw)).not.toThrow();
    for (const s of report.spacing) expect(s.px % 4).toBe(0);
  });

  it("reports where the seed lands without moving it", () => {
    const { report } = scaffoldTheme({ seed: SEED, contrast: "none" });
    expect(report.seedLightness).toBeGreaterThan(0);
    expect(report.seedLightness).toBeLessThan(100);
    expect([50, 100, 200, 300, 400, 500, 600, 700, 800, 900]).toContain(report.nearestStep);
    expect(nearestLadderStep(59.1)).toBe(400);
    expect(nearestLadderStep(5)).toBe(900);
  });

  it("is deterministic — same answers, same theme", () => {
    const a = scaffoldTheme({ seed: SEED, brandCount: 3, feel: "editorial" });
    const b = scaffoldTheme({ seed: SEED, brandCount: 3, feel: "editorial" });
    expect(JSON.stringify(a.raw)).toBe(JSON.stringify(b.raw));
  });
});

describe("runCreate — the written file", () => {
  it("writes a .ts that carries the type and the same theme", () => {
    const dir = makeTmp();
    const result = runCreate({ seed: SEED, cwd: dir, packageName: "@theme-registry/refract" });
    const source = readFileSync(result.path, "utf8");
    expect(result.path.endsWith("theme.raw.ts")).toBe(true);
    expect(source).toContain('import type { RawTheme } from "@theme-registry/refract/build";');
    expect(source).toContain("satisfies RawTheme");
    expect(source).toContain("Generated by `refract create`");
  });

  it("the .js flavour attaches the type without a compile step", () => {
    const dir = makeTmp();
    const result = runCreate({ seed: SEED, cwd: dir, format: "js", packageName: "@theme-registry/refract" });
    const source = readFileSync(result.path, "utf8");
    expect(result.path.endsWith("theme.raw.js")).toBe(true);
    expect(source).toContain('@type {import("@theme-registry/refract/build").RawTheme}');
    expect(source).not.toContain("satisfies");
  });

  it("the .json flavour is pure data and compiles byte-identically to the .ts one", () => {
    const dir = makeTmp();
    const ts = runCreate({ seed: SEED, cwd: dir, format: "ts", packageName: "@theme-registry/refract" });
    const json = runCreate({ seed: SEED, cwd: dir, format: "json", packageName: "@theme-registry/refract" });
    const parsed = JSON.parse(readFileSync(json.path, "utf8"));
    // No comments, no imports — JSON loses nothing here because there are no functions or recipes.
    expect(readFileSync(json.path, "utf8").trimStart().startsWith("{")).toBe(true);
    expect(compile(parsed).css).toBe(compile(ts.raw).css);
  });

  it("refuses to clobber an existing file unless forced", () => {
    const dir = makeTmp();
    runCreate({ seed: SEED, cwd: dir, packageName: "@theme-registry/refract" });
    expect(() => runCreate({ seed: SEED, cwd: dir, packageName: "@theme-registry/refract" })).toThrow(/already exists/);
    expect(() =>
      runCreate({ seed: "#e64980", cwd: dir, force: true, packageName: "@theme-registry/refract" }),
    ).not.toThrow();
  });

  it("honours --out", () => {
    const dir = makeTmp();
    const result = runCreate({ seed: SEED, cwd: dir, out: "brand.raw.ts", packageName: "@theme-registry/refract" });
    expect(result.path.endsWith("brand.raw.ts")).toBe(true);
  });

  it("wires the config to a generated theme instead of inventing a second one", () => {
    const dir = makeTmp();
    runCreate({ seed: SEED, cwd: dir, packageName: "@theme-registry/refract" });
    const init = runInit({ cwd: dir, packageName: "@theme-registry/refract" });
    const config = readFileSync(init.path, "utf8");

    expect(init.rawTheme?.filename).toBe("theme.raw.ts");
    expect(config).toContain('import { raw } from "./theme.raw";');
    expect(config).toContain("raw: raw,");
    // The whole point: no starter palette smuggled in beside the real one.
    expect(config).not.toContain("#1864ab");
    expect(config).not.toMatch(/primary: \{ base:/);
  });

  it("keeps its self-contained starter when there's no theme to find", () => {
    const dir = makeTmp();
    const init = runInit({ cwd: dir, packageName: "@theme-registry/refract" });
    const config = readFileSync(init.path, "utf8");
    expect(init.rawTheme).toBeUndefined();
    expect(config).toContain("#1864ab"); // unchanged behaviour for an empty project
    expect(config).not.toContain("theme.raw");
  });

  it.each(["ts", "js", "json"] as const)("reaches a .%s theme with a working specifier", format => {
    const dir = makeTmp();
    runCreate({ seed: SEED, cwd: dir, format, packageName: "@theme-registry/refract" });
    const init = runInit({ cwd: dir, packageName: "@theme-registry/refract" });
    const config = readFileSync(init.path, "utf8");
    expect(init.rawTheme?.ext).toBe(`.${format}`);
    if (format === "json") {
      // Read, not imported — no module-attribute version floor on the scaffolded config.
      expect(config).toContain("readFileSync");
      expect(config).toContain("theme.raw.json");
    } else {
      // `.ts` is graph-compiled so it goes extensionless; `.js` is imported by Node so it keeps it.
      expect(config).toContain(format === "ts" ? '"./theme.raw"' : '"./theme.raw.js"');
    }
  });

  it("prefers .ts when several raw themes are present", () => {
    const dir = makeTmp();
    runCreate({ seed: SEED, cwd: dir, format: "json", packageName: "@theme-registry/refract" });
    runCreate({ seed: SEED, cwd: dir, format: "ts", packageName: "@theme-registry/refract" });
    expect(findRawTheme(dir)?.ext).toBe(".ts");
  });

  it("renderRawTheme round-trips through JSON.parse for the json format", () => {
    const { raw } = scaffoldTheme({ seed: SEED });
    const text = renderRawTheme(raw, {
      format: "json", packageName: "@theme-registry/refract", seed: SEED, detail: "test",
    });
    expect(() => JSON.parse(text)).not.toThrow();
    expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(raw)));
  });
});
