/**
 * §W6a — richer colour input. `coerceColorInput` parses hex, `[r,g,b]`, `oklch()`, `hsl()/hsla()`,
 * `rgb()/rgba()`, and CSS named keywords to the canonical `rgb()` form; a `var(--…)` is still rejected
 * (not tonally derivable at build time). Derivation still runs in OKLCH, so a widened input produces
 * output byte-identical to its hex equivalent.
 */
import { describe, it, expect } from "vitest";
import { createTheme, createNoopAdapter } from "@theme-registry/refract";
import { toOklchColor } from "../src/subsystems/colors/utils";
import { coerceColorInput } from "../src/subsystems/colors/colorInput";

const token = (base: unknown, path = "colors.brand") =>
  createTheme({ colors: { brand: base } } as any, { adapter: createNoopAdapter() }).resolveToken(path);

describe("colour input — coerceColorInput", () => {
  it("accepts a CSS named keyword, equal to its hex", () => {
    expect(coerceColorInput("rebeccapurple")).toBe("rgb(102, 51, 153)");
    expect(coerceColorInput("rebeccapurple")).toBe(coerceColorInput("#663399"));
    expect(coerceColorInput("TOMATO")).toBe(coerceColorInput("#ff6347")); // case-insensitive
  });

  it("accepts hsl() in modern and legacy syntax", () => {
    expect(coerceColorInput("hsl(0 100% 50%)")).toBe("rgb(255, 0, 0)");
    expect(coerceColorInput("hsl(120, 100%, 50%)")).toBe("rgb(0, 255, 0)");
    expect(coerceColorInput("hsl(240deg 100% 50%)")).toBe("rgb(0, 0, 255)");
  });

  it("accepts rgb()/rgba() strings and preserves alpha", () => {
    expect(coerceColorInput("rgb(10, 20, 30)")).toBe("rgb(10, 20, 30)");
    expect(coerceColorInput("rgba(10, 20, 30, 0.5)")).toBe("rgba(10, 20, 30, 0.5)");
  });

  it("accepts oklch(), parsing both L% and bare-number L", () => {
    expect(coerceColorInput("oklch(100% 0 0)")).toBe("rgb(255, 255, 255)");
    expect(coerceColorInput("oklch(1 0 0)")).toBe("rgb(255, 255, 255)"); // L as 0–1
    expect(coerceColorInput("oklch(0% 0 0)")).toBe("rgb(0, 0, 0)");
  });

  it("round-trips a hex through its oklch() string within 1 channel", () => {
    const hex = "#4c6ef5";
    const back = coerceColorInput(toOklchColor(hex)); // "rgb(r, g, b)"
    const got = back.match(/\d+/g)!.map(Number);
    const want = coerceColorInput(hex).match(/\d+/g)!.map(Number);
    got.forEach((c, i) => expect(Math.abs(c - want[i])).toBeLessThanOrEqual(1));
  });

  it("rejects var(--…), transparent, currentColor, and gibberish", () => {
    for (const bad of ["var(--brand)", "transparent", "currentColor", "not-a-colour"]) {
      expect(() => coerceColorInput(bad)).toThrow(/Invalid colour/);
    }
  });
});

describe("colour input — end-to-end derivation parity", () => {
  it("derives named steps from a keyword base identically to the hex base", () => {
    const kw = createTheme(
      { colors: { brand: { base: "rebeccapurple", lightenBy: 12, darkenBy: 15 } } } as any,
      { adapter: createNoopAdapter() },
    );
    const hex = createTheme(
      { colors: { brand: { base: "#663399", lightenBy: 12, darkenBy: 15 } } } as any,
      { adapter: createNoopAdapter() },
    );
    expect(kw.resolveToken("colors.brand.light")).toBe(hex.resolveToken("colors.brand.light"));
    expect(kw.resolveToken("colors.brand.dark")).toBe(hex.resolveToken("colors.brand.dark"));
  });

  it("accepts a keyword/hsl base + text sibling through createTheme", () => {
    expect(token({ base: "hsl(226 90% 63%)", text: "white" })).toBe(coerceColorInput("hsl(226 90% 63%)"));
  });

  it("still throws (path-labelled) on a var(--…) base through createTheme", () => {
    expect(() =>
      createTheme({ colors: { brand: { base: "var(--x)" } } } as any, { adapter: createNoopAdapter() }),
    ).toThrow(/Invalid colour/);
  });
});
