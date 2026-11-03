/**
 * Generator settings (colour tones/harmony, the modular type scale) shape the tokens a property
 * generates; they are not tokens themselves. They used to leak into `theme.tokens` as
 * `colors.<p>.lightenBy`, `typography.fontSize.ratio`, … because core reads every scalar extra.
 */
import { describe, it, expect } from "vitest";
import { createTheme, createNoopAdapter } from "@theme-registry/refract";

const build = (raw: unknown) => createTheme(raw as never, { adapter: createNoopAdapter() });

describe("generator settings are not tokens", () => {
  const theme = build({
    colors: {
      brand: { base: "#4c6ef5", text: "#ffffff", lightenBy: 12, darkenBy: 15, harmony: "complement" },
      ladder: { base: "#e64980", steps: [100, 500, 900] },
      flat: { base: "#24348f", tones: false },
    },
    typography: { fontSize: { base: 16, ratio: "major-third", precision: 2, baseFontSize: 16, unit: "rem" } },
  });
  const paths = Object.keys(theme.tokens);

  it("keeps no colour setting in theme.tokens", () => {
    for (const setting of ["lightenBy", "darkenBy", "harmony", "steps", "tones"]) {
      expect(paths.filter(p => p.startsWith("colors.") && p.endsWith(`.${setting}`))).toEqual([]);
    }
  });

  it("keeps no type-scale setting in theme.tokens", () => {
    for (const setting of ["ratio", "precision", "baseFontSize", "unit"]) {
      expect(paths).not.toContain(`typography.fontSize.${setting}`);
    }
  });

  it("still generates from the settings and keeps real extras", () => {
    expect(paths).toContain("colors.brand.text"); // `text` is an extra that IS a token
    expect(paths).toContain("colors.brand.light");
    expect(paths).toContain("colors.brand.darker");
    expect(paths).toContain("colors.ladder.500");
    expect(paths.filter(p => p.startsWith("colors.flat."))).toEqual([]); // tones: false → base only
    expect(paths).toContain("typography.fontSize.4xl");
  });

  it("generates the same values with and without the settings visible", () => {
    // lightenBy 12 must still drive the step: compare with an explicit lighter base.
    const loose = build({ colors: { brand: { base: "#4c6ef5", lightenBy: 1 } } });
    expect(theme.resolveToken("colors.brand.light")).not.toEqual(loose.resolveToken("colors.brand.light"));
  });
});
