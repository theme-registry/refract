import { describe, it, expect } from "vitest";
import { createTheme, defineAdapter } from "../src/core";
import type { AdapterSpec, ThemeModel, RenderContext } from "../src/core";
import { lighten, darken } from "../src/subsystems/colors/utils";

/**
 * Step 0d gate — the walking skeleton wires `raw → normalize → Model → adapter.bind`.
 * Asserts the colors property slice of `theme.model` (recipes/structural land step 1+),
 * NOT the full golden `model.test.ts.snap`.
 */

/** A trivial stub adapter with no-op render primitives; records that `bind` ran + its args. */
function stubAdapter() {
  const calls: Array<{ model: ThemeModel; ctx: RenderContext }> = [];
  const spec: AdapterSpec<string> = {
    name: "stub",
    version: 1,
    bind: (model, ctx) => {
      calls.push({ model, ctx });
      return {
        recipeName: () => "",
        renderRecipe: () => "",
        renderVariables: () => "",
        join: () => "",
      };
    },
  };
  return { adapter: defineAdapter(spec), calls };
}

const RAW = {
  breakpoints: { sm: 0, md: 768 },
  colors: {
    recipes: { solid: { primary: { color: "primary" } } }, // reserved — must be excluded
    primary: "#4dabf7",
    surface: { base: "#ffffff", text: "#111111" },
  },
} as const;

describe("createTheme (0d walking skeleton)", () => {
  it("builds theme.model.subsystems.colors.properties from the raw colors slice", () => {
    const { adapter } = stubAdapter();
    const theme = createTheme(RAW, { adapter });

    const colors = theme.model.subsystems.colors;
    expect(colors).toBeDefined();

    // `recipes` is a reserved key — never a property; it becomes a rule-set group instead.
    expect(Object.keys(colors.properties!).sort()).toEqual(["primary", "surface"]);
    // Palette recipe refs are pure token paths (no baked value) — matching the OLD Model shape;
    // inline delivery resolves the literal from the variable nodes, not a ref-side value.
    expect(colors.ruleSets!.solid.primary.declarations).toEqual({
      color: { ref: "colors.primary" },
    });
  });

  it("carries base + synthesized derived-step variants for a bare colour", () => {
    const { adapter } = stubAdapter();
    const theme = createTheme(RAW, { adapter });

    const primary = theme.model.subsystems.colors.properties!.primary;
    expect(primary.base).toEqual({ value: "rgb(77, 171, 247)" });

    expect(Object.keys(primary.variants!)).toEqual(["light", "lighter", "dark", "darker"]);
    expect(primary.variants!.light.base).toEqual({ // dec.3 — variant is { base, extras? }
      ref: "colors.primary",
      fn: "lighten",
      arg: 10,
      value: lighten("#4dabf7", 10),
    });
    expect(primary.variants!.dark.base).toEqual({
      ref: "colors.primary",
      fn: "darken",
      arg: 10,
      value: darken("#4dabf7", 10),
    });
  });

  it("keeps sibling extras (colors' text) on the property model", () => {
    const { adapter } = stubAdapter();
    const theme = createTheme(RAW, { adapter });

    const surface = theme.model.subsystems.colors.properties!.surface;
    expect(surface.base).toEqual({ value: "rgb(255, 255, 255)" });
    expect(surface.extras).toEqual({ text: { value: "rgb(17, 17, 17)" } });
  });

  it("threads breakpoints through to the Model", () => {
    const { adapter } = stubAdapter();
    const theme = createTheme(RAW, { adapter });
    expect(theme.model.breakpoints).toEqual({ sm: 0, md: 768 });
  });

  it("binds the adapter once with the Model + a media/resolve context", () => {
    const { adapter, calls } = stubAdapter();
    const theme = createTheme(RAW, { adapter });

    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe(theme.model);
    expect(typeof calls[0].ctx.media.min).toBe("function");
    expect(typeof calls[0].ctx.resolve).toBe("function");
  });
});
