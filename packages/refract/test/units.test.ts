/**
 * §21 — the core units module (parse / role resolution / Model pass), tested in isolation from any
 * adapter. Golden CSS behavior is covered by `length-units.test.ts`; this pins the format-neutral core.
 */
import { describe, it, expect } from "vitest";
import {
  parseLength,
  resolveRoleUnit,
  resolveLengthRef,
  resolveModelUnits,
} from "../src/core/units";
import type { ThemeModel } from "../src/core/model";

describe("§21 parseLength", () => {
  it("a number is deferred (no unit)", () => {
    expect(parseLength(16)).toEqual({ value: 16 });
    expect(parseLength(-0.5)).toEqual({ value: -0.5 });
  });

  it("a bare numeric string is deferred", () => {
    expect(parseLength("16")).toEqual({ value: 16 });
    expect(parseLength(" 24 ")).toEqual({ value: 24 });
  });

  it("a <number><unit> string is pinned", () => {
    expect(parseLength("1.5rem")).toEqual({ value: 1.5, unit: "rem" });
    expect(parseLength("-0.02em")).toEqual({ value: -0.02, unit: "em" });
    expect(parseLength("9999px")).toEqual({ value: 9999, unit: "px" });
    expect(parseLength("50%")).toEqual({ value: 50, unit: "%" });
    expect(parseLength("3ch")).toEqual({ value: 3, unit: "ch" });
    expect(parseLength("100dvh")).toEqual({ value: 100, unit: "dvh" });
  });

  it("functions and keywords are raw-string escapes", () => {
    expect(parseLength("calc(100% - 2rem)")).toEqual({ raw: "calc(100% - 2rem)" });
    expect(parseLength("clamp(1rem, 2vw, 3rem)")).toEqual({ raw: "clamp(1rem, 2vw, 3rem)" });
    expect(parseLength("var(--x)")).toEqual({ raw: "var(--x)" });
    expect(parseLength("none")).toEqual({ raw: "none" });
  });

  it("a <number><unknown-unit> is an authoring error", () => {
    expect(() => parseLength("16pxx")).toThrow(/Unknown length unit/);
    expect(() => parseLength("10foo")).toThrow(/Unknown length unit/);
  });
});

describe("§21 resolveRoleUnit — most-specific wins", () => {
  it("built-in seed: length subsystems px, lineHeight none, letterSpacing em", () => {
    expect(resolveRoleUnit("typography.fontSize", undefined)).toBe("px");
    expect(resolveRoleUnit("borders.width", undefined)).toBe("px");
    expect(resolveRoleUnit("typography.lineHeight", undefined)).toBe("none");
    expect(resolveRoleUnit("typography.letterSpacing", undefined)).toBe("em");
  });

  it("subsystem grain overrides the seed", () => {
    expect(resolveRoleUnit("typography.fontSize", { typography: "rem" })).toBe("rem");
    expect(resolveRoleUnit("borders.width", { typography: "rem" })).toBe("px"); // untouched subsystem
  });

  it("property grain beats subsystem grain", () => {
    const units = { typography: "rem", "typography.letterSpacing": "em" } as const;
    expect(resolveRoleUnit("typography.fontSize", units)).toBe("rem");
    expect(resolveRoleUnit("typography.letterSpacing", units)).toBe("em");
  });

  it("units.default is the global fallback, below finer grains", () => {
    expect(resolveRoleUnit("borders.width", { default: "rem" })).toBe("rem");
    expect(resolveRoleUnit("borders.width", { default: "rem", borders: "px" })).toBe("px");
  });
});

describe("§21 resolveLengthRef", () => {
  const bfs = 16;
  it("deferred number → role unit (px is a straight tag, byte-identical value)", () => {
    expect(resolveLengthRef({ value: 16 }, "px", bfs)).toEqual({ value: 16, unit: "px" });
  });
  it("deferred number → rem divides by baseFontSize", () => {
    expect(resolveLengthRef({ value: 24 }, "rem", bfs)).toEqual({ value: 1.5, unit: "rem" });
    expect(resolveLengthRef({ value: 4 }, "rem", bfs)).toEqual({ value: 0.25, unit: "rem" });
  });
  it("role none keeps the value unit-less (unchanged ref)", () => {
    const ref = { value: 1.5 };
    expect(resolveLengthRef(ref, "none", bfs)).toBe(ref);
  });
  it("pinned string is trusted verbatim, never converted", () => {
    expect(resolveLengthRef({ value: "1px" }, "rem", bfs)).toEqual({ value: 1, unit: "px" });
    expect(resolveLengthRef({ value: "2em" }, "px", bfs)).toEqual({ value: 2, unit: "em" });
  });
  it("a token reference is untouched", () => {
    const ref = { ref: "layout.spacing.md" };
    expect(resolveLengthRef(ref, "rem", bfs)).toBe(ref);
  });
  it("a raw-string escape (function/keyword) is untouched", () => {
    const ref = { value: "calc(100% - 2rem)" };
    expect(resolveLengthRef(ref, "rem", bfs)).toBe(ref);
  });
});

describe("§21 resolveModelUnits — Model pass", () => {
  const model = (): ThemeModel => ({
    breakpoints: { sm: 576 },
    subsystems: {
      typography: {
        properties: {
          fontSize: { base: { value: 16 }, variants: { lg: { base: { value: 24 } } } },
          lineHeight: { base: { value: 1.5 } },
          letterSpacing: { base: { value: "0" }, variants: { tight: { base: { value: "-0.02em" } } } },
        },
      },
      effects: {
        properties: {
          opacity: { base: { value: 1 }, variants: { muted: { base: { value: 0.5 } } } },
          shadow: { base: { struct: [{ offsetY: 2, blur: 8, color: "colors.shadow" }] } },
        },
      },
    },
  });

  it("default (px) tags length leaves, leaves unit-less + unregistered leaves alone", () => {
    const out = resolveModelUnits(model());
    const t = out.subsystems.typography.properties!;
    expect(t.fontSize.base).toEqual({ value: 16, unit: "px" });
    expect(t.fontSize.variants!.lg.base).toEqual({ value: 24, unit: "px" });
    expect(t.lineHeight.base).toEqual({ value: 1.5 }); // seed none → unit-less
    expect(t.letterSpacing.variants!.tight.base).toEqual({ value: -0.02, unit: "em" }); // parsed
    expect(out.subsystems.effects.properties!.opacity.variants!.muted.base).toEqual({ value: 0.5 }); // not a length
  });

  it("units.typography = rem converts fontSize, not lineHeight/letterSpacing", () => {
    const out = resolveModelUnits(model(), { units: { typography: "rem" }, baseFontSize: 16 });
    const t = out.subsystems.typography.properties!;
    expect(t.fontSize.base).toEqual({ value: 1, unit: "rem" });
    expect(t.fontSize.variants!.lg.base).toEqual({ value: 1.5, unit: "rem" });
    expect(t.lineHeight.base).toEqual({ value: 1.5 }); // property seed 'none' beats subsystem 'rem'
    expect(t.letterSpacing.variants!.tight.base).toEqual({ value: -0.02, unit: "em" }); // property seed 'em'
  });

  it("shadow geometry resolves (deferred px tag) while color ref survives", () => {
    const out = resolveModelUnits(model());
    const struct = out.subsystems.effects.properties!.shadow.base.struct as Array<Record<string, unknown>>;
    expect(struct[0]).toEqual({ offsetY: { value: 2, unit: "px" }, blur: { value: 8, unit: "px" }, color: "colors.shadow" });
  });
});
