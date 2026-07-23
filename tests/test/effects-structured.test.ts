/**
 * §15 — structured effects value model (shadow + transitions), structured-only per the 2026-07-16
 * amendment: raw CSS strings are rejected (only the `"none"` keyword is allowed); there is no `base`
 * authoring key for effects — top-level leaves are the base. A translucent shadow references a
 * translucent COLOUR (an `alpha` colour variant, §13.3) — no shadow-level alpha field.
 *
 * Shadow/transition leaf VALUES are format-neutral structure in the Model (`Ref.struct`), not
 * pre-serialized CSS strings; adapters compose them. Covers: core `leafFields` base assembly (flat
 * leaf, `TExtra` partition, implicit `"none"` base), the Model carriage, and CSS + JSON + DTCG
 * composition — plus responsive whole-value replacement and coerce validation.
 */
import { describe, it, expect } from "vitest";
import { createTheme } from "@theme-registry/refract";
import { createCssAdapter } from "@theme-registry/refract-css";
import { createJsonAdapter } from "@theme-registry/refract-json";
import { toDTCG } from "@theme-registry/refract/dtcg";
import { normalizePropertyValue } from "@theme-registry/refract";

const SHADOW_LEAF_FIELDS = ["offsetX", "offsetY", "blur", "spread", "color", "inset"] as const;

const cssTheme = (rawEffects: Record<string, unknown>, colors: Record<string, unknown> = { shadow: "#101010", shadowFar: "#202020" }) =>
  createTheme(
    { breakpoints: { sm: 576, md: 768 }, colors, effects: rawEffects } as never,
    { adapter: createCssAdapter({ prefix: "app" }) },
  ) as unknown as { css: string; model: { subsystems: Record<string, { properties?: Record<string, unknown> }> } };

// ---------------------------------------------------------------------------
// Core normalize — leafFields base assembly (§15.2)
// ---------------------------------------------------------------------------

describe("§15 core normalize — leafFields", () => {
  it("assembles a flat leaf into the base, keeping variants structural", () => {
    const out = normalizePropertyValue<unknown>(
      { offsetY: 1, blur: 2, color: "colors.shadow", variants: { lg: { offsetY: 8, blur: 24 } } } as never,
      { leafFields: SHADOW_LEAF_FIELDS, coerceValue: v => v },
    );
    expect(out.base).toEqual({ offsetY: 1, blur: 2, color: "colors.shadow" });
    expect(out.variants!.lg.base).toEqual({ offsetY: 8, blur: 24 });
  });

  it("defaults the base to the `fallbackBase` when only variants are authored (no top-level leaves)", () => {
    // §15.2 (amended): effects passes `fallbackBase: "none"`, so a property with only variants has an
    // implicit `"none"` base instead of failing base resolution.
    const out = normalizePropertyValue<unknown>(
      { variants: { lg: { offsetY: 8, blur: 24 } } } as never,
      { leafFields: SHADOW_LEAF_FIELDS, coerceValue: v => v, fallbackBase: "none" },
    );
    expect(out.base).toBe("none");
    expect(out.variants!.lg.base).toEqual({ offsetY: 8, blur: 24 });
  });

  it("does NOT swallow a non-leaf key — it stays a TExtra sibling", () => {
    const out = normalizePropertyValue<unknown, { note?: string }>(
      { offsetY: 1, note: "hi" } as never,
      { leafFields: SHADOW_LEAF_FIELDS, coerceValue: v => v },
    );
    expect(out.base).toEqual({ offsetY: 1 });
    expect((out as { note?: string }).note).toBe("hi");
  });

  it("assembles responsive leaf fields into a whole-value base override", () => {
    const out = normalizePropertyValue<unknown>(
      { offsetY: 1, responsive: [{ breakpoint: "md", offsetY: 4, blur: 12 }] } as never,
      { leafFields: SHADOW_LEAF_FIELDS, coerceValue: v => v, allowedBreakpoints: ["md"] },
    );
    expect(out.responsive[0]).toMatchObject({ breakpoint: "md", base: { offsetY: 4, blur: 12 } });
  });

  it("leaves a pure variant-swap responsive entry untouched (no assembly)", () => {
    const out = normalizePropertyValue<unknown>(
      { offsetY: 1, variants: { lg: { offsetY: 8 } }, responsive: [{ breakpoint: "md", variant: "lg" }] } as never,
      { leafFields: SHADOW_LEAF_FIELDS, coerceValue: v => v, allowedBreakpoints: ["md"] },
    );
    expect(out.responsive[0]).toMatchObject({ breakpoint: "md", variant: "lg" });
    expect("base" in out.responsive[0]).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Model carriage — Ref.struct (§15.2)
// ---------------------------------------------------------------------------

describe("§15 Model — Ref.struct", () => {
  it("carries a single-layer shadow as a one-element struct array", () => {
    const shadow = cssTheme({ shadow: { offsetY: 1, blur: 2, color: "colors.shadow" } })
      .model.subsystems.effects.properties!.shadow as { base: { struct?: unknown; value?: unknown } };
    // §21: shadow geometry carries a resolved unit (px default); color ref intact.
    expect(shadow.base.struct).toEqual([
      { offsetY: { value: 1, unit: "px" }, blur: { value: 2, unit: "px" }, color: "colors.shadow" },
    ]);
    expect(shadow.base.value).toBeUndefined();
  });

  it("carries a multi-layer variant and a `none` keyword variant", () => {
    const shadow = cssTheme({
      shadow: {
        offsetY: 1, blur: 2, color: "colors.shadow",
        variants: { none: "none", lg: [{ offsetY: 1, blur: 2 }, { offsetY: 8, blur: 24 }] },
      },
    }).model.subsystems.effects.properties!.shadow as { variants: Record<string, { struct?: unknown; value?: unknown }> };
    expect(shadow.variants.lg.base.struct).toHaveLength(2);
    expect(shadow.variants.none.base.value).toBe("none"); // the `none` keyword stays a literal
    expect(shadow.variants.none.base.struct).toBeUndefined();
  });

  it("references a translucent colour variant for a soft shadow (no shadow-level alpha)", () => {
    const shadow = cssTheme(
      { shadow: { offsetY: 1, blur: 2, color: "colors.shadow.soft" } },
      { shadow: { base: "#000000", variants: { soft: { modifiers: [{ alpha: 10 }] } } } },
    ).model.subsystems.effects.properties!.shadow as { base: { struct?: Array<{ color?: string }> } };
    expect(shadow.base.struct).toEqual([
      { offsetY: { value: 1, unit: "px" }, blur: { value: 2, unit: "px" }, color: "colors.shadow.soft" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// CSS adapter — composition (§15.4)
// ---------------------------------------------------------------------------

describe("§15 CSS — composition", () => {
  it("composes base shadow with a color ref → var()", () => {
    const css = cssTheme({ shadow: { offsetY: 1, blur: 2, color: "colors.shadow" } }).css;
    expect(css).toContain("--app-effects-shadow: 0px 1px 2px var(--app-colors-shadow);");
  });

  it("composes a soft shadow by referencing a translucent colour variant", () => {
    const css = cssTheme(
      { shadow: { offsetY: 1, blur: 3, color: "colors.shadow.soft" } },
      { shadow: { base: "#000000", variants: { soft: { modifiers: [{ alpha: 10 }] } } } },
    ).css;
    expect(css).toContain("--app-colors-shadow-soft: rgba(0, 0, 0, 0.1);");
    expect(css).toContain("--app-effects-shadow: 0px 1px 3px var(--app-colors-shadow-soft);");
  });

  it("composes multi-layer (inset + spread) comma-joined, and emits the `none` keyword raw", () => {
    const css = cssTheme({
      shadow: {
        offsetY: 1, blur: 2, color: "colors.shadow",
        variants: {
          none: "none",
          lg: [
            { offsetY: 1, blur: 2, color: "colors.shadow" },
            { offsetY: 8, blur: 24, spread: -4, color: "colors.shadowFar", inset: true },
          ],
        },
      },
    }).css;
    expect(css).toContain(
      "--app-effects-shadow-lg: 0px 1px 2px var(--app-colors-shadow), inset 0px 8px 24px -4px var(--app-colors-shadowfar);",
    );
    expect(css).toContain("--app-effects-shadow-none: none;");
  });

  it("composes a transition with delay", () => {
    const css = cssTheme({ transitions: { property: "color", duration: 200, timingFunction: "ease", delay: 50 } }).css;
    expect(css).toContain("--app-effects-transitions: color 200ms ease 50ms;");
  });

  it("replaces the whole value in a responsive override (assembled leaf fields)", () => {
    const css = cssTheme({
      shadow: { offsetY: 1, blur: 2, color: "colors.shadow", responsive: [{ breakpoint: "md", offsetY: 4, blur: 12, color: "colors.shadow" }] },
    }).css;
    expect(css).toContain("--app-effects-shadow: 0px 4px 12px var(--app-colors-shadow);");
  });

  it("composes a structured appearance-mode (`modes`) override into the mode blocks", () => {
    const css = cssTheme(
      { shadow: { offsetY: 1, blur: 2, color: "colors.shadow", modes: [{ mode: "dark", offsetY: 2, blur: 8, color: "colors.shadowDark" }] } },
      { shadow: "#101010", shadowDark: "#f0f0f0" },
    ).css;
    // Both the OS-preference media block and the manual [data-theme] block redefine the base var.
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect((css.match(/--app-effects-shadow: 0px 2px 8px var\(--app-colors-shadowdark\);/g) ?? []).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// JSON adapter — struct emission (§15.4)
// ---------------------------------------------------------------------------

describe("§15 JSON — struct emission", () => {
  it("emits the structured value as data with the color ref preserved", () => {
    const theme = createTheme(
      { breakpoints: { md: 768 }, colors: { shadow: "#101010" }, effects: { shadow: { offsetY: 1, blur: 2, color: "colors.shadow" } } } as never,
      { adapter: createJsonAdapter() },
    ) as unknown as { json: { tokens?: Record<string, { struct?: unknown }> } };
    expect(theme.json.tokens!["effects.shadow"].struct).toEqual([
      { offsetY: { value: 1, unit: "px" }, blur: { value: 2, unit: "px" }, color: "colors.shadow" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// DTCG export — struct → composed string at the boundary (§15.3)
// ---------------------------------------------------------------------------

describe("§15 DTCG — export", () => {
  it("composes a structured shadow to a string with its color ref resolved to a literal", () => {
    const theme = createTheme(
      { breakpoints: { md: 768 }, colors: { shadow: "#101010" }, effects: { shadow: { offsetY: 1, blur: 2, color: "colors.shadow" } } } as never,
      { adapter: createCssAdapter() },
    );
    const doc = toDTCG(theme) as { shadow?: { $type?: string; base?: { $value?: unknown } } };
    expect(doc.shadow!.$type).toBe("shadow");
    expect(doc.shadow!.base!.$value).toBe("0px 1px 2px rgb(16, 16, 16)");
  });
});

// ---------------------------------------------------------------------------
// Coerce validation (§15.1)
// ---------------------------------------------------------------------------

describe("§15 coerce — validation", () => {
  it("rejects an unknown shadow field inside a layer (array form)", () => {
    // A flat top-level key that isn't a leaf field is a `TExtra` sibling (§15.2), not an error; a
    // typo INSIDE a layer object (an array-valued variant) is validated by coerce and rejected.
    expect(() => cssTheme({ shadow: { variants: { x: [{ offsetY: 1, blurr: 2 }] } } })).toThrow(
      /unknown shadow field "blurr"/,
    );
  });

  it("accepts a pinned length-string offset (§21/§22) but rejects a non-length string", () => {
    // "1px" is a pinned dimension → resolves verbatim (unchanged by a rem theme).
    const css = cssTheme({ shadow: { offsetY: "1px", blur: 2, color: "colors.shadow" } }).css;
    expect(css).toMatch(/--[\w-]*effects-shadow:\s*0px 1px 2px/);
    // a non-length string (function / keyword) still throws.
    expect(() => cssTheme({ shadow: { offsetY: "calc(1px + 2px)" } })).toThrow(/offsetY must be a number or a <number><unit>/);
  });

  it("requires a transition `property`", () => {
    expect(() => cssTheme({ transitions: { duration: 100 } })).toThrow(/property is required/);
  });

  it("rejects a raw CSS shadow string (only the `none` keyword is allowed)", () => {
    expect(() => cssTheme({ shadow: "0 1px 3px rgba(0,0,0,0.1)" })).toThrow(/raw CSS strings are not accepted/);
  });

  it("rejects a raw CSS transition string (only the `none` keyword is allowed)", () => {
    expect(() => cssTheme({ transitions: "all 150ms ease" })).toThrow(/raw CSS strings are not accepted/);
  });

  it("accepts the `none` keyword as a whole-property value", () => {
    const css = cssTheme({ shadow: "none" }).css;
    expect(css).toContain("--app-effects-shadow: none;");
  });
});
