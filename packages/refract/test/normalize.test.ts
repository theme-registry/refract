import { describe, it, expect } from "vitest";
import {
  normalizePropertyValue,
  normalizeResponsiveOverrides,
  validateNormalizedResponsiveRefs,
  normalizeRecipeGroup,
} from "../src/core/normalize";
import type {
  NormalizedPropertyValue,
  PalettePropertyExtras,
} from "../src/core";
import {
  finalizePaletteNormalization,
} from "../src/subsystems/colors/normalize";
import { lighten, darken, setL } from "../src/subsystems/colors/utils";
import type { NormalizedPaletteValue } from "../src/subsystems/colors/types";
import { finalizeLayoutNormalization } from "../src/subsystems/layout/normalize";
import { finalizeTypographyNormalization } from "../src/subsystems/typography/normalize";
import type { FontSizeExtras } from "../src/subsystems/typography/types";

// ── Shared property normalization ──────────────────────────────────────────

describe("normalizePropertyValue", () => {
  it("wraps a bare value into { base, responsive: [], variants: undefined }", () => {
    expect(normalizePropertyValue<string>("#fff")).toEqual({
      base: "#fff",
      responsive: [],
      variants: undefined,
    });
  });

  it("normalizes variants (short form + extended form) and preserves extras", () => {
    const result = normalizePropertyValue<string, { text?: string }>({
      base: "#111",
      text: "#eee",
      variants: {
        muted: "#999",
        loud: { base: "#000", text: "#fff" },
      },
    });

    expect(result.base).toBe("#111");
    expect(result.text).toBe("#eee");
    expect(result.variants).toEqual({
      muted: { base: "#999" },
      loud: { base: "#000", text: "#fff" },
    });
  });

  it("defaults a responsive entry's query to \"exact\"", () => {
    const result = normalizePropertyValue<string>({
      base: "#111",
      responsive: [{ breakpoint: "md", base: "#222" }],
    });
    expect(result.responsive).toEqual([{ breakpoint: "md", base: "#222", query: "exact" }]);
  });

  it("uses fallbackBase when no base is authored", () => {
    const result = normalizePropertyValue<number>({} as never, { fallbackBase: 4 });
    expect(result.base).toBe(4);
  });

  it("throws when no base is resolvable", () => {
    expect(() => normalizePropertyValue<number>({} as never, { propertyPath: "layout.spacing" }))
      .toThrow(/Unable to resolve base value for "layout.spacing"/);
  });

  it("throws on an unknown breakpoint reference", () => {
    expect(() =>
      normalizePropertyValue<string>(
        { base: "#111", responsive: [{ breakpoint: "xxl", base: "#222" }] },
        { allowedBreakpoints: ["sm", "md"], propertyPath: "colors.brand" },
      ),
    ).toThrow(/references unknown breakpoint "xxl"/);
  });

  it("throws on a responsive entry missing a breakpoint", () => {
    expect(() =>
      normalizePropertyValue<string>({
        base: "#111",
        responsive: [{ base: "#222" } as never],
      }),
    ).toThrow(/missing a "breakpoint" value/);
  });
});

describe("normalizeResponsiveOverrides ref validation", () => {
  it("throws on an unknown variant reference", () => {
    expect(() =>
      normalizeResponsiveOverrides(
        [{ breakpoint: "md", ref: "ghost" }],
        { allowedBreakpoints: ["md"], allowedVariants: ["solid"], propertyPath: "colors.brand" },
      ),
    ).toThrow(/references unknown variant "ghost"/);
  });

  it("throws on an unknown target reference", () => {
    expect(() =>
      normalizeResponsiveOverrides(
        [{ breakpoint: "md", target: "ghost" }],
        { allowedBreakpoints: ["md"], allowedTargets: ["solid"] },
      ),
    ).toThrow(/references unknown target "ghost"/);
  });
});

describe("validateNormalizedResponsiveRefs", () => {
  const withVariants = (
    responsive: NormalizedPropertyValue<string>["responsive"],
  ): NormalizedPropertyValue<string> => ({
    base: "#111",
    responsive,
    variants: { solid: { base: "#222" } },
  });

  it("throws when a responsive entry names a variant with no matching definition", () => {
    expect(() =>
      validateNormalizedResponsiveRefs(withVariants([{ breakpoint: "md", query: "exact", ref: "ghost" }]), {
        propertyPath: "colors.brand",
      }),
    ).toThrow(/references unknown variant "ghost"/);
  });

  it("passes when the referenced variant exists", () => {
    expect(() =>
      validateNormalizedResponsiveRefs(withVariants([{ breakpoint: "md", query: "exact", ref: "solid" }])),
    ).not.toThrow();
  });
});

// ── Recipe normalization ────────────────────────────────────────────────────

describe("normalizeRecipeGroup", () => {
  it("flattens states + responsive into one overrides list (states first)", () => {
    const group = normalizeRecipeGroup(
      {
        primary: {
          color: "#fff",
          states: { hover: { color: "#eee" } },
          responsive: [{ breakpoint: "md", color: "#ddd" }],
        },
      },
      { allowedBreakpoints: ["md"], allowedStates: ["hover"] },
    );

    expect(group.primary.base).toEqual({ color: "#fff" });
    expect(group.primary.responsive).toEqual([
      { color: "#eee", state: "hover" },
      { breakpoint: "md", color: "#ddd", query: "exact" },
    ]);
  });

  it("throws on an unknown state", () => {
    expect(() =>
      normalizeRecipeGroup(
        { primary: { states: { wiggle: {} } } },
        { allowedStates: ["hover"] },
      ),
    ).toThrow(/references unknown state "wiggle"/);
  });

  it("throws on an unknown breakpoint in a responsive recipe entry", () => {
    expect(() =>
      normalizeRecipeGroup(
        { primary: { responsive: [{ breakpoint: "xxl" }] } },
        { allowedBreakpoints: ["md"] },
      ),
    ).toThrow(/references unknown breakpoint "xxl"/);
  });

  it("throws on a responsive recipe entry missing a breakpoint", () => {
    expect(() =>
      normalizeRecipeGroup({ primary: { responsive: [{} as never] } }),
    ).toThrow(/missing a "breakpoint" value/);
  });
});

// ── Subsystem normalize hooks ───────────────────────────────────────────────

describe("finalizePaletteNormalization", () => {
  it("synthesizes default named steps with chained derivation metadata", () => {
    const base = "#336699";
    const normalized = normalizePropertyValue<string, PalettePropertyExtras>({ base });
    const result = finalizePaletteNormalization("brand", normalized as NormalizedPaletteValue);

    expect(Object.keys(result.variants!)).toEqual(["light", "lighter", "dark", "darker"]);

    expect(result.variants!.light).toEqual({
      base: lighten(base, 10),
      derive: { ref: "colors.brand", fn: "lighten", arg: 10 },
    });
    expect(result.variants!.lighter).toEqual({
      base: lighten(lighten(base, 10), 10),
      derive: { ref: "colors.brand.light", fn: "lighten", arg: 10 },
    });
    expect(result.variants!.dark).toEqual({
      base: darken(base, 10),
      derive: { ref: "colors.brand", fn: "darken", arg: 10 },
    });
    expect(result.variants!.darker).toEqual({
      base: darken(darken(base, 10), 10),
      derive: { ref: "colors.brand.dark", fn: "darken", arg: 10 },
    });
  });

  it("bakes numeric steps as an absolute-L ladder of setL refs (no base-step alias)", () => {
    const base = "#336699";
    const normalized = normalizePropertyValue<string, PalettePropertyExtras>({
      base,
      steps: [100, 500, 900],
    });
    const result = finalizePaletteNormalization("brand", normalized as NormalizedPaletteValue);

    // Every rung is `{ ref: base, fn: "setL", arg: L }` with L = (1000 − label) / 10 — no rung is
    // aliased to the base (the exact colour is the unnumbered token).
    expect(Object.keys(result.variants!).sort()).toEqual(["100", "500", "900"]);
    expect(result.variants!["100"]).toEqual({
      base: setL(base, 90),
      derive: { ref: "colors.brand", fn: "setL", arg: 90 },
    });
    expect(result.variants!["500"]).toEqual({
      base: setL(base, 50),
      derive: { ref: "colors.brand", fn: "setL", arg: 50 },
    });
    expect(result.variants!["900"]).toEqual({
      base: setL(base, 10),
      derive: { ref: "colors.brand", fn: "setL", arg: 10 },
    });
  });
});

describe("finalizeLayoutNormalization", () => {
  it("forces a none variant on spacing / gutters", () => {
    const spacing = finalizeLayoutNormalization("spacing", normalizePropertyValue<number>({ base: 8 }));
    expect(spacing.variants).toMatchObject({ none: { base: 0 } });
  });

  it("leaves other layout properties untouched", () => {
    const normalized = normalizePropertyValue<number>({ base: 8 });
    expect(finalizeLayoutNormalization("radius", normalized)).toBe(normalized);
  });
});

describe("finalizeTypographyNormalization", () => {
  it("generates the modular scale from a ratio", () => {
    const normalized = normalizePropertyValue<number, FontSizeExtras>({ base: 16, ratio: "major-third" });
    const result = finalizeTypographyNormalization(
      "fontSize",
      normalized as unknown as NormalizedPropertyValue<unknown>,
    );
    const variants = (result as unknown as NormalizedPropertyValue<number, FontSizeExtras>).variants!;

    expect(variants.md.base).toBe(16); // step 0 → base * ratio^0
    expect(variants.lg.base).toBe(20); // step 1 → 16 * 1.25
    expect(variants.xl.base).toBe(25); // step 2 → 16 * 1.25^2
  });

  it("leaves non-fontSize properties untouched", () => {
    const normalized = normalizePropertyValue<number>({ base: 400 }) as unknown as NormalizedPropertyValue<unknown>;
    expect(finalizeTypographyNormalization("fontWeight", normalized)).toBe(normalized);
  });

  it("returns fontSize unchanged when no ratio is configured", () => {
    const normalized = normalizePropertyValue<number, FontSizeExtras>({ base: 16 }) as unknown as NormalizedPropertyValue<unknown>;
    expect(finalizeTypographyNormalization("fontSize", normalized)).toBe(normalized);
  });
});
