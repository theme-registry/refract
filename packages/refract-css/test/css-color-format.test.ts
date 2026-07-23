/**
 * CSS adapter `colorFormat` (§20) — palette colour values in the emitted `:root` vars can be output
 * as `rgb()` (default, unchanged), `#rrggbb` hex, or CSS Color 4 `oklch()`. The colour is identical
 * across formats — this is presentation only — so each format equals the shared serializer applied
 * to the Model's canonical `rgb()` value. Non-colour vars (lengths etc.) are never touched, and the
 * default stays `rgb()` so the option is non-breaking. Inline mode inherits the format for free
 * (it bakes from the already-formatted variable map).
 */
import { describe, it, expect } from "vitest";
import { createTheme } from "@theme-registry/refract";
import { createCssAdapter } from "../src";
import { toHexColor, toOklchColor } from "@theme-registry/refract/color-math";

const raw = {
  colors: {
    primary: { base: "#4dabf7", variants: { hover: { modifiers: [{ darken: 10 }] }, ghost: { modifiers: [{ alpha: 40 }] } } },
  },
  layout: { spacing: { base: 8 } },
};

const varsCss = (colorFormat?: "rgb" | "hex" | "oklch"): string =>
  (
    createTheme(raw as never, {
      adapter: createCssAdapter({ prefix: "dt", ...(colorFormat ? { colorFormat } : {}) }),
    }) as unknown as { variablesCss: string }
  ).variablesCss;

describe("CSS adapter — colorFormat (§20)", () => {
  it("defaults to rgb() — non-breaking", () => {
    const css = varsCss();
    expect(css).toContain("--dt-colors-primary: rgb(77, 171, 247);");
    expect(css).toContain("--dt-colors-primary-ghost: rgba(77, 171, 247, 0.4);");
  });

  it("hex → #rrggbb, and #rrggbbaa when the colour carries alpha", () => {
    const css = varsCss("hex");
    expect(css).toContain(`--dt-colors-primary: ${toHexColor("rgb(77, 171, 247)")};`);
    expect(css).toContain("--dt-colors-primary: #4dabf7;");
    // ghost = alpha 40 → rgba(…,0.4) → 8-digit hex (0.4·255 ≈ 102 = 0x66)
    expect(css).toContain("--dt-colors-primary-ghost: #4dabf766;");
  });

  it("oklch → oklch(L% C H), and oklch(… / a) when the colour carries alpha", () => {
    const css = varsCss("oklch");
    expect(css).toContain(`--dt-colors-primary: ${toOklchColor("rgb(77, 171, 247)")};`);
    expect(css).toMatch(/--dt-colors-primary: oklch\([\d.]+% [\d.]+ [\d.]+\);/);
    expect(css).toContain(`--dt-colors-primary-ghost: ${toOklchColor("rgba(77, 171, 247, 0.4)")};`);
    expect(css).toMatch(/--dt-colors-primary-ghost: oklch\([^)]* \/ 0\.4\);/);
  });

  it("leaves non-colour vars (lengths) untouched", () => {
    const css = varsCss("oklch");
    expect(css).toContain("--dt-layout-spacing: 8px;");
    expect(css).not.toMatch(/spacing:\s*oklch/);
  });

  it("inline mode bakes the chosen format into referenced declarations", () => {
    const theme = createTheme(
      {
        colors: {
          brand: { base: "#4dabf7" },
          recipes: { solid: { brand: { background: "brand" } } },
        },
      } as never,
      { adapter: createCssAdapter({ prefix: "dt", colorFormat: "oklch", inline: true }) },
    ) as unknown as { css: string };
    // the recipe's `background: var(--dt-colors-brand)` is inlined to the oklch value
    expect(theme.css).toContain(`background: ${toOklchColor("rgb(77, 171, 247)")}`);
    expect(theme.css).not.toContain("var(--dt-colors-brand)");
  });
});
