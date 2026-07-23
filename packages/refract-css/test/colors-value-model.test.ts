/**
 * Colors value model (§13) — the reworked authoring/derivation surface.
 *
 * Covers: `[r,g,b]` tuple bases (coerced to canonical hex); numeric-only `steps` with a base-step
 * alias + a friendly error on non-numeric steps; derivation-spec variants `{ darken|lighten|alpha,
 * ref? }`; `alpha` as absolute opacity serialized to `rgba()`; `darken`/`lighten` preserving alpha
 * so a `ref` chain off an alpha'd variant keeps its opacity; `override()` re-deriving an alpha
 * variant for free (derived Ref, no colour math in override); richer input parsing (hex / [r,g,b] /
 * oklch() / hsl() / rgb() / keyword all normalize to canonical rgb, derivation runs in OKLCH); and
 * that only a var(--…) — which can't be tonally derived at build — is rejected.
 */
import { describe, it, expect } from "vitest";
import { createTheme } from "@theme-registry/refract";
import { createCssAdapter } from "../src";
import { rgbToOklch, parseColor } from "@theme-registry/refract/color-math";

/** The OKLCH lightness (0–100 scale) of a resolved `rgb()` token — for absolute-ladder assertions. */
const lightnessOf = (theme: any, path: string): number =>
  rgbToOklch(parseColor(theme.resolveToken(path)).rgb).L;

const build = (raw: Record<string, unknown>) =>
  createTheme(raw as any, { adapter: createCssAdapter({ prefix: "dt" }) }) as any;

describe("colors value model — base forms", () => {
  it("accepts an [r,g,b] tuple base and coerces it to canonical rgb()", () => {
    const theme = build({ colors: { primary: { base: [77, 171, 247] } } });
    expect(theme.resolveToken("colors.primary")).toBe("rgb(77, 171, 247)");
  });

  it("accepts keyword / rgb() / oklch() / hsl() bases, normalizing to canonical rgb()", () => {
    expect(build({ colors: { link: "rebeccapurple" } }).resolveToken("colors.link")).toBe("rgb(102, 51, 153)");
    expect(build({ colors: { link: "rgb(1, 2, 3)" } }).resolveToken("colors.link")).toBe("rgb(1, 2, 3)");
    expect(build({ colors: { link: "hsl(0 100% 50%)" } }).resolveToken("colors.link")).toBe("rgb(255, 0, 0)");
    expect(build({ colors: { link: "oklch(100% 0 0)" } }).resolveToken("colors.link")).toBe("rgb(255, 255, 255)");
  });

  it("only a var(--…) is rejected — it can't be tonally derived at build time", () => {
    expect(() => build({ colors: { link: "var(--brand)" } })).toThrow(/Invalid colour/);
  });

  it("the `text` colour goes through the same input gate (tuple / keyword → rgb, var() throws)", () => {
    const theme = build({ colors: { primary: { base: "#4dabf7", text: [255, 255, 255] } } });
    expect(theme.resolveToken("colors.primary.text")).toBe("rgb(255, 255, 255)");
    expect(build({ colors: { primary: { base: "#4dabf7", text: "white" } } }).resolveToken("colors.primary.text")).toBe("rgb(255, 255, 255)");
    expect(() => build({ colors: { primary: { base: "#4dabf7", text: "var(--x)" } } })).toThrow(
      /colors\.primary\.text .* Invalid colour/,
    );
  });
});

describe("colors value model — numeric steps (absolute-L ladder)", () => {
  it("numeric steps generate an absolute-L ladder; the exact base stays the unnumbered token", () => {
    const theme = build({ colors: { brand: { base: "#4dabf7", steps: [100, 300, 500, 700, 900] } } });
    const brand = theme.model.subsystems.colors.properties.brand;
    expect(Object.keys(brand.variants).sort()).toEqual(["100", "300", "500", "700", "900"]);
    // The exact authored colour lives at the unnumbered token — never aliased to a rung.
    expect(theme.resolveToken("colors.brand")).toBe("rgb(77, 171, 247)");
    // Rungs are absolute lightnesses (low label = light, high = dark), monotonic in L.
    expect(lightnessOf(theme, "colors.brand.100")).toBeGreaterThan(lightnessOf(theme, "colors.brand.500"));
    expect(lightnessOf(theme, "colors.brand.500")).toBeGreaterThan(lightnessOf(theme, "colors.brand.900"));
    // Label → L is absolute: 500 → L50, independent of the base's own lightness.
    expect(lightnessOf(theme, "colors.brand.500")).toBeCloseTo(50, 0);
    // The rung is a re-derivable Ref (setL off the base), not a plain alias.
    expect(brand.variants["500"].base).toMatchObject({ ref: "colors.brand", fn: "setL", arg: 50 });
  });

  it("the same label lands at the same lightness across hues (cross-hue consistency)", () => {
    const theme = build({
      colors: { blue: { base: "#4dabf7", steps: [500] }, red: { base: "#e03131", steps: [500] } },
    });
    expect(
      Math.abs(lightnessOf(theme, "colors.blue.500") - lightnessOf(theme, "colors.red.500")),
    ).toBeLessThan(1.5);
  });

  it("a non-numeric step is a friendly error (no silent darken-sweep)", () => {
    expect(() => build({ colors: { x: { base: "#4dabf7", steps: ["blabla"] as any } } })).toThrow(
      /steps must be numbers/,
    );
  });

  it("an out-of-range ladder label is a friendly error", () => {
    expect(() => build({ colors: { x: { base: "#4dabf7", steps: [1500] } } })).toThrow(
      /steps must be numbers/,
    );
  });
});

describe("colors value model — derivation-spec variants", () => {
  it("darken / lighten / alpha derive from the base", () => {
    const theme = build({
      colors: {
        primary: {
          base: "#4dabf7",
          variants: { hover: { modifiers: [{ darken: 10 }] }, soft: { modifiers: [{ lighten: 20 }] }, ghost: { modifiers: [{ alpha: 40 }] } },
        },
      },
    });
    expect(theme.resolveToken("colors.primary.hover")).toBe("rgb(40, 139, 213)");
    expect(theme.resolveToken("colors.primary.ghost")).toBe("rgba(77, 171, 247, 0.4)");
    // alpha is absolute opacity, not a relative fade
    expect(theme.resolveToken("colors.primary.soft")).not.toBe("rgb(77, 171, 247)");
  });

  it("darken off an alpha'd variant via `ref` preserves the alpha channel", () => {
    const theme = build({
      colors: {
        primary: { base: "#4dabf7", variants: { ghost: { modifiers: [{ alpha: 40 }] }, scrim: { ref: "ghost", modifiers: [{ darken: 50 }] } } },
      },
    });
    const scrim = theme.resolveToken("colors.primary.scrim");
    expect(scrim).toMatch(/^rgba\(/);
    expect(scrim.endsWith(", 0.4)")).toBe(true);
  });

  it("a derivation carries { ref, fn, arg } so override() re-derives it for free", () => {
    const theme = build({ colors: { primary: { base: "#4dabf7", variants: { ghost: { modifiers: [{ alpha: 40 }] } } } } });
    const child = theme.override({
      colors: { primary: { base: "#ff0000", variants: { ghost: { modifiers: [{ alpha: 40 }] } } } },
    });
    expect(child.resolveToken("colors.primary.ghost")).toBe("rgba(255, 0, 0, 0.4)");
    // parent unchanged
    expect(theme.resolveToken("colors.primary.ghost")).toBe("rgba(77, 171, 247, 0.4)");
  });
});

describe("colors value model — dec.3 variant extras", () => {
  it("a variant carries its OWN extras (text) → --<prop>-<variant>-<extra>", () => {
    const theme = build({
      colors: { primary: { base: "#4dabf7", text: "#ffffff", variants: { loud: { base: "#1c7ed6", text: "#000000" } } } },
    });
    const css = theme.css as string;
    expect(css).toContain("--dt-colors-primary-loud: rgb(28, 126, 214);");
    expect(css).toContain("--dt-colors-primary-loud-text: rgb(0, 0, 0);");
    // Model shape: variant is { base, extras }.
    const loud = theme.model.subsystems.colors.properties.primary.variants.loud;
    expect(loud.base.value).toBe("rgb(28, 126, 214)");
    expect(loud.extras.text.value).toBe("rgb(0, 0, 0)");
    // …and the extra is an addressable token.
    expect(theme.resolveToken("colors.primary.loud.text")).toBe("rgb(0, 0, 0)");
  });

  it("base OPTIONAL — a variant that omits base INHERITS the property's base", () => {
    const theme = build({
      colors: { primary: { base: "#4dabf7", text: "#ffffff", variants: { subtle: { text: "#999999" } } } },
    });
    const css = theme.css as string;
    expect(css).toContain("--dt-colors-primary-subtle: rgb(77, 171, 247);"); // inherited from the property base
    expect(css).toContain("--dt-colors-primary-subtle-text: rgb(153, 153, 153);");
    const subtle = theme.model.subsystems.colors.properties.primary.variants.subtle;
    expect(subtle.base.value).toBe("rgb(77, 171, 247)");
    expect(subtle.extras.text.value).toBe("rgb(153, 153, 153)");
  });
});

describe("colors value model — adjust variant (§20.4)", () => {
  const lch = (theme: any, p: string) => rgbToOklch(parseColor(theme.resolveToken(p)).rgb);

  it("places absolute lightness / scales chroma to grey / rotates hue", () => {
    const theme = build({
      colors: {
        primary: {
          base: "#4dabf7",
          variants: { deep: { modifiers: [{ adjust: { l: 40 } }] }, gray: { modifiers: [{ adjust: { c: 0 } }] }, warm: { modifiers: [{ adjust: { h: 40 } }] } },
        },
      },
    });
    // `l` is an absolute OKLCH lightness (the opposite direction from a numeric-steps label).
    expect(lch(theme, "colors.primary.deep").L).toBeCloseTo(40, 0);
    // `c: 0` fully desaturates (grey).
    expect(lch(theme, "colors.primary.gray").C).toBeLessThan(0.01);
    // `h` rotates hue, holding lightness.
    const base = lch(theme, "colors.primary");
    const warm = lch(theme, "colors.primary.warm");
    expect(((warm.h - base.h + 360) % 360)).toBeCloseTo(40, 0);
    expect(Math.abs(warm.L - base.L)).toBeLessThan(1.5);
  });

  it("carries { ref, modifiers:[{ adjust }] } (object arg) so override() re-derives off the new base", () => {
    const theme = build({ colors: { primary: { base: "#4dabf7", variants: { warm: { modifiers: [{ adjust: { h: 40 } }] } } } } });
    expect(theme.model.subsystems.colors.properties.primary.variants.warm.base).toMatchObject({
      ref: "colors.primary",
      modifiers: [{ fn: "adjust", arg: { h: 40 } }],
    });
    // Override re-runs the +40° rotation off the NEW base hue (no stale cache).
    const child = theme.override({
      colors: { primary: { base: "#e03131", variants: { warm: { modifiers: [{ adjust: { h: 40 } }] } } } },
    });
    const nb = lch(child, "colors.primary");
    const nw = lch(child, "colors.primary.warm");
    expect(((nw.h - nb.h + 360) % 360)).toBeCloseTo(40, 0);
    // parent's warm is unchanged (still +40° off the old blue base)
    const pb = lch(theme, "colors.primary");
    const pw = lch(theme, "colors.primary.warm");
    expect(((pw.h - pb.h + 360) % 360)).toBeCloseTo(40, 0);
  });

  it("an out-of-range adjust.l is a friendly error", () => {
    expect(() =>
      build({ colors: { x: { base: "#4dabf7", variants: { bad: { modifiers: [{ adjust: { l: 150 } }] } } } } }),
    ).toThrow(/adjust\.l must be an absolute OKLCH lightness in 0–100/);
  });
});

describe("colors value model — harmony (§20.5)", () => {
  const lch = (theme: any, p: string) => rgbToOklch(parseColor(theme.resolveToken(p)).rgb);

  it("string form adds default-named hue-rotation variants that hold L (alongside the named set)", () => {
    const theme = build({ colors: { primary: { base: "#4dabf7", harmony: "triadic" } } });
    const p = theme.model.subsystems.colors.properties.primary;
    expect(Object.keys(p.variants)).toEqual(expect.arrayContaining(["triadic1", "triadic2", "light", "dark"]));
    expect(p.variants.triadic1.base).toMatchObject({ ref: "colors.primary", fn: "rotateHue", arg: 120 });
    expect(p.variants.triadic2.base).toMatchObject({ ref: "colors.primary", fn: "rotateHue", arg: 240 });

    const base = lch(theme, "colors.primary");
    const t1 = lch(theme, "colors.primary.triadic1");
    expect(((t1.h - base.h + 360) % 360)).toBeCloseTo(120, 0);
    expect(Math.abs(t1.L - base.L)).toBeLessThan(1.5); // only hue turns
  });

  it("object form renames members positionally", () => {
    const theme = build({ colors: { primary: { base: "#4dabf7", harmony: { triadic: ["mint", "coral"] } } } });
    const p = theme.model.subsystems.colors.properties.primary;
    expect(p.variants.mint.base).toMatchObject({ ref: "colors.primary", fn: "rotateHue", arg: 120 });
    expect(p.variants.coral.base).toMatchObject({ ref: "colors.primary", fn: "rotateHue", arg: 240 });
    expect(p.variants.triadic1).toBeUndefined();
  });

  it("an unknown harmony scheme is a friendly error", () => {
    expect(() => build({ colors: { x: { base: "#4dabf7", harmony: "quadratic" as any } } })).toThrow(
      /unknown scheme "quadratic"/,
    );
  });
});

describe("colors value model — validation", () => {
  it("a keyword base is parsed to rgb, so its derivations work like any hex base", () => {
    const kw = build({ colors: { x: { base: "rebeccapurple", variants: { hover: { modifiers: [{ darken: 10 }] } } } } });
    const hex = build({ colors: { x: { base: "#663399", variants: { hover: { modifiers: [{ darken: 10 }] } } } } });
    expect(kw.resolveToken("colors.x.hover")).toBe(hex.resolveToken("colors.x.hover"));
  });

  it("a var(--…) base with derivations is rejected up front (can't be derived at build)", () => {
    expect(() =>
      build({ colors: { x: { base: "var(--brand)", variants: { hover: { modifiers: [{ darken: 10 }] } } } } }),
    ).toThrow(/Invalid colour/);
  });
});
