/**
 * §12 Phase 3 — subsystem participation in the unified grammar.
 *
 * Phase 1 made the override-array grammar generic in core, so every subsystem inherits it. This suite
 * verifies that participation per subsystem-class that isn't already exercised elsewhere:
 *   - dec.6 — an `external` property is referenceable FROM recipes (colours recipe prop + component
 *     `css` ref), resolving directly to the parent var (external "usable in recipes");
 *   - a REGULAR subsystem (borders / layout) honours the `modes` LIST → a `[data-theme]` block;
 *   - a REGULAR subsystem honours a derived length ramp step (layout scaleStep) — the derivation-ref
 *     storage the new grammar shares.
 * (colours modes/derivations/cross-property → `refract-css/test/modes.test.ts`; effects structured
 *  modes/variants → `effects-structured.test.ts`; typography modes → `modes.test.ts`; recipe flat
 *  variant + state `target` → `recipe-variants.test.ts` / `states.test.ts`.)
 */
import { describe, it, expect } from "vitest";
import { createTheme, ref } from "@theme-registry/refract";
import { createCssAdapter } from "@theme-registry/refract-css";

const build = (raw: Record<string, unknown>) =>
  createTheme(raw as any, { adapter: createCssAdapter({ prefix: "dt" }) }) as any;

describe("dec.6 — external property is usable in recipes (both ref surfaces)", () => {
  const t = () =>
    build({
      extends: { prefix: "dt" },
      colors: {
        brand: { external: "colors.parentBrand" }, // borrows a parent-owned var
        recipes: { solid: { primary: { background: "brand" } } },
      },
      components: {
        recipes: {
          buttons: {
            primary: { colors: "solid.primary", css: { color: ref("colors.brand"), outline: "none" } },
          },
        },
      },
    });

  it("a colours recipe prop referencing an external palette lowers to the parent var", () => {
    expect(t().css).toContain(".dt-colors-solid-primary {\n  background: var(--dt-colors-parentbrand);\n}");
  });

  it("a component `css` ref to an external palette lowers to the parent var", () => {
    expect(t().css).toContain("color: var(--dt-colors-parentbrand);");
  });

  it("the external palette itself emits NO local :root definition (the parent owns it)", () => {
    expect(t().css.includes("--dt-colors-brand:")).toBe(false);
  });
});

describe("regular subsystems honour the modes LIST", () => {
  it("a borders.width mode emits a [data-theme] block redefining the var", () => {
    const css = build({
      borders: { width: { base: 1, modes: [{ mode: "dark", base: 2 }] } },
    }).css as string;
    expect(css).toContain(':root[data-theme="dark"] {');
    expect(css).toContain("--dt-borders-width: 2px;");
  });

  it("a layout.spacing mode emits a [data-theme] block", () => {
    const css = build({
      layout: { spacing: { base: 8, modes: [{ mode: "dark", base: 12 }] } },
    }).css as string;
    expect(css).toContain(':root[data-theme="dark"] {');
    expect(css).toContain("--dt-layout-spacing: 12px;");
  });
});

describe("regular subsystems store derived ramp steps as re-derivable refs (shared grammar)", () => {
  it("a layout spacing ramp keeps each step a derived Ref so override() re-derives", () => {
    const parent = build({
      layout: { spacing: { base: 8, ratio: 2, steps: ["sm", "md", "lg"] } },
    });
    const sm = parent.model.subsystems.layout.properties.spacing.variants.sm;
    // stored as a derived Ref (ref + fn/arg), not an opaque literal
    expect(sm.base.ref).toBeTruthy();
    // overriding the base re-derives the ramp for free
    const child = parent.override({ layout: { spacing: { base: 16, ratio: 2, steps: ["sm", "md", "lg"] } } });
    const parentMd = parent.resolveToken("layout.spacing.md");
    const childMd = child.resolveToken("layout.spacing.md");
    expect(childMd).not.toBe(parentMd);
  });
});
