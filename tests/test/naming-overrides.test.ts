// §7B — adapter naming-override hook. The two text adapters (CSS + SC) accept optional `className` /
// `variableName` formatters that swap how class + variable names are generated, wired into the two
// pure choke points so every emission site (var def + every `var(--…)`; class rule + resolved
// classList / component-ref lookup / theme.classes) stays consistent. Default naming is byte-identical.
// The adapter enforces the contract: deterministic · collision-free (throws) · valid identifier (sanitized).
import { describe, it, expect } from "vitest";
import { createTheme } from "@theme-registry/refract";
import { createCssAdapter } from "@theme-registry/refract-css";
import { createStyledComponentsAdapter } from "@theme-registry/refract-styled-components";
import { buildMediaDescriptor, mediaQueryString, resolveMediaConfig } from "@theme-registry/refract";

// A theme exercising all four surfaces: colours (vars + a recipe), a component that REFERENCES the
// colours recipe AND carries its own `css` delta, and a named query container (`kind:"container"`).
const raw = {
  breakpoints: { md: 768 },
  containers: { card: { type: "inline-size" as const, sizes: { sm: 280 } } },
  colors: {
    primary: { base: "#4dabf7", text: "#fff", variants: { dark: "#1c7ed6" } },
    recipes: {
      solid: { primary: { background: "primary", color: "primary.text" } },
    },
  },
  components: {
    recipes: {
      button: {
        primary: { colors: "solid.primary", css: { cursor: "pointer" } },
      },
    },
  },
};

const buildCss = (naming?: Record<string, unknown>) =>
  createTheme(raw as any, { adapter: createCssAdapter({ prefix: "dt", ...(naming ? { naming } : {}) }) }) as any;

describe("naming overrides — className remap (CSS)", () => {
  // Remap ONLY the components subsystem's classes; every other subsystem keeps the default.
  const naming = {
    className(
      address: { kind: string; subsystem: string; group: string; variant: string },
      defaults: { name: string },
    ) {
      return address.subsystem === "components"
        ? `app-${address.group}-${address.variant}`
        : defaults.name;
    },
  };
  const theme = buildCss(naming);

  it("remaps the targeted subsystem while others keep the default", () => {
    // components → remapped; colors → default.
    expect(theme.getClass("components", "button", "primary")).toContain("app-button-primary");
    expect(theme.getClass("colors", "solid", "primary")).toBe("dt-colors-solid-primary");
  });

  it("the SAME remapped name appears at definition, usage, classList, and theme.classes", () => {
    // (1) class DEFINITION — the own-delta rule selector in the emitted CSS.
    expect(theme.css).toContain(".app-button-primary {");
    // (2) resolved classList / component-ref lookup — referenced colours class + own remapped class.
    const leaf = theme.classes.components.button.primary;
    expect(leaf.classList).toEqual(["dt-colors-solid-primary", "app-button-primary"]);
    // (3) theme.classes className string is the space-joined classList.
    expect(leaf.className).toBe("dt-colors-solid-primary app-button-primary");
    // (4) getClass (mirrors theme.classes) agrees.
    expect(theme.getClass("components", "button", "primary")).toBe(leaf.className);
    // The OLD default name never leaks.
    expect(theme.css).not.toContain(".dt-components-button-primary");
  });
});

describe("naming overrides — variableName remap (CSS)", () => {
  const naming = {
    variableName(
      address: { path: string; segments: string[] },
      defaults: { name: string },
    ) {
      return address.segments[0] === "colors"
        ? `--brand-${address.segments.slice(1).join("-")}`
        : defaults.name;
    },
  };
  const theme = buildCss(naming);

  it("remaps a var at its :root definition AND at every var(--…) usage", () => {
    // Definition (`:root { --brand-primary: … }`) and the text extra + variant.
    expect(theme.variablesCss).toContain("--brand-primary:");
    expect(theme.variablesCss).toContain("--brand-primary-text:");
    expect(theme.variablesCss).toContain("--brand-primary-dark:");
    // Usage inside the recipe declaration.
    expect(theme.css).toContain("background: var(--brand-primary)");
    expect(theme.css).toContain("color: var(--brand-primary-text)");
    // The default var name never leaks anywhere.
    expect(theme.css).not.toContain("--dt-colors-primary");
  });
});

describe("naming overrides — container context class (kind:\"container\")", () => {
  const naming = {
    className(
      address: { kind: string; variant: string },
      defaults: { name: string },
    ) {
      return address.kind === "container" ? `cq-${address.variant}-scope` : defaults.name;
    },
  };
  const theme = buildCss(naming);

  it("remaps the `-cq-<name>` utility at its rule AND in theme.classes", () => {
    expect(theme.classes.containers.context.card).toBe("cq-card-scope");
    expect(theme.css).toContain(".cq-card-scope {");
    expect(theme.css).not.toContain(".dt-cq-card");
  });
});

describe("naming overrides — contract enforcement", () => {
  it("throws when two distinct addresses collide to one output name", () => {
    // Both the colours recipe and the component map to the same constant → collision.
    expect(() => buildCss({ className: () => "dup" })).toThrow(/class name "dup" is produced by both/);
  });

  it("throws when two distinct token paths collide to one variable name", () => {
    expect(() => buildCss({ variableName: () => "--dup" }).variablesCss).toThrow(
      /variable name "--dup" is produced by both/,
    );
  });

  it("runs an illegal className token through the segment sanitizer", () => {
    const theme = buildCss({
      className: (
        address: { subsystem: string },
        defaults: { name: string },
      ) => (address.subsystem === "components" ? "My_Class 99$" : defaults.name),
    });
    // sanitizeSegment: spaces → `-`, illegal `$` dropped, trailing `-` trimmed, lowercased.
    expect(theme.getClass("components", "button", "primary")).toContain("my_class-99");
    expect(theme.css).toContain(".my_class-99 {");
  });

  it("normalizes an overridden variable name to a valid custom property (`--` + sanitized)", () => {
    const theme = buildCss({
      variableName: (
        address: { segments: string[] },
        defaults: { name: string },
      ) =>
        address.segments[0] === "colors"
          ? `brand ${address.segments.slice(1).join(" ")}!` // no leading `--`, spaces + illegal `!`
          : defaults.name,
    });
    // No leading `--` given → prepended; spaces → `-`, illegal `!` dropped. Distinct paths stay distinct.
    expect(theme.variablesCss).toContain("--brand-primary:");
    expect(theme.variablesCss).toContain("--brand-primary-text:");
  });
});

describe("naming overrides — byte-identical default", () => {
  it("a no-op decorate override is byte-identical to no naming option", () => {
    const def = buildCss().css;
    const noop = buildCss({
      className: (_a: unknown, d: { name: string }) => d.name,
      variableName: (_a: unknown, d: { name: string }) => d.name,
    }).css;
    expect(noop).toBe(def);
  });

  it("omitting the naming option leaves the default names in place", () => {
    const theme = buildCss();
    expect(theme.getClass("components", "button", "primary")).toContain("dt-components-button-primary");
    expect(theme.classes.containers.context.card).toBe("dt-cq-card");
    expect(theme.variablesCss).toContain("--dt-colors-primary:");
  });
});

describe("naming overrides — the SC adapter (§8: recipe export identifiers)", () => {
  // The SC target emits a literal theme object + camelCase `css` recipe consts (no CSS vars/classes),
  // so `className` remaps a recipe's IDENTITY — its export identifier (camelCased). `variableName` has
  // no coherent target on the nested theme object and is accepted-but-structural.
  const emitSrc = (naming?: Record<string, unknown>): string => {
    const adapter = createStyledComponentsAdapter({ prefix: "dt", ...(naming ? { naming } : {}) });
    const theme = createTheme(raw as any, { adapter }) as any;
    const media = buildMediaDescriptor(theme.model.breakpoints, o => mediaQueryString(o, resolveMediaConfig(undefined)));
    return adapter
      .bind(theme.model, { media, containers: {}, resolve: theme.resolveToken } as any)
      .emit().files["theme.ts"];
  };

  it("className remaps the targeted recipe's export identifier; others keep the structural default", () => {
    const src = emitSrc({
      className: (
        address: { subsystem: string; group: string; variant: string },
        defaults: { name: string },
      ) => (address.subsystem === "components" ? `app-${address.group}-${address.variant}` : defaults.name),
      // Accepted but structural on a nested object — must not throw.
      variableName: (_a: unknown, defaults: { name: string }) => defaults.name,
    });
    // components recipe identity remapped (`app-button-primary` → camelCase); the barrel + spread agree.
    expect(src).toContain("export const appButtonPrimary = css`");
    expect(src).toContain("primary: appButtonPrimary,");
    // referenced colours recipe keeps the structural default.
    expect(src).toContain("export const colorsSolidPrimary = css`");
    // theme keys stay structural (variableName does not reshape the object).
    expect(src).toContain("primary: \"rgb(77, 171, 247)\",");
  });

  it("no naming option ⇒ structural camelCase identifiers", () => {
    const src = emitSrc();
    expect(src).toContain("export const componentsButtonPrimary = css`");
    expect(src).toContain("export const colorsSolidPrimary = css`");
  });
});
