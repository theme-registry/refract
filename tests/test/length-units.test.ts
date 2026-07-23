/**
 * §21 — length units resolved format-neutrally in core (the `units` build config on `createTheme`),
 * baked onto the Model's length leaves, then stringified by the CSS + SCSS adapters. Supersedes §16's
 * per-adapter `length` option. Default (no `units`) tags px only → golden stays byte-identical; this
 * file pins the `rem` conversion, per-role resolution, value-level pinning, and the untouched kinds.
 */
import { describe, it, expect } from "vitest";
import { createTheme } from "@theme-registry/refract";
import { createCssAdapter } from "@theme-registry/refract-css";
import { createScssAdapter } from "@theme-registry/refract-scss";
import { toDTCG } from "@theme-registry/refract/dtcg";

const raw = {
  breakpoints: { sm: 576, md: 768 },
  colors: {
    shadow: { base: "#000000" },
  },
  typography: {
    fontSize: { base: 16, variants: { lg: 24 } },
    lineHeight: { base: 1.5 }, // seed 'none' → stays unit-less, never a length
    letterSpacing: { base: 0, variants: { tight: "-0.02em" } }, // seed 'em'; variant pinned
  },
  effects: {
    blur: { base: 4, variants: { lg: 12 } },
    opacity: { base: 1, variants: { muted: 0.5 } }, // unit-less
    zIndex: { base: 0, variants: { modal: 1300 } }, // unit-less
    shadow: { offsetY: 2, blur: 8, color: "colors.shadow" },
    transitions: { property: "all", duration: 160, timingFunction: "ease" }, // ms = time
  },
  borders: {
    width: { base: 2 },
    radius: { base: 8, variants: { pill: "9999px" } }, // variant pinned px
  },
  layout: {
    spacing: { base: 16, variants: { tight: 4 } },
  },
};

/** A rem theme via the global default; letterSpacing keeps its `em` seed, lineHeight stays unit-less. */
const buildRem = (adapter: unknown) =>
  createTheme(raw as never, { adapter, units: { default: "rem" }, baseFontSize: 16 } as never);

describe("§21 default (no units) — px, byte-identical", () => {
  const { css } = createTheme(raw as never, {
    adapter: createCssAdapter({ prefix: "app" }),
  }) as never as { css: string };

  it("length leaves tag px (value unchanged)", () => {
    expect(css).toContain("--app-typography-fontsize: 16px;");
    expect(css).toContain("--app-borders-width: 2px;");
    expect(css).toContain("--app-layout-spacing: 16px;");
    expect(css).toContain("--app-effects-blur: 4px;");
  });
  it("shadow geometry tags px; absent offsetX defaults to 0px", () => {
    expect(css).toContain("--app-effects-shadow: 0px 2px 8px var(--app-colors-shadow);");
  });
  it("a pinned unit passes through verbatim", () => {
    expect(css).toContain("--app-borders-radius-pill: 9999px;");
    expect(css).toContain("--app-typography-letterspacing-tight: -0.02em;");
  });
  it("letterSpacing base is em (seed), lineHeight stays unit-less", () => {
    expect(css).toContain("--app-typography-letterspacing: 0em;");
    expect(css).toContain("--app-typography-lineheight: 1.5;");
  });
});

describe("§21 units.default = rem — deferred length converts", () => {
  const css = (buildRem(createCssAdapter({ prefix: "app" })) as unknown as { css: string }).css;

  it("typography fontSize → rem (value ÷ baseFontSize)", () => {
    expect(css).toContain("--app-typography-fontsize: 1rem;");
    expect(css).toContain("--app-typography-fontsize-lg: 1.5rem;");
  });
  it("effects blur → rem", () => {
    expect(css).toContain("--app-effects-blur: 0.25rem;");
    expect(css).toContain("--app-effects-blur-lg: 0.75rem;");
  });
  it("effects structured shadow geometry → rem (color ref intact)", () => {
    expect(css).toContain("--app-effects-shadow: 0rem 0.125rem 0.5rem var(--app-colors-shadow);");
  });
  it("borders width → rem; a pinned px radius stays px", () => {
    expect(css).toContain("--app-borders-width: 0.125rem;");
    expect(css).toContain("--app-borders-radius: 0.5rem;");
    expect(css).toContain("--app-borders-radius-pill: 9999px;"); // pinned — never converted
  });
  it("layout spacing → rem", () => {
    expect(css).toContain("--app-layout-spacing: 1rem;");
    expect(css).toContain("--app-layout-spacing-tight: 0.25rem;");
  });
  it("letterSpacing keeps its em seed even under a rem default", () => {
    expect(css).toContain("--app-typography-letterspacing-tight: -0.02em;");
  });
});

describe("§21 units.default = rem — non-length kinds untouched", () => {
  const css = (buildRem(createCssAdapter({ prefix: "app" })) as unknown as { css: string }).css;

  it("transition duration stays ms (time, not length)", () => {
    expect(css).toContain("--app-effects-transitions: all 160ms ease;");
  });
  it("opacity + zIndex stay unit-less", () => {
    expect(css).toContain("--app-effects-opacity-muted: 0.5;");
    expect(css).toContain("--app-effects-zindex-modal: 1300;");
  });
  it("lineHeight stays unit-less (seed none beats the rem default)", () => {
    expect(css).toContain("--app-typography-lineheight: 1.5;");
  });
});

describe("§21 per-role grain — subsystem + property keys", () => {
  it("rem fonts + px borders in one theme (subsystem grain)", () => {
    const css = (
      createTheme(raw as never, {
        adapter: createCssAdapter({ prefix: "app" }),
        units: { typography: "rem", borders: "px" },
      } as never) as unknown as { css: string }
    ).css;
    expect(css).toContain("--app-typography-fontsize: 1rem;");
    expect(css).toContain("--app-borders-width: 2px;"); // borders held at px
  });
  it("property grain beats subsystem grain", () => {
    const css = (
      createTheme(raw as never, {
        adapter: createCssAdapter({ prefix: "app" }),
        units: { typography: "rem", "typography.fontSize": "px" },
      } as never) as unknown as { css: string }
    ).css;
    expect(css).toContain("--app-typography-fontsize: 16px;"); // property override wins
  });
});

describe("§21 SCSS adapter parity", () => {
  const scss = (
    buildRem(createScssAdapter({ prefix: "app" })) as unknown as { variablesScss: string }
  ).variablesScss;

  it("length token values convert to rem, matching the CSS adapter", () => {
    expect(scss).toContain(": 1rem;"); // fontSize 16 / layout spacing 16
    expect(scss).toContain(": 0.25rem;"); // blur 4 / spacing tight 4
    expect(scss).toContain(": 0.125rem;"); // borders width 2
    expect(scss).toContain(": 0.5rem;"); // borders radius 8
  });
  it("unit-less values stay raw (opacity)", () => {
    expect(scss).toContain(": 0.5;"); // opacity muted — no unit
  });
});

describe("§21 DTCG export parity — resolved unit, not hardcoded px", () => {
  const doc = toDTCG(buildRem(createCssAdapter({ prefix: "app" })) as never, { name: "rem" }) as never as Record<
    string,
    any
  >;

  it("blur exports the resolved rem unit (§21 — was hardcoded px)", () => {
    expect(doc.blur.$type).toBe("dimension");
    expect(doc.blur.base).toEqual({ $value: "0.25rem" });
    expect(doc.blur.lg).toEqual({ $value: "0.75rem" });
  });
  it("shadow geometry composes in the resolved rem unit", () => {
    expect(doc.shadow.$type).toBe("shadow");
    expect(doc.shadow.base.$value).toContain("0rem 0.125rem 0.5rem");
  });
  it("default (no units) keeps px", () => {
    const pxDoc = toDTCG(
      createTheme(raw as never, { adapter: createCssAdapter({ prefix: "app" }) }) as never,
      { name: "px" },
    ) as never as Record<string, any>;
    expect(pxDoc.blur.base).toEqual({ $value: "4px" });
    expect(pxDoc.blur.lg).toEqual({ $value: "12px" });
  });
});
