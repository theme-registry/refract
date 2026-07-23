/**
 * Globals subsystem (§9 — the renamed, upgraded `reset`).
 *
 * Covers the preset expansion (static literal layer + default `h1`–`h6` → type-scale map, unchanged
 * `kind:"reset"` `:where()` lowering + opportunistic drop), the new themed `elements` surface
 * (`kind:"globals"`: bare-selector base rules at a higher tier, `states`/`responsive` overrides, and
 * delta-only `variants` scoped as `a.subtle`), the up-front unresolved-ref throw, and override re-flow.
 */
import { describe, it, expect } from "vitest";
import { createTheme, ref } from "@theme-registry/refract";
import { createCssAdapter } from "../src";

// A small theme WITH a ratio-generated fontSize scale, so h1–h6 bind to real scale steps.
const scaleTheme = {
  colors: {
    surface: { base: "#ffffff", text: "#111111" },
    link: { base: "#1c7ed6", text: "#fff", variants: { hover: "#1971c2", muted: "#868e96" } },
  },
  typography: {
    fontSize: { base: 16, ratio: "major-third" as const },
  },
};

const build = (raw: Record<string, unknown>, options: Record<string, unknown> = {}) =>
  createTheme({ ...scaleTheme, ...raw } as any, {
    adapter: createCssAdapter({ prefix: "dt", ...options }),
  }) as any;

describe("globals — preset expansion into the Model", () => {
  it("no globals slice → no globals subsystem, byte-identical", () => {
    const theme = build({});
    expect(theme.model.subsystems.globals).toBeUndefined();
    expect(theme.css.includes(":where(")).toBe(false);
  });

  it("a preset expands into static + default heading groups", () => {
    const theme = build({ globals: { preset: "preflight" } });
    const globals = theme.model.subsystems.globals;
    expect(globals).toBeDefined();
    expect(Object.keys(globals.ruleSets)).toEqual(["static", "defaults"]);

    // Static layer: literal declarations on raw selectors, kind:"reset".
    const box = globals.ruleSets.static.box;
    expect(box.kind).toBe("reset");
    expect(box.selector).toBe("*,::before,::after");
    expect(box.declarations["box-sizing"]).toEqual({ value: "border-box" });

    // Default heading layer: token-path refs into the generated fontSize scale, still kind:"reset".
    expect(globals.ruleSets.defaults.h1.kind).toBe("reset");
    expect(globals.ruleSets.defaults.h1.selector).toBe("h1");
    expect(globals.ruleSets.defaults.h1.declarations["font-size"]).toEqual({
      ref: "typography.fontSize.4xl",
    });
  });

  it("normalize preset omits the default heading map", () => {
    const theme = build({ globals: { preset: "normalize" } });
    expect(Object.keys(theme.model.subsystems.globals.ruleSets)).toEqual(["static"]);
  });

  it("an unknown preset name throws", () => {
    expect(() => build({ globals: { preset: "bogus" } })).toThrow(/unknown preset "bogus"/);
  });

  it("a bare { elements } slice (no preset) emits only the themed element group", () => {
    const theme = build({ globals: { elements: { a: { color: ref("colors.link") } } } });
    expect(Object.keys(theme.model.subsystems.globals.ruleSets)).toEqual(["elements"]);
  });

  it("preset:false disables the static + default layers, keeping elements", () => {
    const theme = build({ globals: { preset: false, elements: { a: { color: ref("colors.link") } } } });
    expect(Object.keys(theme.model.subsystems.globals.ruleSets)).toEqual(["elements"]);
  });
});

describe("globals — themed element Model shape", () => {
  const theme = build({
    globals: {
      elements: {
        a: {
          color: ref("colors.link"),
          textDecoration: "underline",
          states: { hover: { color: ref("colors.link.hover") } },
          responsive: [{ breakpoint: "md", query: "min", fontSize: ref("typography.fontSize.lg") }],
          variants: { subtle: { color: ref("colors.link.muted"), states: { hover: { color: ref("colors.link") } } } },
        },
      },
    },
  });
  const el = theme.model.subsystems.globals.ruleSets.elements.a;

  it("an element is one kind:'globals' rule-set keyed by its selector", () => {
    expect(el.kind).toBe("globals");
    expect(el.selector).toBe("a");
    // Ref-first leaves: bare string → ref, { css } → literal value.
    expect(el.declarations.color).toEqual({ ref: "colors.link" });
    expect(el.declarations["text-decoration"]).toEqual({ value: "underline" });
  });

  it("states + responsive flatten into the overrides list", () => {
    const hover = el.overrides.find((o: any) => o.state === "hover");
    expect(hover.declarations.color).toEqual({ ref: "colors.link.hover" });
    const bp = el.overrides.find((o: any) => o.breakpoint === "md");
    expect(bp.query).toBe("min");
    expect(bp.declarations["font-size"]).toEqual({ ref: "typography.fontSize.lg" });
  });

  it("variants stay structural (delta-only) with their own overrides — NOT §7A siblings", () => {
    expect(theme.model.subsystems.globals.ruleSets.elements["a-subtle"]).toBeUndefined();
    const subtle = el.variants.subtle;
    expect(subtle.declarations.color).toEqual({ ref: "colors.link.muted" });
    expect(subtle.overrides[0].state).toBe("hover");
    expect(subtle.overrides[0].declarations.color).toEqual({ ref: "colors.link" });
  });
});

describe("globals — CSS adapter lowering", () => {
  it("preset layers wrap each selector in :where() at specificity-0", () => {
    const css = build({ globals: { preset: "preflight" } }).css;
    expect(css).toContain(":where(*,::before,::after) {");
    expect(css).toContain(":where(h1) {");
    expect(css).toContain("box-sizing: border-box;");
  });

  it("themed headings resolve to the fontSize scale vars", () => {
    const css = build({ globals: { preset: "preflight" } }).css;
    expect(css).toContain(":where(h1) {\n  font-size: var(--dt-typography-fontsize-4xl);\n}");
    expect(css).toContain(":where(h6) {\n  font-size: var(--dt-typography-fontsize-md);\n}");
  });

  it("themed elements render as BARE selectors (higher tier), never :where()", () => {
    // Elements-only (no preset) → the ONLY selectors are the themed elements, so a stray :where()
    // would mean they were wrongly wrapped at the reset tier.
    const css = build({
      globals: { elements: { body: { color: ref("colors.surface.text") }, a: { color: ref("colors.link") } } },
    }).css;
    expect(css).toContain("body {\n  color: var(--dt-colors-surface-text);\n}");
    expect(css).toContain("a {\n  color: var(--dt-colors-link);\n}");
    expect(css).not.toContain(":where(");
  });

  it("states → sel:state, responsive → @media, variant → self-scoped sel.variant", () => {
    const css = build({
      globals: {
        elements: {
          a: {
            color: ref("colors.link"),
            states: { hover: { color: ref("colors.link.hover") } },
            responsive: [{ breakpoint: "md", query: "min", color: ref("colors.link.muted") }],
            variants: { subtle: { color: ref("colors.link.muted"), states: { hover: { color: ref("colors.link") } } } },
          },
        },
      },
    }).css;
    expect(css).toContain("a {\n  color: var(--dt-colors-link);\n}");
    expect(css).toContain("a:hover {\n  color: var(--dt-colors-link-hover);\n}");
    expect(css).toContain("@media (min-width: 768px) {\n  a {\n    color: var(--dt-colors-link-muted);\n  }\n}");
    expect(css).toContain("a.subtle {\n  color: var(--dt-colors-link-muted);\n}");
    expect(css).toContain("a.subtle:hover {\n  color: var(--dt-colors-link);\n}");
  });

  it("a grouped selector scopes the variant per comma-part", () => {
    const css = build({
      globals: { elements: { "h1,h2": { color: ref("colors.surface.text"), variants: { hero: { color: ref("colors.link") } } } } },
    }).css;
    expect(css).toContain("h1.hero,h2.hero {");
  });

  it("preset layers are hoisted ahead of every recipe/variable block", () => {
    const theme = build({
      globals: { preset: "preflight" },
      colors: { ...scaleTheme.colors, recipes: { solid: { primary: { background: "surface" } } } },
    });
    const firstReset = theme.css.indexOf(":where(");
    const firstRoot = theme.css.indexOf(":root");
    expect(firstReset).toBe(0);
    expect(firstReset).toBeLessThan(firstRoot);
  });
});

describe("globals — unresolved-ref policy", () => {
  it("drops default heading steps the scale did not generate (no ratio)", () => {
    // No ratio → no scale variants → every default h1–h6 ref is unresolvable → all dropped.
    const theme = createTheme(
      { typography: { fontSize: { base: 16 } }, globals: { preset: "preflight" } } as any,
      { adapter: createCssAdapter({ prefix: "dt" }) },
    ) as any;
    expect(theme.css).toContain(":where(h1,h2,h3,h4,h5,h6) {"); // static heading strip still there
    expect(theme.css).not.toContain(":where(h1) {"); // no themed heading binding survived
  });

  it("throws up-front (createTheme) on an unresolved user elements ref", () => {
    expect(() => build({ globals: { elements: { a: { color: ref("colors.nope") } } } })).toThrow(
      /globals element 'a'.*references unknown token 'colors.nope'/,
    );
  });

  it("throws on an unresolved ref inside a variant delta", () => {
    expect(() =>
      build({ globals: { elements: { a: { color: ref("colors.link"), variants: { x: { color: ref("colors.nope") } } } } } }),
    ).toThrow(/globals element 'a' \(variant 'x'\).*references unknown token 'colors.nope'/);
  });
});

describe("globals — override re-flow", () => {
  it("override({ globals: { elements } }) inherits the parent preset and adds the delta", () => {
    const parent = build({ globals: { preset: "preflight" } });
    const child = parent.override({ globals: { elements: { a: { color: ref("colors.link") } } } });

    // Parent untouched (no bare themed `a` rule).
    expect(parent.css).not.toContain("\na {\n  color: var(--dt-colors-link);");
    // Child keeps the inherited static + default groups AND gains the elements group.
    expect(Object.keys(child.model.subsystems.globals.ruleSets)).toEqual(["static", "defaults", "elements"]);
    expect(child.css).toContain("\na {\n  color: var(--dt-colors-link);\n}");
    expect(child.css).toContain(":where(*,::before,::after) {");
  });

  it("overriding the typography base re-derives the scale that headings bind to", () => {
    const parent = build({ globals: { preset: "preflight" } });
    const child = parent.override({ typography: { fontSize: { base: 20, ratio: "major-third" } } });
    expect(child.css).toContain(":where(h1) {\n  font-size: var(--dt-typography-fontsize-4xl);\n}");
    const parent4xl = parent.resolveToken("typography.fontSize.4xl");
    const child4xl = child.resolveToken("typography.fontSize.4xl");
    expect(child4xl).not.toBe(parent4xl);
  });
});
