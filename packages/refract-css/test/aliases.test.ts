/**
 * Raw-theme aliases in the CSS adapter: an alias is written as a live `var(--target)` link, so it
 * follows its target through modes, breakpoints and child themes without extra CSS.
 */
import { describe, expect, it } from "vitest";
import { createTheme } from "@theme-registry/refract";
import { createCssAdapter } from "../src";

const raw = {
  breakpoints: { sm: 576, md: 768 },
  colors: {
    accent: { base: "#e64980", modes: [{ mode: "dark", base: "#f783ac" }] },
    highlight: { ref: "colors.accent" },
    link: {
      base: { ref: "colors.accent" },
      variants: { hover: { ref: "colors.accent.dark" } },
      modes: [{ mode: "dark", ref: "colors.accent.light" }],
      responsive: [{ breakpoint: "sm", query: "max", base: { ref: "colors.accent.darker" } }],
    },
    recipes: { solid: { cta: { background: "highlight" } } },
  },
  layout: { spacing: { base: 4, variants: { md: 12 } } },
  borders: { radius: { base: 6, variants: { card: { ref: "layout.spacing.md" } } } },
};

describe("aliases in the CSS adapter", () => {
  const css = String(createTheme(raw as never, { adapter: createCssAdapter() }).css);

  it("writes a var() link, not a copied value", () => {
    expect(css).toContain("--dt-colors-highlight: var(--dt-colors-accent);");
    expect(css).toContain("--dt-colors-link-hover: var(--dt-colors-accent-dark);");
  });

  it("writes a link across subsystems", () => {
    expect(css).toContain("--dt-borders-radius-card: var(--dt-layout-spacing-md);");
  });

  it("links in mode and breakpoint blocks", () => {
    expect(css).toMatch(/prefers-color-scheme: dark[\s\S]*--dt-colors-link: var\(--dt-colors-accent-light\);/);
    expect(css).toMatch(/@media[^{]*max-width[\s\S]*--dt-colors-link: var\(--dt-colors-accent-darker\);/);
  });

  it("adds no mode block of its own: the alias follows the target's", () => {
    expect(css).not.toMatch(/--dt-colors-highlight: rgb/);
  });

  it("recipes reference the alias's own variable", () => {
    expect(css).toMatch(/background: var\(--dt-colors-highlight\)/);
  });

  it("keeps the link with hex output", () => {
    const hex = String(createTheme(raw as never, { adapter: createCssAdapter({ colorFormat: "hex" }) }).css);
    expect(hex).toContain("--dt-colors-highlight: var(--dt-colors-accent);");
  });
});
