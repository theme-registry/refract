// §7A — recipe `variants` leaf. A pre-pass in the shared `normalizeRecipeGroup` expands an
// optional `variants` modifier map on any recipe into flat sibling recipes (`<recipe>-<variant>`),
// generic across every subsystem and gated on the `variants` key. These tests pin the per-field
// merge rules, the `null` removal sentinel, the collision guard, and — the whole point — that a
// `variants`-authored theme lowers byte-identically to its hand-flattened equivalent.
import { describe, it, expect } from "vitest";
import { normalizeRecipeGroup } from "@theme-registry/refract";
import { createTheme } from "@theme-registry/refract";
import { createCssAdapter } from "../src";

describe("recipe variants — mergeRecipe field rules", () => {
  it("emits the bare recipe PLUS one merged sibling per variant (`<recipe>-<variant>`)", () => {
    const group = normalizeRecipeGroup({
      primary: {
        colors: "solid.primary",
        variants: { sm: { typography: "button.small" } },
      },
    });

    expect(Object.keys(group)).toEqual(["primary", "primary-sm"]);
    // The bare recipe is unchanged (its `variants` key peeled off).
    expect(group.primary.base).toEqual({ colors: "solid.primary" });
  });

  it("a ref/scalar prop → delta replaces; unset props are inherited", () => {
    const group = normalizeRecipeGroup({
      primary: {
        colors: "solid.primary",
        effects: "card.default",
        variants: { alt: { colors: "solid.secondary" } },
      },
    });

    expect(group["primary-alt"].base).toEqual({
      colors: "solid.secondary", // replaced
      effects: "card.default", // inherited
    });
  });

  it("`css` → shallow merge by property (delta wins per property)", () => {
    const group = normalizeRecipeGroup({
      primary: {
        css: { cursor: "pointer", gap: "8px" },
        variants: { sm: { css: { gap: "6px" } } },
      },
    });

    expect(group["primary-sm"].base).toEqual({
      css: { cursor: "pointer", gap: "6px" },
    });
  });

  it("`states` → merge by state name (union; a shared state shallow-merges, delta wins)", () => {
    const group = normalizeRecipeGroup(
      {
        primary: {
          color: "#fff",
          states: { hover: { color: "#eee", background: "#000" } },
          variants: {
            active: { states: { hover: { color: "#ddd" }, focus: { color: "#ccc" } } },
          },
        },
      },
      { allowedStates: ["hover", "focus"] },
    );

    // States flatten into `responsive` overrides, each tagged with its `state`.
    expect(group["primary-active"].responsive).toEqual([
      { color: "#ddd", background: "#000", state: "hover" }, // shared: delta color wins, base background kept
      { color: "#ccc", state: "focus" }, // union: variant-only state added
    ]);
  });

  it("`responsive[]` → concatenate (base first, delta last = higher source order)", () => {
    const group = normalizeRecipeGroup(
      {
        primary: {
          color: "#fff",
          responsive: [{ breakpoint: "md", color: "#eee" }],
          variants: {
            active: { responsive: [{ breakpoint: "lg", color: "#ddd" }] },
          },
        },
      },
      { allowedBreakpoints: ["md", "lg"] },
    );

    expect(group["primary-active"].responsive).toEqual([
      { breakpoint: "md", color: "#eee", query: "exact" },
      { breakpoint: "lg", color: "#ddd", query: "exact" },
    ]);
  });
});

describe("recipe variants — null removal sentinel", () => {
  it("`null` drops an inherited ref; `\"none\"` stays a real value", () => {
    const group = normalizeRecipeGroup({
      primary: {
        colors: "solid.primary",
        borders: "box.default",
        css: { border: "none" },
        variants: { borderless: { borders: null } },
      },
    });

    const base = group["primary-borderless"].base as Record<string, unknown>;
    expect("borders" in base).toBe(false); // ref dropped
    expect(base).toEqual({
      colors: "solid.primary",
      css: { border: "none" }, // "none" is a real value — untouched
    });
  });
});

describe("recipe variants — collision guard", () => {
  it("throws when a desugared `<recipe>-<variant>` collides with an existing sibling", () => {
    expect(() =>
      normalizeRecipeGroup(
        {
          primary: { color: "#fff", variants: { sm: { color: "#eee" } } },
          "primary-sm": { color: "#000" },
        },
        { propertyPath: "components.recipes.buttons" },
      ),
    ).toThrow(/duplicate recipe name "primary-sm"/);
  });
});

// ── Genericity + the invariant: a `variants`-authored theme lowers byte-identically ─────────
// to the hand-flattened equivalent, across ≥2 subsystems in one build (colors + components).

const flattened = {
  breakpoints: { md: 768 },
  colors: {
    primary: { base: "#4dabf7", text: "#fff" },
    danger: { base: "#ff6b6b", text: "#fff" },
    recipes: {
      solid: {
        primary: { background: "primary", color: "primary.text" },
        "primary-danger": { background: "danger", color: "danger.text" },
      },
    },
  },
  components: {
    recipes: {
      buttons: {
        primary: {
          colors: "solid.primary",
          css: { cursor: "pointer", gap: "8px" },
        },
        "primary-sm": {
          colors: "solid.primary",
          css: { cursor: "pointer", gap: "6px" },
        },
      },
    },
  },
};

const withVariants = {
  breakpoints: { md: 768 },
  colors: {
    primary: { base: "#4dabf7", text: "#fff" },
    danger: { base: "#ff6b6b", text: "#fff" },
    recipes: {
      solid: {
        primary: {
          background: "primary",
          color: "primary.text",
          variants: { danger: { background: "danger", color: "danger.text" } },
        },
      },
    },
  },
  components: {
    recipes: {
      buttons: {
        primary: {
          colors: "solid.primary",
          css: { cursor: "pointer", gap: "8px" },
          variants: { sm: { css: { gap: "6px" } } },
        },
      },
    },
  },
};

describe("recipe variants — byte-identical desugaring across subsystems", () => {
  const build = (raw: unknown) =>
    createTheme(raw as any, { adapter: createCssAdapter() }) as any;

  it("colors + components: a `variants` theme emits the same CSS as the flat theme", () => {
    expect(build(withVariants).css).toBe(build(flattened).css);
  });

  it("emits the expected desugared classes for both subsystems", () => {
    const css: string = build(withVariants).css;
    // colors: solid.primary + desugared solid.primary-danger
    expect(css).toContain(".dt-colors-solid-primary");
    expect(css).toContain(".dt-colors-solid-primary-danger");
    // components: buttons.primary + desugared buttons.primary-sm
    expect(css).toContain(".dt-components-buttons-primary");
    expect(css).toContain(".dt-components-buttons-primary-sm");
  });
});
