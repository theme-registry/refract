/**
 * refract → Figma pure transform (F3). Exercises the DTCG → Figma-variable-plan mapping without any
 * `figma.*` — the plugin sandbox glue in `code.ts` just executes what these tests pin down.
 */
import { describe, it, expect } from "vitest";
import { createTheme, createNoopAdapter } from "@theme-registry/refract";
import { toDTCG, type DTCGDocument } from "@theme-registry/refract/dtcg";
import { buildVariablePlan, hexToRgba } from "../src/plan";

describe("hexToRgba", () => {
  it("parses 3/6/8-digit hex to 0–1 channels", () => {
    expect(hexToRgba("#000000")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(hexToRgba("#ffffff")).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expect(hexToRgba("#f00")).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    const alpha = hexToRgba("#00000080")!;
    expect(alpha.a).toBeCloseTo(0.5, 1);
  });
  it("returns undefined for non-hex", () => {
    expect(hexToRgba("rgb(0,0,0)")).toBeUndefined();
    expect(hexToRgba("#12")).toBeUndefined();
  });
});

const singleDoc: DTCGDocument = {
  color: { $type: "color", brand: { base: { $value: "#4c6ef5" }, text: { $value: "#ffffff" } } },
  spacing: { $type: "dimension", base: { $value: "8px" }, lg: { $value: "24px" } },
  typography: { fontFamily: { $type: "fontFamily", base: { $value: "Inter, sans-serif" } } },
};

describe("buildVariablePlan", () => {
  it("maps a DTCG document to typed, folder-pathed variables (one mode)", () => {
    const plan = buildVariablePlan("acme", [{ name: "default", doc: singleDoc }]);
    expect(plan.collection).toBe("acme");
    expect(plan.modes).toEqual(["default"]);

    const byName = Object.fromEntries(plan.variables.map((v) => [v.name, v]));
    // colour → COLOR with an rgba value under the mode
    expect(byName["color/brand/base"].type).toBe("COLOR");
    expect(byName["color/brand/base"].valuesByMode.default).toEqual(hexToRgba("#4c6ef5"));
    // dimension → FLOAT with the unit stripped
    expect(byName["spacing/base"].type).toBe("FLOAT");
    expect(byName["spacing/base"].valuesByMode.default).toBe(8);
    expect(byName["spacing/lg"].valuesByMode.default).toBe(24);
    // fontFamily → STRING
    expect(byName["typography/fontFamily/base"].type).toBe("STRING");
    expect(byName["typography/fontFamily/base"].valuesByMode.default).toBe("Inter, sans-serif");
  });

  it("merges multiple modes into one variable carrying a value per mode", () => {
    const light: DTCGDocument = { color: { $type: "color", brand: { base: { $value: "#4c6ef5" } } } };
    const dark: DTCGDocument = { color: { $type: "color", brand: { base: { $value: "#8aa2ff" } } } };
    const plan = buildVariablePlan("acme", [
      { name: "light", doc: light },
      { name: "dark", doc: dark },
    ]);
    expect(plan.modes).toEqual(["light", "dark"]);
    expect(plan.variables).toHaveLength(1);
    const brand = plan.variables[0];
    expect(brand.name).toBe("color/brand/base");
    expect(brand.valuesByMode.light).toEqual(hexToRgba("#4c6ef5"));
    expect(brand.valuesByMode.dark).toEqual(hexToRgba("#8aa2ff"));
  });

  it("skips composite/unsupported token types with a warning, not a failure", () => {
    const doc: DTCGDocument = {
      shadow: { $type: "shadow", card: { $value: { color: "#000", offsetX: "0", offsetY: "1px", blur: "2px", spread: "0" } } },
      color: { $type: "color", ink: { base: { $value: "#000000" } } },
    };
    const plan = buildVariablePlan("acme", [{ name: "default", doc }]);
    expect(plan.variables.map((v) => v.name)).toEqual(["color/ink/base"]);
    expect(plan.warnings.some((w) => w.includes("shadow"))).toBe(true);
  });

  it("de-duplicates a repeated mode name", () => {
    const plan = buildVariablePlan("acme", [
      { name: "default", doc: singleDoc },
      { name: "default", doc: singleDoc },
    ]);
    expect(plan.modes).toEqual(["default"]);
    expect(plan.warnings.some((w) => w.includes("duplicate mode"))).toBe(true);
  });

  it("integrates with a real toDTCG document", () => {
    const theme = createTheme(
      { colors: { brand: { base: "#4c6ef5", text: "#fff" } }, layout: { spacing: { base: 8 } } },
      { adapter: createNoopAdapter() },
    );
    const plan = buildVariablePlan("refract", [{ name: "default", doc: toDTCG(theme) }]);
    const brand = plan.variables.find((v) => v.name === "color/brand/base")!;
    expect(brand.type).toBe("COLOR");
    expect(brand.valuesByMode.default).toEqual(hexToRgba("#4c6ef5"));
    // synthesized steps come along too
    expect(plan.variables.some((v) => v.name === "color/brand/dark")).toBe(true);
  });
});
