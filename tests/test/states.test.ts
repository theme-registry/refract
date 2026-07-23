/**
 * States + composition — the clean-room Phase B Step 4 gate.
 *
 * Ports `test/states.test.ts` onto the clean-room pipeline (`createTheme(raw, { adapter })`). The
 * four `*.snap` assertions are byte-identical to the frozen `test/__snapshots__/states.test.ts.snap`
 * (the snapshot file is copied verbatim into `test/next/__snapshots__/`), proving the clean-room
 * reproduces the OLD states + composition output exactly. Non-snapshot assertions are adapted to
 * the clean-room surface (`theme.classes.components.…` / `theme.renderRecipe(subsystem, …)`).
 *
 * Verifies end-to-end:
 *   1. a grouped `states: { hover, disabled }` map → `:hover` / `[disabled]` rules on the class;
 *   2. a state × breakpoint cross-product (`responsive: [{ breakpoint, state }]`) → `@media { :hover }`;
 *   3. composition — a component reuses the referenced recipe's class (its `:hover` rides along)
 *      and emits its OWN `:hover` delta on its own class;
 *   4. the adapter owns the state→selector table + known-state validation (threaded into core).
 */
import { describe, it, expect } from "vitest";
import { createTheme } from "@theme-registry/refract";
import { createCssAdapter } from "@theme-registry/refract-css";
import type { RecipeVariantDefinition } from "@theme-registry/refract";
import { statesTheme } from "@theme-registry/theme-fixtures";

// Compile-time guard (enforced by `tsc`): a recipe-prop type with a string index
// signature must NOT clobber the reserved `states` / `responsive` keys — authoring
// them must typecheck WITHOUT a cast. Before the fix, `states`/`responsive` collapsed
// to `undefined` under the index signature and this failed to compile.
type _DemoProps = { background?: string; [property: string]: string | undefined };
const _typedRecipeVariant: RecipeVariantDefinition<_DemoProps> = {
  background: "primary",
  states: { hover: { background: "dark" }, disabled: { background: "light" } },
  responsive: [{ breakpoint: "md", state: "hover", background: "light" }],
};
void _typedRecipeVariant;

// The OLD `createTheme` read the colors options under the legacy `palette` key; the states fixture
// supplies them under `colors`, so in the OLD they were INERT and colors fell back to its `dt`
// defaults (`--dt-color--*`, `.dt-color-*` in the frozen snapshot). The clean-room adapter reads the
// renamed `colors` key — so to reproduce the frozen output byte-for-byte we mirror the OLD's
// effective config: colors defaulted (option omitted), effects + components applied.
const adapter = () => createCssAdapter();
const theme = () =>
  createTheme(statesTheme.rawTheme, { adapter: adapter() }) as any;

describe("states — CSS output", () => {
  it("recipesCss snapshot", () => {
    expect(theme().recipesCss).toMatchSnapshot();
  });

  it("full css snapshot", () => {
    expect(theme().css).toMatchSnapshot();
  });

  it("renders a pure-state override as `selector:hover`", () => {
    expect(theme().recipesCss).toContain(
      ".dt-colors-solid-primary:hover {\n  background: var(--dt-colors-primary-dark);\n}",
    );
  });

  it("maps `disabled` to an attribute selector `[disabled]`", () => {
    expect(theme().recipesCss).toContain(
      ".dt-colors-solid-primary[disabled] {\n  background: var(--dt-colors-primary-light);\n  color: var(--dt-colors-primary);\n}",
    );
  });

  it("renders a state × breakpoint cross-product as `@media { :hover }`", () => {
    const css = theme().recipesCss;
    expect(css).toContain("@media (min-width: 768px) and (max-width: 1023.98px) {");
    // The `md` `:hover` rule sits inside the media block.
    expect(css).toMatch(
      /@media \(min-width: 768px\) and \(max-width: 1023\.98px\) \{\n {2}\.dt-colors-solid-primary:hover \{\n {4}background: var\(--dt-colors-primary-light\);/,
    );
  });

  it("orders the base `:hover` before its `@media` breakpoint variant (cascade)", () => {
    const css = theme().recipesCss;
    const baseHover = css.indexOf(".dt-colors-solid-primary:hover {\n  background: var(--dt-colors-primary-dark)");
    const mediaHover = css.indexOf("@media (min-width: 768px) and (max-width: 1023.98px)");
    expect(baseHover).toBeGreaterThanOrEqual(0);
    expect(mediaHover).toBeGreaterThan(baseHover);
  });

  it("orders states canonically (hover before disabled)", () => {
    const css = theme().recipesCss;
    expect(css.indexOf(":hover")).toBeLessThan(css.indexOf("[disabled]"));
  });

  it("supports states on a non-component recipe (effects)", () => {
    expect(theme().recipesCss).toContain(
      ".dt-effects-card-default:hover {\n  box-shadow: var(--dt-effects-shadow-lg);\n}",
    );
  });
});

describe("states — composition", () => {
  it("component reuses the referenced recipe class (its :hover rides along)", () => {
    const className = theme().classes.components.buttons.primary.className;
    expect(className).toBe("dt-colors-solid-primary dt-components-buttons-primary");
  });

  it("exposes the component classList (referenced recipe class + own delta class)", () => {
    const classList = theme().classes.components.buttons.primary.classList;
    expect(classList).toEqual(["dt-colors-solid-primary", "dt-components-buttons-primary"]);
  });

  it("emits the component's OWN :hover delta on its own class", () => {
    expect(theme().recipesCss).toContain(
      ".dt-components-buttons-primary:hover {\n  box-shadow: 0 6px 16px rgba(0,0,0,0.2);\n}",
    );
  });

  it("component's own :hover comes after the referenced recipe's :hover (own wins on conflict)", () => {
    const css = theme().recipesCss;
    const referencedHover = css.indexOf(".dt-colors-solid-primary:hover");
    const ownHover = css.indexOf(".dt-components-buttons-primary:hover");
    expect(referencedHover).toBeGreaterThanOrEqual(0);
    expect(ownHover).toBeGreaterThan(referencedHover);
  });
});

describe("states — renderRecipe (per-recipe delivery)", () => {
  // Guards that per-recipe delivery (lazy / per-component mount) includes the recipe's state
  // rules, not just its base declarations.
  it("colors renderRecipe includes the recipe's :hover and [disabled] rules", () => {
    const css = theme().renderRecipe("colors", "solid", "primary") as string;
    expect(css).toContain(".dt-colors-solid-primary:hover");
    expect(css).toContain(".dt-colors-solid-primary[disabled]");
  });

  it("colors renderRecipe includes the state × breakpoint @media rule", () => {
    const css = theme().renderRecipe("colors", "solid", "primary") as string;
    expect(css).toContain("@media (min-width: 768px) and (max-width: 1023.98px)");
  });

  it("components renderRecipe includes the component's own :hover delta", () => {
    const css = theme().renderRecipe("components", "buttons", "primary") as string;
    expect(css).toContain(".dt-components-buttons-primary:hover");
  });
});

describe("states — Model", () => {
  it("colors solid.primary rule-set (states + cross-product) snapshot", () => {
    expect(theme().model.subsystems.colors.ruleSets.solid.primary).toMatchSnapshot();
  });

  it("component buttons.primary rule-set (own hover delta + references) snapshot", () => {
    expect(theme().model.subsystems.components.ruleSets.buttons.primary).toMatchSnapshot();
  });

  it("component keeps the cross-subsystem reference (inherits the referenced overrides)", () => {
    const rs = theme().model.subsystems.components.ruleSets.buttons.primary;
    expect(rs.references).toContain("colors:solid.primary");
    // The component's own overrides carry only its own delta (the inherited hover rides on the
    // referenced class, not duplicated here).
    expect(rs.overrides).toEqual([
      { state: "hover", declarations: { "box-shadow": { value: "0 6px 16px rgba(0,0,0,0.2)" } } },
    ]);
  });

  it("carries kind: 'recipe' metadata on rule-sets", () => {
    const t = theme();
    expect(t.model.subsystems.colors.ruleSets.solid.primary.kind).toBe("recipe");
    expect(t.model.subsystems.components.ruleSets.buttons.primary.kind).toBe("recipe");
  });

  it("keeps no var( string anywhere in theme.model's components slice (core is CSS-independent)", () => {
    expect(JSON.stringify(theme().model.subsystems.components)).not.toContain("var(");
  });
});

describe("states — validation", () => {
  it("throws on an unknown state name", () => {
    const bad = {
      breakpoints: { md: 768 },
      colors: {
        primary: { base: "#000", text: "#fff" },
        recipes: { solid: { primary: { background: "primary", states: { wiggle: { background: "primary" } } } } },
      },
    };
    expect(() => createTheme(bad as Record<string, unknown>, { adapter: createCssAdapter() })).toThrow(
      /unknown state "wiggle"/,
    );
  });
});

describe("dec.8 — recipe state `target` (scope onto a sibling variant)", () => {
  const build = (raw: Record<string, unknown>) =>
    createTheme(raw as any, { adapter: createCssAdapter({ prefix: "dt" }) }) as any;

  const raw = {
    colors: {
      primary: { base: "#4dabf7", variants: { dark: "#1c7ed6" } },
      accent: { base: "#f76707" },
      recipes: {
        solid: {
          primary: {
            background: "primary",
            // §7A variant → sibling `.dt-colors-solid-primary-lg`
            variants: { lg: { background: "primary.dark" } },
            states: [
              { state: "hover", background: "primary.dark" },        // base + inherited by the lg sibling
              { state: "hover", target: "lg", background: "accent" }, // dec.8 — scoped ONLY to the lg sibling
            ],
          },
        },
      },
    },
  };

  it("emits the targeted state against the sibling selector, winning over the inherited state", () => {
    const css = build(raw).recipesCss as string;
    // base hover on the base class
    expect(css).toContain(".dt-colors-solid-primary:hover {\n  background: var(--dt-colors-primary-dark);\n}");
    // the lg sibling inherits the base hover…
    const inheritedIdx = css.indexOf(".dt-colors-solid-primary-lg:hover {\n  background: var(--dt-colors-primary-dark);");
    // …and the targeted hover overrides it with `accent`, emitted LATER so it wins.
    const targetedIdx = css.indexOf(".dt-colors-solid-primary-lg:hover {\n  background: var(--dt-colors-accent);");
    expect(inheritedIdx).toBeGreaterThanOrEqual(0);
    expect(targetedIdx).toBeGreaterThan(inheritedIdx);
  });

  it("does NOT re-target a non-existent sibling (targeted states scope one-way, not re-inherited)", () => {
    const css = build(raw).recipesCss as string;
    // the sibling must never spawn a `<sibling>-<target>` (`primary-lg-lg`) selector.
    expect(css.includes("primary-lg-lg")).toBe(false);
  });

  it("validates a state `target` against the sibling set (unknown target throws)", () => {
    const bad = {
      colors: {
        primary: { base: "#4dabf7" },
        recipes: {
          solid: {
            primary: {
              background: "primary",
              variants: { lg: { background: "primary" } },
              states: [{ state: "hover", target: "nope", background: "primary" }],
            },
          },
        },
      },
    };
    expect(() => build(bad)).toThrow(/unknown target "nope"/);
  });
});
