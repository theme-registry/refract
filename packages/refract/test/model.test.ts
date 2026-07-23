import { describe, it, expect } from "vitest";
import {
  buildPropertyModel,
  buildPropertiesModel,
  buildRuleSetFromInterpreted,
  buildRuleSetGroupFromInterpreted,
  buildComponentRuleSetFromInterpreted,
  pathifyRuleSetGroup,
  pathifyProperties,
  extractComponentReferences,
  buildThemeModel,
  buildTokenMap,
} from "../src/core/model";
import type {
  NormalizedPropertyValue,
  InterpretedRecipeVariant,
  PropertyModel,
  Ref,
} from "../src/core/model";

// Hand-built normalized/interpreted inputs — Step 0c is unit-gated (no createTheme
// pipeline yet), so these exercise the pure builders directly and assert Model shape.

// ── buildPropertyModel ──────────────────────────────────────────────────────

describe("buildPropertyModel", () => {
  it("wraps a bare literal base as a value Ref", () => {
    const normalized: NormalizedPropertyValue<string> = { base: "#fff", responsive: [] };
    expect(buildPropertyModel(normalized)).toEqual({ base: { value: "#fff" } });
  });

  it("collects scalar sibling extras (e.g. colors' text)", () => {
    const normalized = {
      base: "#111",
      text: "#eee",
      responsive: [],
    } as NormalizedPropertyValue<string, { text: string }>;
    expect(buildPropertyModel(normalized)).toEqual({
      base: { value: "#111" },
      extras: { text: { value: "#eee" } },
    });
  });

  it("maps plain literal variants", () => {
    const normalized = {
      base: "#111",
      responsive: [],
      variants: { muted: { base: "#999" } },
    } as NormalizedPropertyValue<string>;
    expect(buildPropertyModel(normalized)).toEqual({
      base: { value: "#111" },
      variants: { muted: { base: { value: "#999" } } }, // dec.3 — variant is { base, extras? }
    });
  });

  it("stores a derived variant as { ref, fn, arg, value } keeping the baked value", () => {
    const normalized = {
      base: "#3366ff",
      responsive: [],
      variants: {
        light: {
          base: "#5c85ff",
          derive: { ref: "colors.primary", fn: "lighten", arg: 20 },
        },
      },
    } as NormalizedPropertyValue<string>;
    expect(buildPropertyModel(normalized).variants).toEqual({
      light: { base: { ref: "colors.primary", fn: "lighten", arg: 20, value: "#5c85ff" } },
    });
  });

  it("maps responsive entries entry-for-entry (variant swap, target, overrides)", () => {
    const normalized = {
      base: "16px",
      responsive: [
        { breakpoint: "md", query: "min", base: "18px" },
        { breakpoint: "lg", query: "min", ref: "loud" },
        { breakpoint: "sm", query: "max", target: "muted", base: "12px" },
      ],
    } as NormalizedPropertyValue<string>;
    expect(buildPropertyModel(normalized).responsive).toEqual([
      { breakpoint: "md", query: "min", overrides: { base: { value: "18px" } } },
      { breakpoint: "lg", query: "min", ref: "loud" },
      { breakpoint: "sm", query: "max", target: "muted", overrides: { base: { value: "12px" } } },
    ]);
  });
});

describe("buildPropertiesModel", () => {
  it("maps a whole collection name → PropertyModel", () => {
    const collection = {
      primary: { base: "#111", responsive: [] },
      accent: { base: "#f0f", responsive: [] },
    } as Record<string, NormalizedPropertyValue<string>>;
    expect(buildPropertiesModel(collection)).toEqual({
      primary: { base: { value: "#111" } },
      accent: { base: { value: "#f0f" } },
    });
  });
});

// ── buildRuleSetFromInterpreted ─────────────────────────────────────────────

describe("buildRuleSetFromInterpreted", () => {
  it("copies ref + literal declarations structurally (no var-string parsing)", () => {
    const variant: InterpretedRecipeVariant<string> = {
      base: {
        color: { ref: "colors.primary", value: "#4dabf7" },
        padding: { value: "12px 20px" },
      },
      responsive: [],
    };
    expect(buildRuleSetFromInterpreted(variant)).toEqual({
      kind: "recipe",
      declarations: {
        color: { ref: "colors.primary", value: "#4dabf7" },
        padding: { value: "12px 20px" },
      },
      overrides: [],
    });
  });

  it("carries a wrapped ref (blur compound) as { ref, wrap } without a var string", () => {
    const variant: InterpretedRecipeVariant<string> = {
      base: { backdropFilter: { ref: "effects.blur", wrap: "blur" } },
      responsive: [],
    };
    expect(buildRuleSetFromInterpreted(variant).declarations).toEqual({
      backdropFilter: { ref: "effects.blur", wrap: "blur" },
    });
  });

  it("maps state + breakpoint overrides with their declarations", () => {
    const variant: InterpretedRecipeVariant<string> = {
      base: { color: { ref: "colors.primary" } },
      responsive: [
        { state: "hover", declarations: { color: { ref: "colors.primary.dark" } } },
        { breakpoint: "md", query: "min", declarations: { padding: { value: "16px" } } },
      ],
    };
    expect(buildRuleSetFromInterpreted(variant).overrides).toEqual([
      { state: "hover", declarations: { color: { ref: "colors.primary.dark" } } },
      { breakpoint: "md", query: "min", declarations: { padding: { value: "16px" } } },
    ]);
  });
});

describe("buildRuleSetGroupFromInterpreted", () => {
  it("maps every variant in a group", () => {
    const group = {
      solid: { base: { color: { ref: "colors.primary" } }, responsive: [] },
      ghost: { base: { color: { ref: "colors.muted" } }, responsive: [] },
    };
    const out = buildRuleSetGroupFromInterpreted(group);
    expect(Object.keys(out)).toEqual(["solid", "ghost"]);
    expect(out.ghost.declarations).toEqual({ color: { ref: "colors.muted" } });
  });
});

// ── components ──────────────────────────────────────────────────────────────

describe("extractComponentReferences", () => {
  it("extracts subsystem:group.variant refs from a variant base", () => {
    expect(
      extractComponentReferences({
        colors: "solid.primary",
        effects: "elevation.card",
        label: "Save",
      }),
    ).toEqual(["colors:solid.primary", "effects:elevation.card"]);
  });

  it("ignores non-dotted / non-subsystem values", () => {
    expect(extractComponentReferences({ colors: "primary", title: "x" })).toEqual([]);
  });
});

describe("buildComponentRuleSetFromInterpreted", () => {
  it("attaches cross-subsystem references and keeps kind recipe", () => {
    const variant: InterpretedRecipeVariant<string> = {
      base: { boxShadow: { ref: "effects.shadow" } },
      responsive: [],
    };
    expect(
      buildComponentRuleSetFromInterpreted(variant, ["colors:solid.primary"]),
    ).toEqual({
      kind: "recipe",
      references: ["colors:solid.primary"],
      declarations: { boxShadow: { ref: "effects.shadow" } },
      overrides: [],
    });
  });
});

// ── pathify ─────────────────────────────────────────────────────────────────

describe("pathifyRuleSetGroup", () => {
  it("rewrites declaration refs via the map, leaving unmapped ones", () => {
    const group = buildRuleSetGroupFromInterpreted({
      solid: {
        base: { color: { ref: "--dt-color--primary" }, background: { ref: "--unmapped" } },
        responsive: [{ state: "hover", declarations: { color: { ref: "--dt-color--primary-dark" } } }],
      },
    });
    const out = pathifyRuleSetGroup(group, {
      "--dt-color--primary": "colors.primary",
      "--dt-color--primary-dark": "colors.primary.dark",
    });
    expect(out.solid.declarations).toEqual({
      color: { ref: "colors.primary" },
      background: { ref: "--unmapped" },
    });
    expect(out.solid.overrides[0].declarations).toEqual({
      color: { ref: "colors.primary.dark" },
    });
  });
});

describe("pathifyProperties", () => {
  it("rewrites base/variants/extras refs via the map", () => {
    const properties: Record<string, PropertyModel> = {
      gutter: {
        base: { ref: "--dt-layout--gutter" },
        variants: { wide: { base: { ref: "--dt-layout--gutter-wide" } } },
        extras: { inset: { ref: "--dt-layout--inset" } },
      },
    };
    const out = pathifyProperties(properties, {
      "--dt-layout--gutter": "layout.gutter",
      "--dt-layout--gutter-wide": "layout.gutter.wide",
      "--dt-layout--inset": "layout.inset",
    });
    expect(out.gutter).toEqual({
      base: { ref: "layout.gutter" },
      variants: { wide: { base: { ref: "layout.gutter.wide" } } },
      extras: { inset: { ref: "layout.inset" } },
    });
  });
});

// ── assembly + token map ────────────────────────────────────────────────────

describe("buildThemeModel", () => {
  it("assembles subsystems, dropping empty slices, and keeps breakpoints", () => {
    const model = buildThemeModel({
      breakpoints: { sm: 640, md: 768 },
      colors: {
        properties: {
          primary: { base: "#111", responsive: [] } as NormalizedPropertyValue<string>,
        },
        ruleSetGroups: {
          button: buildRuleSetGroupFromInterpreted({
            solid: { base: { color: { ref: "colors.primary" } }, responsive: [] },
          }),
        },
      },
      effects: undefined,
      components: {
        ruleSetGroups: {
          card: {
            elevated: buildComponentRuleSetFromInterpreted(
              { base: { boxShadow: { ref: "effects.shadow" } }, responsive: [] },
              ["colors:solid.primary"],
            ),
          },
        },
      },
    });

    expect(model.breakpoints).toEqual({ sm: 640, md: 768 });
    expect(Object.keys(model.subsystems)).toEqual(["colors", "components"]);
    expect(model.subsystems.colors.properties!.primary).toEqual({ base: { value: "#111" } });
    expect(model.subsystems.colors.ruleSets!.button.solid.declarations).toEqual({
      color: { ref: "colors.primary" },
    });
    expect(model.subsystems.components.ruleSets!.card.elevated.references).toEqual([
      "colors:solid.primary",
    ]);
  });

  it("merges extraProperties after the normalized properties", () => {
    const model = buildThemeModel({
      breakpoints: {},
      layout: {
        properties: {
          spacing: { base: "8px", responsive: [] } as NormalizedPropertyValue<string>,
        },
        extraProperties: {
          columns: { base: { value: 12 } } as PropertyModel,
        },
      },
    });
    expect(Object.keys(model.subsystems.layout.properties!)).toEqual(["spacing", "columns"]);
  });
});

describe("buildTokenMap", () => {
  it("flattens property tokens into path → Ref (base, variants, extras); excludes rule-sets", () => {
    const model = buildThemeModel({
      breakpoints: {},
      colors: {
        properties: {
          primary: {
            base: "#111",
            text: "#eee",
            responsive: [],
            variants: { light: { base: "#5c85ff" } },
          } as NormalizedPropertyValue<string, { text: string }>,
        },
        ruleSetGroups: {
          button: buildRuleSetGroupFromInterpreted({
            solid: { base: { color: { ref: "colors.primary" } }, responsive: [] },
          }),
        },
      },
    });
    const tokens = buildTokenMap(model);
    expect(tokens).toEqual<Record<string, Ref>>({
      "colors.primary": { value: "#111" },
      "colors.primary.light": { value: "#5c85ff" },
      "colors.primary.text": { value: "#eee" },
    });
  });
});
