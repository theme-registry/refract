/**
 * Phase B, Step 5 gate — `theme.override(partial)`: an immutable, delta-only Model merge.
 *
 * `override` normalizes ONLY the partial's changed subsystem slices, immutably merges those Model
 * fragments into the current Model, and re-assembles onto the NEW Model. The proofs:
 *   1. the child reflects the delta end-to-end — Model + tokens + css;
 *   2. the parent is byte-identical before and after (real child themes, not mutation);
 *   3. overriding a colour base re-derives its synthesized steps (they're derived refs) — no color
 *      math in the override code, just re-resolution;
 *   4. a rule-set / component delta merges without disturbing untouched groups (structural sharing);
 *   5. no raw retention — a recipe delta resolves its refs against the parent's Model-reconstructed
 *      properties (there is no stored raw), and `resolveToken` re-resolves with no stale cache.
 *
 * Config mirrors `golden.test.ts`'s full reactSc build (colors option omitted → `dt` defaults, as
 * the OLD read colors under the legacy `palette` key). `danger` authors only base+text, so it
 * carries fully-synthesized (derived-ref) `light/lighter/dark/darker` steps — the re-derivation probe.
 */
import { describe, it, expect } from "vitest";
import { createTheme } from "@theme-registry/refract";
import type { Theme } from "@theme-registry/refract";
import { createCssAdapter } from "../src";
import { lighten, darken } from "@theme-registry/refract/color-math";
import { reactSc } from "@theme-registry/theme-fixtures";

type CssTheme = Theme & {
  css: string;
  variablesCss: string;
  recipesCss: string;
  nodes: unknown[];
  classes: {
    components: Record<string, Record<string, { className: string; classList: string[] }>>;
  };
};

const build = (): CssTheme =>
  createTheme(reactSc.rawTheme, {
    adapter: createCssAdapter({ prefix: "app" }),
  }) as unknown as CssTheme;

describe("override — base delta re-derives synthesized steps end-to-end", () => {
  it("child Model carries the new base + re-derived derived-ref steps", () => {
    const parent = build();
    const child = parent.override({ colors: { danger: { base: "#ee0000", text: "#fff" } } }) as CssTheme;

    const danger = child.model.subsystems.colors!.properties!.danger;
    expect(danger.base).toEqual({ value: "rgb(238, 0, 0)" });
    // Steps stay derived refs, re-baked to the NEW base's resolution.
    expect(danger.variants!.dark.base).toEqual({
      ref: "colors.danger",
      fn: "darken",
      arg: 10,
      value: darken("#ee0000", 10),
    });
    expect(danger.variants!.light.base).toEqual({
      ref: "colors.danger",
      fn: "lighten",
      arg: 10,
      value: lighten("#ee0000", 10),
    });
  });

  it("child tokens + resolveToken follow the new base (no stale cache); parent still on the old base", () => {
    const parent = build();
    const child = parent.override({ colors: { danger: { base: "#ee0000", text: "#fff" } } });

    expect(child.tokens["colors.danger"]).toEqual({ value: "rgb(238, 0, 0)" });
    expect(child.resolveToken("colors.danger.dark")).toBe(darken("#ee0000", 10));
    // chained: darker = darken(dark)
    expect(child.resolveToken("colors.danger.darker")).toBe(darken(darken("#ee0000", 10), 10));

    // The parent resolves against its ORIGINAL base — proof the child didn't mutate shared state.
    expect(parent.tokens["colors.danger"]).toEqual({ value: "rgb(255, 107, 107)" });
    expect(parent.resolveToken("colors.danger.dark")).toBe(darken("#ff6b6b", 10));
  });

  it("child css reflects the new base + re-derived step values", () => {
    const parent = build();
    const child = parent.override({ colors: { danger: { base: "#ee0000", text: "#fff" } } }) as CssTheme;

    expect(child.variablesCss).toContain("--app-colors-danger: rgb(238, 0, 0);");
    expect(child.variablesCss).toContain(`--app-colors-danger-dark: ${darken("#ee0000", 10)};`);
    expect(child.variablesCss).not.toContain("--app-colors-danger: rgb(255, 107, 107);");
  });
});

describe("override — parent stays byte-identical (real child themes)", () => {
  it("parent css / variablesCss / recipesCss / nodes / tokens are unchanged after deriving a child", () => {
    const parent = build();
    const cssBefore = parent.css;
    const variablesBefore = parent.variablesCss;
    const recipesBefore = parent.recipesCss;
    const nodesBefore = JSON.stringify(parent.nodes);
    const tokensBefore = JSON.stringify(parent.tokens);
    const modelBefore = JSON.stringify(parent.model);

    parent.override({ colors: { danger: { base: "#ee0000", text: "#fff" } } });
    parent.override({ components: { recipes: { buttons: { primary: { css: { border: "3px solid red" } } } } } });

    expect(parent.css).toBe(cssBefore);
    expect(parent.variablesCss).toBe(variablesBefore);
    expect(parent.recipesCss).toBe(recipesBefore);
    expect(JSON.stringify(parent.nodes)).toBe(nodesBefore);
    expect(JSON.stringify(parent.tokens)).toBe(tokensBefore);
    expect(JSON.stringify(parent.model)).toBe(modelBefore);
  });

  it("produces genuinely new Model objects for touched branches; shares untouched ones", () => {
    const parent = build();
    const child = parent.override({ colors: { danger: { base: "#ee0000", text: "#fff" } } });

    // New Model + new touched subsystem; the parent's references are preserved.
    expect(child.model).not.toBe(parent.model);
    expect(child.model.subsystems.colors).not.toBe(parent.model.subsystems.colors);
    // Untouched subsystems share their reference (structural sharing — no re-normalization).
    expect(child.model.subsystems.typography).toBe(parent.model.subsystems.typography);
    expect(child.model.subsystems.layout).toBe(parent.model.subsystems.layout);
    expect(child.model.subsystems.effects).toBe(parent.model.subsystems.effects);
    expect(child.model.subsystems.components).toBe(parent.model.subsystems.components);
    // Within colors: the untouched palette entries + rule-sets keep their references.
    expect(child.model.subsystems.colors!.properties!.primary).toBe(
      parent.model.subsystems.colors!.properties!.primary,
    );
    expect(child.model.subsystems.colors!.ruleSets).toBe(parent.model.subsystems.colors!.ruleSets);
  });
});

describe("override — rule-set / component delta merges without disturbing untouched groups", () => {
  it("component delta replaces only the touched variant; sibling variants + groups shared", () => {
    const parent = build();
    const child = parent.override({
      components: {
        recipes: {
          buttons: {
            primary: {
              colors: "solid.primary",
              typography: "button.large",
              layout: "padding.button-lg",
              effects: "card.default",
              css: { cursor: "pointer", border: "3px solid red" },
            },
          },
        },
      },
    }) as CssTheme;

    const parentComp = parent.model.subsystems.components!.ruleSets!;
    const childComp = child.model.subsystems.components!.ruleSets!;

    // Touched group + variant are new; untouched siblings/groups are the same reference.
    expect(childComp.buttons).not.toBe(parentComp.buttons);
    expect(childComp.buttons.primary).not.toBe(parentComp.buttons.primary);
    expect(childComp.buttons.danger).toBe(parentComp.buttons.danger);
    expect(childComp.cards).toBe(parentComp.cards);
    expect(childComp.badges).toBe(parentComp.badges);

    // The delta's css reaches the output; the referenced classList (composition) is preserved.
    expect(child.recipesCss).toContain("border: 3px solid red;");
    expect(child.classes.components.buttons.primary.classList).toEqual([
      "app-colors-solid-primary",
      "app-typography-button-large",
      "app-layout-padding-button-lg",
      "app-effects-card-default",
      "app-components-buttons-primary",
    ]);
    // Parent keeps its original delta (`border: none`).
    expect(parent.recipesCss).toContain("border: none;");
  });

  it("colors recipe delta resolves refs against the parent's Model-reconstructed properties (no raw)", () => {
    const parent = build();
    // The partial carries ONLY the recipe — `danger` / `primary.dark` must resolve from the parent
    // Model (there is no retained raw theme).
    const child = parent.override({
      colors: { recipes: { outline: { primary: { borderColor: "danger", color: "primary.dark" } } } },
    }) as CssTheme;

    const outline = child.model.subsystems.colors!.ruleSets!.outline.primary;
    expect(outline.declarations["border-color"]).toEqual({ ref: "colors.danger" });
    expect(outline.declarations["color"]).toEqual({ ref: "colors.primary.dark" });

    // Untouched: the solid group + colors properties keep their references (properties not re-normalized).
    expect(child.model.subsystems.colors!.ruleSets!.solid).toBe(
      parent.model.subsystems.colors!.ruleSets!.solid,
    );
    expect(child.model.subsystems.colors!.properties).toBe(parent.model.subsystems.colors!.properties);

    // The refs lower to the right vars in the child's css.
    expect(child.recipesCss).toContain("border-color: var(--app-colors-danger);");
    // Parent's outline is untouched (original `primary` borderColor).
    expect(parent.recipesCss).toContain("border-color: var(--app-colors-primary);");
  });
});

describe("override — effects property delta (retires the old per-subsystem staleness class)", () => {
  // The generic merge means one subsystem proves all, but overriding a NON-colors, NON-composition
  // subsystem directly closes the old review's "effects-setter staleness" finding — that path is
  // gone with the old tree; the delta-merge reflects the change with no stale cache.
  it("child reflects a new borders radius base end-to-end; parent stays on the old value", () => {
    const parent = build();
    const child = parent.override({
      borders: {
        radius: { base: 10, variants: { none: 0, sm: 4, lg: 12, xl: 16, full: "9999px" } },
      },
    }) as CssTheme;

    // Token + model follow the new base.
    expect(child.tokens["borders.radius"]).toEqual({ value: 10, unit: "px" });
    expect(child.model.subsystems.borders!.properties!.radius.base).toEqual({ value: 10, unit: "px" });
    // CSS re-flows (no stale cache); parent keeps 6px.
    expect(child.variablesCss).toContain("--app-borders-radius: 10px;");
    expect(parent.variablesCss).toContain("--app-borders-radius: 6px;");
    expect(child.variablesCss).not.toContain("--app-borders-radius: 6px;");

    // Structural sharing: only borders is a new branch; the rest keep their references.
    expect(child.model.subsystems.borders).not.toBe(parent.model.subsystems.borders);
    expect(child.model.subsystems.colors).toBe(parent.model.subsystems.colors);
    expect(child.model.subsystems.layout).toBe(parent.model.subsystems.layout);
  });
});

describe("override — chaining + independence", () => {
  it("children are independent (siblings from one parent don't interfere)", () => {
    const parent = build();
    const red = parent.override({ colors: { danger: { base: "#ee0000", text: "#fff" } } });
    const green = parent.override({ colors: { danger: { base: "#00aa00", text: "#fff" } } });

    expect(red.resolveToken("colors.danger")).toBe("rgb(238, 0, 0)");
    expect(green.resolveToken("colors.danger")).toBe("rgb(0, 170, 0)");
    expect(parent.resolveToken("colors.danger")).toBe("rgb(255, 107, 107)");
  });

  it("a child can be overridden again (grandchild), leaving the child intact", () => {
    const parent = build();
    const child = parent.override({ colors: { danger: { base: "#ee0000", text: "#fff" } } }) as CssTheme;
    const grandchild = child.override({ colors: { success: { base: "#00ff88", text: "#fff" } } }) as CssTheme;

    // Grandchild carries both deltas.
    expect(grandchild.resolveToken("colors.danger")).toBe("rgb(238, 0, 0)");
    expect(grandchild.resolveToken("colors.success")).toBe("rgb(0, 255, 136)");
    // Child kept its own success (original) and its danger delta.
    expect(child.resolveToken("colors.success")).toBe("rgb(81, 207, 102)");
    expect(child.resolveToken("colors.danger")).toBe("rgb(238, 0, 0)");
  });
});
