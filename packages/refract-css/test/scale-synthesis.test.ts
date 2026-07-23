/**
 * §10.6 — numeric scale synthesis for layout (`spacing` / `gutters` / `sizes`).
 *
 * The layout `normalizeProperty` hook generates a variant ramp from a base + a curve — geometric
 * (`base × ratio^n`) or linear (`step × n`) — storing each step as a **derived** Ref
 * (`{ ref, fn:"scaleStep", arg, value }`, mirror colors, NOT typography's frozen literals) so
 * `override()` of the base re-synthesizes the ramp. A ramp entry inside `responsive` regenerates the
 * whole named scale at that breakpoint, expanding into per-step `target` overrides (the existing
 * responsive channel — no new Model member). Coverage:
 *   - both curves (geometric + linear) synthesize derived-ref steps end-to-end (tokens + css);
 *   - `ratio:1` flattens every step to the base at a breakpoint;
 *   - `override()` re-derives the ramp (re-synthesis, not a stale literal);
 *   - a responsive ramp expands into `target` overrides that carry a derived `base`;
 *   - sizes' semantic caps + pinned `%` coexist with the synthesized ramp;
 *   - no curve config → plain literal variants (the additive, byte-identical path).
 */
import { describe, it, expect } from "vitest";
import { createTheme } from "@theme-registry/refract";
import { createCssAdapter } from "../src";
import type { Theme } from "@theme-registry/refract";

type CssTheme = Theme & { css: string; variablesCss: string };

const build = (layout: Record<string, unknown>, breakpoints?: Record<string, number>): CssTheme =>
  createTheme(
    { ...(breakpoints ? { breakpoints } : {}), layout } as never,
    { adapter: createCssAdapter({ prefix: "app" }) },
  ) as unknown as CssTheme;

describe("§10.6 base synthesis — geometric (ratio)", () => {
  const theme = build({
    spacing: { base: 8, ratio: 1.5, steps: ["xs", "sm", "md", "lg", "xl"] },
  });

  it("synthesizes each step as a derived Ref (base × ratio^index), unit-tagged", () => {
    // index = exponent: xs @0 = base, md @2 = 8 × 1.5² = 18.
    expect(theme.tokens["layout.spacing.xs"]).toEqual({
      ref: "layout.spacing",
      fn: "scaleStep",
      arg: { curve: "geometric", ratio: 1.5, exp: 0 },
      value: 8,
      unit: "px",
    });
    expect(theme.tokens["layout.spacing.md"]).toEqual({
      ref: "layout.spacing",
      fn: "scaleStep",
      arg: { curve: "geometric", ratio: 1.5, exp: 2 },
      value: 18,
      unit: "px",
    });
    // 8 × 1.5⁴ = 40.5 — kept, not rounded to an integer.
    expect(theme.tokens["layout.spacing.xl"]).toMatchObject({ value: 40.5, unit: "px" });
  });

  it("resolveToken re-derives through the registry (proves the step is derived, not frozen)", () => {
    expect(theme.resolveToken("layout.spacing.md")).toBe(18);
    expect(theme.resolveToken("layout.spacing.xl")).toBe(40.5);
  });

  it("emits the ramp + the forced none as :root vars", () => {
    expect(theme.variablesCss).toContain("--app-layout-spacing-xs: 8px;");
    expect(theme.variablesCss).toContain("--app-layout-spacing-md: 18px;");
    expect(theme.variablesCss).toContain("--app-layout-spacing-xl: 40.5px;");
    expect(theme.variablesCss).toContain("--app-layout-spacing-none: 0");
  });

  it("does not leak the curve-config keys as tokens/vars", () => {
    expect(theme.tokens["layout.spacing.ratio"]).toBeUndefined();
    expect(theme.tokens["layout.spacing.step"]).toBeUndefined();
    expect(theme.tokens["layout.spacing.steps"]).toBeUndefined();
    expect(theme.variablesCss).not.toContain("spacing-ratio");
    expect(theme.variablesCss).not.toContain("spacing-steps");
  });
});

describe("§10.6 base synthesis — linear (step)", () => {
  const theme = build({
    spacing: { base: 4, step: 4, steps: { xs: 1, sm: 2, md: 3, lg: 4, xl: 6 } },
  });

  it("synthesizes step × multiplier, stored as a derived Ref", () => {
    expect(theme.tokens["layout.spacing.md"]).toEqual({
      ref: "layout.spacing",
      fn: "scaleStep",
      arg: { curve: "linear", step: 4, mult: 3 },
      value: 12,
      unit: "px",
    });
    expect(theme.tokens["layout.spacing.xl"]).toMatchObject({ value: 24, unit: "px" });
  });

  it("resolveToken re-derives the grid step", () => {
    expect(theme.resolveToken("layout.spacing.md")).toBe(12);
    expect(theme.resolveToken("layout.spacing.xl")).toBe(24);
  });

  it("emits the grid ramp as :root vars", () => {
    expect(theme.variablesCss).toContain("--app-layout-spacing-md: 12px;");
    expect(theme.variablesCss).toContain("--app-layout-spacing-xl: 24px;");
  });
});

describe("§10.6 gutters use the same hook", () => {
  it("synthesizes gutters + keeps the forced none", () => {
    const theme = build({ gutters: { base: 8, ratio: 2, steps: ["sm", "md", "lg"] } });
    expect(theme.tokens["layout.gutters.sm"]).toMatchObject({ value: 8, unit: "px" });
    expect(theme.tokens["layout.gutters.md"]).toMatchObject({ value: 16, unit: "px" });
    expect(theme.tokens["layout.gutters.lg"]).toMatchObject({ value: 32, unit: "px" });
    expect(theme.variablesCss).toContain("--app-layout-gutters-none: 0");
  });
});

describe("§10.6 authored variants win over synthesized steps", () => {
  it("a hand-authored variant overrides the generated rung of the same name", () => {
    const theme = build({
      spacing: { base: 8, ratio: 1.5, steps: ["xs", "sm", "md"], variants: { md: 100 } },
    });
    // md authored → plain literal (no derive); xs/sm still synthesized.
    expect(theme.tokens["layout.spacing.md"]).toEqual({ value: 100, unit: "px" });
    expect(theme.tokens["layout.spacing.sm"]).toMatchObject({ fn: "scaleStep", value: 12 });
  });
});

describe("§10.6 D6 responsive ramp — flatten with ratio:1", () => {
  const theme = build(
    {
      spacing: {
        base: 8,
        ratio: 1.5,
        steps: ["xs", "sm", "md"],
        responsive: [{ breakpoint: "sm", query: "max", ratio: 1 }],
      },
    },
    { sm: 576, md: 768 },
  );

  it("expands into one target override per step, each = base at ≤sm", () => {
    const responsive = theme.model.subsystems.layout!.properties!.spacing.responsive!;
    // Three expanded entries (xs / sm / md), all at breakpoint sm, query max.
    expect(responsive).toHaveLength(3);
    for (const entry of responsive) {
      expect(entry.breakpoint).toBe("sm");
      expect(entry.query).toBe("max");
      // Every step flattens to the base (8) — base × 1^exp.
      expect(entry.overrides!.base).toMatchObject({ value: 8, unit: "px" });
    }
    expect(responsive.map(r => r.target)).toEqual(["xs", "sm", "md"]);
  });

  it("the flattened override carries a derived Ref that derives from the own base token", () => {
    const md = theme.model.subsystems.layout!.properties!.spacing.responsive!.find(r => r.target === "md")!;
    expect(md.overrides!.base).toEqual({
      ref: "layout.spacing",
      fn: "scaleStep",
      arg: { curve: "geometric", ratio: 1, exp: 2 },
      value: 8,
      unit: "px",
    });
  });

  it("emits a max-width media block flattening every step to the base", () => {
    expect(theme.variablesCss).toMatch(/@media[^{]*max-width[^{]*\{\s*:root\s*\{[^}]*--app-layout-spacing-md:\s*8px/);
  });
});

describe("§10.6 D6 responsive ramp — a fuller ramp above the breakpoint", () => {
  const theme = build(
    {
      spacing: {
        base: 4,
        step: 4,
        steps: { xs: 1, sm: 2, md: 3 },
        responsive: [{ breakpoint: "lg", base: 6, step: 6 }],
      },
    },
    { sm: 576, md: 768, lg: 1024 },
  );

  it("regenerates the whole named scale at the breakpoint (6·12·18)", () => {
    const byTarget = Object.fromEntries(
      theme.model.subsystems.layout!.properties!.spacing.responsive!.map(r => [r.target, r.overrides!.base]),
    );
    expect(byTarget.xs).toMatchObject({ value: 6, unit: "px" });
    expect(byTarget.sm).toMatchObject({ value: 12, unit: "px" });
    expect(byTarget.md).toMatchObject({ value: 18, unit: "px", fn: "scaleStep" });
    expect(byTarget.md).toMatchObject({ arg: { curve: "linear", step: 6, mult: 3 } });
  });

  it("emits the ramp values inside the lg media block", () => {
    expect(theme.variablesCss).toMatch(/@media[^{]*min-width:\s*1024px[^{]*\{\s*:root\s*\{[^}]*--app-layout-spacing-md:\s*18px/);
  });

  it("a plain (non-ramp) responsive override still passes through untouched", () => {
    const plain = build(
      { spacing: { base: 16, variants: { relaxed: 32 }, responsive: [{ breakpoint: "lg", target: "relaxed", base: 40 }] } },
      { lg: 1024 },
    );
    const responsive = plain.model.subsystems.layout!.properties!.spacing.responsive!;
    expect(responsive).toHaveLength(1);
    expect(responsive[0]).toMatchObject({ breakpoint: "lg", target: "relaxed" });
    // Not a derived ramp step — a plain literal override.
    expect(responsive[0].overrides!.base).toEqual({ value: 40, unit: "px" });
  });
});

describe("§10.6 override() re-derives the ramp", () => {
  const parent = build({ spacing: { base: 8, ratio: 1.5, steps: ["xs", "sm", "md"] } });

  it("re-synthesizes every step from the new base; parent stays on the old base", () => {
    const child = parent.override({
      layout: { spacing: { base: 16, ratio: 1.5, steps: ["xs", "sm", "md"] } },
    }) as CssTheme;

    // md = 16 × 1.5² = 36 on the child; 18 on the parent.
    expect(child.resolveToken("layout.spacing.md")).toBe(36);
    expect(child.tokens["layout.spacing.md"]).toEqual({
      ref: "layout.spacing",
      fn: "scaleStep",
      arg: { curve: "geometric", ratio: 1.5, exp: 2 },
      value: 36,
      unit: "px",
    });
    expect(parent.resolveToken("layout.spacing.md")).toBe(18);
    expect(child.variablesCss).toContain("--app-layout-spacing-md: 36px;");
  });
});

describe("§10.6 D5 — sizes ramp + semantic/pinned coexistence", () => {
  const theme = build({
    sizes: {
      base: 320,
      ratio: 1.5,
      steps: ["sm", "md", "lg", "xl"],
      variants: { prose: 640, wide: 1200, full: "100%" },
    },
  });

  it("synthesizes the t-shirt ramp as derived Refs (320·480·720·1080)", () => {
    expect(theme.tokens["layout.sizes.sm"]).toMatchObject({ value: 320, unit: "px", fn: "scaleStep" });
    expect(theme.tokens["layout.sizes.md"]).toMatchObject({ value: 480, unit: "px" });
    expect(theme.tokens["layout.sizes.lg"]).toMatchObject({ value: 720, unit: "px" });
    expect(theme.tokens["layout.sizes.xl"]).toMatchObject({ value: 1080, unit: "px" });
  });

  it("hand-authored semantic caps stay literal; a pinned % is never synthesized", () => {
    expect(theme.tokens["layout.sizes.prose"]).toEqual({ value: 640, unit: "px" });
    expect(theme.tokens["layout.sizes.wide"]).toEqual({ value: 1200, unit: "px" });
    // A percentage has no magnitude to multiply → it can only be an authored variant.
    expect(theme.tokens["layout.sizes.full"]).toEqual({ value: 100, unit: "%" });
  });

  it("does not force a none variant onto sizes", () => {
    expect(theme.tokens["layout.sizes.none"]).toBeUndefined();
  });
});

describe("§10.6 additive — no curve config keeps plain literal variants", () => {
  it("a hand-listed scale synthesizes nothing (byte-identical path)", () => {
    const theme = build({ spacing: { base: 16, variants: { compact: 8, relaxed: 32 } } });
    // No ref/fn/arg — a plain literal, exactly as before the feature.
    expect(theme.tokens["layout.spacing.compact"]).toEqual({ value: 8, unit: "px" });
    expect(theme.tokens["layout.spacing.relaxed"]).toEqual({ value: 32, unit: "px" });
    // The forced none is still there.
    expect(theme.tokens["layout.spacing.none"]).toEqual({ value: 0, unit: "px" });
  });
});
