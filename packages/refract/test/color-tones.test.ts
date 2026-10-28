// `tones: false` on a colour property: no auto-generated tones (named set or numeric `steps`), only
// the base and the variants written. Used by palettes taken as-is from elsewhere, like a DTCG import.
import { describe, it, expect } from "vitest";
import { createTheme } from "../src/core";
import { createNoopAdapter } from "../src/core/noopAdapter";

const colorTokens = (colors: Record<string, unknown>) =>
  Object.keys(createTheme({ colors }, { adapter: createNoopAdapter() }).tokens).filter(k => k.startsWith("colors."));

describe("colors — tones: false", () => {
  it("drops the named tones and keeps the written variants", () => {
    expect(colorTokens({ brand: { base: "#4c6ef5", tones: false, variants: { hover: "#3b5bdb" } } })).toEqual([
      "colors.brand",
      "colors.brand.hover",
    ]);
  });

  it("drops the numeric steps ladder too", () => {
    expect(colorTokens({ brand: { base: "#4c6ef5", tones: false, steps: [100, 500, 900] } })).toEqual(["colors.brand"]);
  });

  it("is off by default: tones are generated unless asked otherwise", () => {
    expect(colorTokens({ brand: { base: "#4c6ef5" } })).toEqual([
      "colors.brand",
      "colors.brand.light",
      "colors.brand.lighter",
      "colors.brand.dark",
      "colors.brand.darker",
    ]);
  });
});
