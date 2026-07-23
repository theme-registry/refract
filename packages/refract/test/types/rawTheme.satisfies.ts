/**
 * §8a type-level gate — a realistic, multi-subsystem raw theme authored as `satisfies RawTheme`.
 *
 * This file exists to be **type-checked** (via `tsconfig.typecheck.json` → `npm run typecheck`),
 * proving `RawTheme` accepts real authored input — literals + string refs, responsive / variant /
 * target / state overrides, the structural layout generators, and cross-subsystem composition
 * recipes — and is not secretly `any`. It is intentionally NOT a runtime test (vitest/esbuild
 * transpiles without type-checking, so it would never catch a regression there).
 *
 * Covers every authoring shape at once: colours with `text` + `variants`, a modular typography
 * scale, effects, all four layout structural generators + a `container` config with variants, and
 * component recipes referencing other subsystems' recipes plus grouped `states` / `responsive`.
 */
import type { RawTheme } from "../../src/core";

export const raw = {
  breakpoints: { sm: 576, md: 768, lg: 1024, xl: 1280 },
  colors: {
    // bare hex, ref-carrying object, and full ExtendedProperty with text + variants
    primary: { base: "#4dabf7", text: "#fff", variants: { dark: "#1c7ed6", light: "#a5d8ff" } },
    neutral: { base: "#868e96", text: "#fff", variants: { light: "#f1f3f5", dark: "#343a40" } },
    danger: "#ff6b6b",
    recipes: {
      solid: {
        primary: {
          background: "primary",
          color: "primary.text",
          // grouped state map + state × breakpoint responsive cross-product
          states: {
            hover: { background: "primary.dark" },
            disabled: { background: "primary.light", color: "primary" },
          },
          responsive: [{ breakpoint: "md", state: "hover", background: "primary.light" }],
        },
        danger: { background: "danger", color: "#fff" },
      },
      outline: { primary: { borderColor: "primary", color: "primary.dark" } },
    },
  },
  typography: {
    fontFamily: { base: "system-ui, sans-serif", variants: { heading: "Georgia, serif" } },
    // modular scale via ratio extras
    fontSize: { base: 16, ratio: "major-third", precision: 4, unit: "rem", baseFontSize: 16 },
    fontWeight: { base: 400, variants: { medium: 500, bold: 700 } },
    lineHeight: { base: 1.5, variants: { tight: 1.2 } },
    letterSpacing: { base: "0", variants: { wide: "0.05em" } },
    recipes: {
      heading: {
        h1: { fontFamily: "heading", fontSize: "3xl", fontWeight: "bold", lineHeight: "tight" },
      },
      body: { base: { fontSize: "base", lineHeight: "base" } },
      button: { large: { fontSize: "lg", fontWeight: "medium" } },
    },
  },
  effects: {
    shadow: { base: "0 1px 3px rgba(0,0,0,0.1)", variants: { lg: "0 10px 20px rgba(0,0,0,0.1)" } },
    transitions: { base: "all 150ms ease", variants: { fast: "all 80ms ease" } },
    recipes: {
      card: {
        default: { boxShadow: "base", states: { hover: { boxShadow: "lg" } } },
        flat: { boxShadow: "none" },
      },
    },
  },
  // §14 — stroke geometry: radius moved out of effects; border/outline recipes incl. per-side +
  // a color-only outline (value-level `colors.*` ref) to exercise the BordersRaw authoring type.
  borders: {
    width: { base: 1, variants: { thick: 2 } },
    style: { base: "solid" },
    offset: { base: 2 },
    radius: { base: 6, variants: { none: 0, lg: 12, full: "9999px" } },
    recipes: {
      box: {
        default: { radius: "base" },
        flat: { radius: "none" },
      },
      divider: {
        bottom: { as: "border", side: "bottom", width: "base", style: "base", color: "colors.primary" },
      },
      focus: {
        ring: { as: "outline", width: "base", style: "base", offset: "base", color: "colors.primary" },
      },
    },
  },
  layout: {
    spacing: {
      base: 16,
      variants: { none: 0, compact: 8, relaxed: 32 },
      responsive: [
        { breakpoint: "sm", target: "relaxed", base: 20 },
        { breakpoint: "lg", target: "relaxed", base: 40 },
      ],
    },
    gutters: { base: 16, variants: { compact: 8, relaxed: 32 } },
    aspectRatio: { base: "auto", variants: { square: "1", video: "16/9" } },
    container: {
      base: "fixed",
      inset: "base",
      gutter: "base",
      direction: "column",
      variants: {
        narrow: { base: "fixed", maxWidth: "md" },
        wide: { base: "fluid", maxWidth: 1600, inset: "relaxed" },
        full: "fluid",
      },
    },
    columns: 12,
    grids: {
      cards: { templateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "relaxed" },
      feature: {
        templateColumns: "repeat(3, minmax(0, 1fr))",
        gap: "base",
        responsive: [{ breakpoint: "md", templateColumns: "repeat(2, minmax(0, 1fr))" }],
      },
    },
    stacks: {
      vertical: { direction: "column", gap: "relaxed", align: "stretch" },
      horizontal: {
        direction: "row",
        gap: "compact",
        align: "center",
        responsive: [{ breakpoint: "sm", direction: "column" }],
      },
      pills: { direction: "row", inline: true, gap: "compact", wrap: "wrap" },
    },
    recipes: {
      padding: {
        card: { paddingY: "xl", paddingX: "xl" },
        "button-lg": { paddingY: "md", paddingX: "xl" },
      },
    },
  },
  components: {
    recipes: {
      buttons: {
        primary: {
          colors: "solid.primary",
          typography: "button.large",
          layout: "padding.button-lg",
          effects: "card.default",
          borders: "box.default",
          // §19 ref-first: bare string `color` is a token ref; raw CSS keywords use the `{ css }` escape.
          css: { color: "colors.primary.text", cursor: "pointer", border: "none", display: "inline-flex", gap: "8px" },
          states: { hover: { css: { boxShadow: "0 6px 16px rgba(0,0,0,0.2)" } } },
        },
      },
      cards: {
        default: { effects: "card.default", borders: "box.default", layout: "padding.card", css: { background: "#fff" } },
      },
    },
  },
} satisfies RawTheme;
