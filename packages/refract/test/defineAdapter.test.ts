import { describe, it, expect } from "vitest";
import { defineAdapter } from "../src/core";
import type { AdapterSpec, RenderContext, ThemeModel } from "../src/core";

/** Minimal Model: two subsystems, three rule-sets, in a known order. */
const model: ThemeModel = {
  breakpoints: { md: 768 },
  subsystems: {
    colors: {
      ruleSets: {
        solid: {
          primary: { declarations: {}, overrides: [] },
          danger: { declarations: {}, overrides: [] },
        },
      },
    },
    layout: {
      ruleSets: {
        grid: { base: { declarations: {}, overrides: [] } },
      },
    },
  },
};

const ctx = {} as RenderContext;

/** Trivial string adapter — renders identifiable markers so joins are observable. */
const spec: AdapterSpec<string> = {
  name: "fake",
  version: 1,
  bind: () => ({
    recipeName: (s, g, v) => `${s}-${g}-${v}`,
    renderRecipe: (s, g, v) => `R(${s}.${g}.${v})`,
    renderVariables: s => `V(${s})`,
    join: parts => parts.join("|"),
  }),
};

describe("defineAdapter", () => {
  const adapter = defineAdapter(spec);
  const bound = adapter.bind(model, ctx);

  it("passes name / version through", () => {
    expect(adapter.name).toBe("fake");
    expect(adapter.version).toBe(1);
  });

  it("defaults renderAllRecipes — join over every rule-set, in Model order", () => {
    expect(bound.renderAllRecipes()).toBe(
      "R(colors.solid.primary)|R(colors.solid.danger)|R(layout.grid.base)",
    );
  });

  it("defaults renderAllVariables — join over every subsystem", () => {
    expect(bound.renderAllVariables()).toBe("V(colors)|V(layout)");
  });

  it("defaults renderAll — variables then recipes", () => {
    expect(bound.renderAll()).toBe(
      "V(colors)|V(layout)|R(colors.solid.primary)|R(colors.solid.danger)|R(layout.grid.base)",
    );
  });

  it("lets a spec override a defaulted aggregator", () => {
    const overridden = defineAdapter<string>({
      ...spec,
      bind: (m, c) => ({ ...spec.bind(m, c), renderAll: () => "CUSTOM" }),
    });
    expect(overridden.bind(model, ctx).renderAll()).toBe("CUSTOM");
  });
});
