/**
 * Container queries (§10.5) — the last styling-matrix capability gap.
 *
 * Container queries are a **condition axis** (not a subsystem): they ride the recipe `responsive`
 * override list via a `{ container, size }` discriminator, and the CSS adapter lowers them to
 * `@container` rules (rule/recipe overrides only — never `:root` tokens). Covers: the top-level
 * `containers` config → `.dt-cq-<name>` context class + Model; the container query lowering (default
 * `min`, `max`/`exact` band-to-next); the viewport axis staying intact; the shared media `unit`
 * config (D6) on both axes; the D5 orientation throw; unknown container/size throws; override
 * re-flow; and the additive/byte-identical guard.
 */
import { describe, it, expect } from "vitest";
import { createTheme } from "@theme-registry/refract";
import { createCssAdapter } from "../src";
import { mergeComponentRuleSet } from "@theme-registry/refract";

const raw = {
  breakpoints: { md: 900 },
  containers: { card: { type: "inline-size" as const, sizes: { sm: 280, md: 400, lg: 560 } } },
  colors: {
    surface: { base: "#ffffff" },
    primary: { base: "#3b82f6", text: "#ffffff" },
    recipes: {
      solid: {
        primary: {
          background: "primary",
          color: "primary.text",
          responsive: [
            { container: "card", size: "md", background: "surface" }, // default query = min
            { container: "card", size: "sm", query: "max" as const, color: "surface" }, // band to md
            { container: "card", size: "md", query: "exact" as const, borderColor: "primary" }, // md..lg band
            { breakpoint: "md", outlineColor: "primary" }, // viewport axis, unchanged
          ],
        },
      },
    },
  },
};

const build = (opts: Record<string, unknown> = {}) =>
  createTheme(raw as any, { adapter: createCssAdapter({ prefix: "dt" }), ...opts }) as any;

describe("container queries — additive guard", () => {
  it("no containers config → no context class, no @container, byte-identical", () => {
    const theme = createTheme(
      { colors: { surface: { base: "#fff" } } } as any,
      { adapter: createCssAdapter({ prefix: "dt" }) },
    ) as any;
    expect(theme.model.containers).toBeUndefined();
    expect(theme.css.includes("@container")).toBe(false);
    expect(theme.css.includes("-cq-")).toBe(false);
  });
});

describe("container queries — config + context class", () => {
  const theme = build();

  it("normalizes the containers config onto the Model (type defaults inline-size)", () => {
    expect(theme.model.containers).toEqual({
      card: { type: "inline-size", sizes: { sm: 280, md: 400, lg: 560 } },
    });
  });

  it("emits a .dt-cq-<name> context class (container-type + container-name)", () => {
    expect(theme.css).toContain(".dt-cq-card {\n  container-type: inline-size;\n  container-name: card;\n}");
    expect(theme.classes.containers).toEqual({ context: { card: "dt-cq-card" } });
  });

  it("container-type: size is honored (D2)", () => {
    const t = createTheme(
      { containers: { panel: { type: "size", sizes: { md: 400 } } }, colors: { a: { base: "#000" } } } as any,
      { adapter: createCssAdapter() },
    ) as any;
    expect(t.css).toContain("container-type: size;");
  });
});

describe("container queries — lowering", () => {
  const css = build().css;

  it("a container override → an @container rule (default query = min)", () => {
    expect(css).toContain("@container card (min-width: 400px) {\n  .dt-colors-solid-primary {\n    background: var(--dt-colors-surface);\n  }\n}");
  });

  it("max/exact use the band-to-next logic (symmetric with the viewport axis)", () => {
    // size sm, query max → up to just before md (400 − ε)
    expect(css).toContain("@container card (max-width: 399.98px) {");
    // size md, query exact → md band up to just before lg
    expect(css).toContain("@container card (min-width: 400px) and (max-width: 559.98px) {");
  });

  it("the viewport axis still emits @media alongside", () => {
    expect(css).toContain("@media (min-width: 900px) {");
    expect(css).toContain("outline-color: var(--dt-colors-primary);");
  });
});

describe("container queries — media unit config (D6)", () => {
  it("unit:em applies to BOTH the viewport and container axes", () => {
    const css = build({ media: { unit: "em", baseFontSize: 16 } }).css;
    expect(css).toContain("@media (min-width: 56.25em) {"); // 900 / 16
    expect(css).toContain("@container card (min-width: 25em) {"); // 400 / 16
  });
});

describe("container queries — validation", () => {
  const recipeWith = (override: Record<string, unknown>) =>
    ({
      containers: raw.containers,
      colors: { primary: { base: "#3b82f6" }, recipes: { solid: { primary: { background: "primary", responsive: [override] } } } },
    }) as any;

  it("orientation on a container condition throws (D5)", () => {
    expect(() => createTheme(recipeWith({ container: "card", size: "md", orientation: "landscape" }), { adapter: createCssAdapter() }).css)
      .toThrow(/cannot use "orientation"/);
  });

  it("an unknown container name throws", () => {
    expect(() => createTheme(recipeWith({ container: "nope", size: "md" }), { adapter: createCssAdapter() }).css)
      .toThrow(/unknown container "nope"/);
  });

  it("an unknown size on a known container throws", () => {
    expect(() => createTheme(recipeWith({ container: "card", size: "xl" }), { adapter: createCssAdapter() }).css)
      .toThrow(/unknown size "xl"/);
  });
});

describe("container queries — override re-flow", () => {
  it("overriding a container size re-flows every @container that references it; parent untouched", () => {
    const parent = build();
    const child = parent.override({ containers: { card: { sizes: { sm: 280, md: 500, lg: 560 } } } });
    expect(child.css).toContain("@container card (min-width: 500px) {");
    expect(child.css.includes("@container card (min-width: 400px) {")).toBe(false);
    // Parent unchanged (immutable derive).
    expect(parent.css).toContain("@container card (min-width: 400px) {");
  });
});

// ── §10.5 follow-ups (A2 animation, A3 components merge) ──

describe("container queries — animation recipes (A2)", () => {
  it("an animation recipe container override lowers to @container with the composed shorthand", () => {
    const theme = createTheme(
      {
        containers: { card: { type: "inline-size", sizes: { md: 400 } } },
        animation: {
          duration: { base: 300, variants: { fast: 150 } },
          easing: { base: "ease" },
          keyframes: { fadeIn: { from: { opacity: 0 }, to: { opacity: 1 } } },
          recipes: {
            entrance: {
              fade: {
                keyframes: "fadeIn",
                duration: "base",
                responsive: [{ container: "card", size: "md", duration: "fast" }],
              },
            },
          },
        },
      } as any,
      { adapter: createCssAdapter() },
    ) as any;
    expect(theme.css).toContain("@container card (min-width: 400px) {");
    // the override re-composes the shorthand with the fast duration
    expect(theme.css).toMatch(/@container card \(min-width: 400px\) \{\s*\.dt-animation-entrance-fade \{\s*animation: var\(--dt-animation-duration-fast\)/);
  });
});

describe("container queries — components merge (A3)", () => {
  // A component references a colors recipe that carries a container override; the flattened merge
  // must route it to a conditioned bucket, NOT fold it into base (the pre-fix correctness bug).
  const model = createTheme(
    {
      containers: { card: { type: "inline-size", sizes: { md: 400 } } },
      colors: {
        surface: { base: "#ffffff" },
        primary: { base: "#3b82f6", text: "#ffffff" },
        recipes: {
          solid: {
            primary: {
              background: "primary",
              color: "primary.text",
              responsive: [{ container: "card", size: "md", background: "surface" }],
            },
          },
        },
      },
      components: {
        recipes: { buttons: { primary: { colors: "solid.primary", css: { cursor: "pointer" } } } },
      },
    } as any,
    { adapter: createCssAdapter() },
  ).model;

  it("routes a referenced recipe's container override to a container bucket (not base)", () => {
    const merged = mergeComponentRuleSet(model, "buttons", "primary");
    // base carries the unconditional declarations only — NOT the container override's `background`.
    expect(merged.base.background).toEqual({ ref: "colors.primary" });
    // the container override lands in a conditioned bucket, tagged container/size.
    const containerBucket = merged.responsive.find(e => e.container === "card");
    expect(containerBucket).toBeDefined();
    expect(containerBucket!.size).toBe("md");
    expect(containerBucket!.breakpoint).toBeUndefined();
    expect(containerBucket!.declarations.background).toEqual({ ref: "colors.surface" });
  });
});
