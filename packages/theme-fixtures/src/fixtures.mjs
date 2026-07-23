// Golden-baseline fixtures — real, comprehensive themes copied from the example
// apps (react-sc-app + layout-app) so they match the current API exactly.
// Plain data only (no imports) so nothing self-resolves the package.
// NOTE: vitest/esbuild transpiles without type-checking, so loose typing is fine.

export const reactSc = {
  options: {
    colors: { prefix: "app", classPrefix: "app-color" },
    typography: { prefix: "app", classPrefix: "app-type" },
    effects: { prefix: "app", classPrefix: "app-fx" },
    borders: { prefix: "app", classPrefix: "app-border" },
    layout: { prefix: "app", classPrefix: "app-layout" },
    components: { prefix: "app", classPrefix: "app" },
  },
  rawTheme: {
    breakpoints: { sm: 576, md: 768, lg: 1024, xl: 1280 },
    colors: {
      primary: { base: "#4dabf7", text: "#fff", variants: { dark: "#1c7ed6", light: "#a5d8ff" } },
      neutral: { base: "#868e96", text: "#fff", variants: { light: "#f1f3f5", dark: "#343a40" } },
      danger: { base: "#ff6b6b", text: "#fff" },
      success: { base: "#51cf66", text: "#fff" },
      // shadow ink + translucent variants (alpha lives on the colour, §13.3 — not on the shadow).
      shadow: { base: "#000000", variants: { a7: { modifiers: [{ alpha: 7 }] }, a10: { modifiers: [{ alpha: 10 }] }, a12: { modifiers: [{ alpha: 12 }] } } },
      recipes: {
        solid: {
          primary: { background: "primary", color: "primary.text" },
          danger: { background: "danger", color: "danger.text" },
          success: { background: "success", color: "success.text" },
          neutral: { background: "neutral.light", color: "neutral.dark" },
        },
        outline: { primary: { borderColor: "primary", color: "primary.dark" } },
      },
    },
    typography: {
      fontFamily: {
        base: "system-ui, -apple-system, sans-serif",
        variants: { heading: "Georgia, serif", mono: "'Fira Code', monospace" },
      },
      fontSize: { base: 16, variants: { xs: 12, sm: 14, lg: 20, xl: 24, "2xl": 32, "3xl": 40 } },
      fontWeight: { base: 400, variants: { medium: 500, semibold: 600, bold: 700 } },
      lineHeight: { base: 1.5, variants: { tight: 1.2, loose: 1.8 } },
      letterSpacing: { base: "0", variants: { tight: "-0.02em", wide: "0.05em" } },
      recipes: {
        heading: {
          h1: { fontFamily: "heading", fontSize: "3xl", fontWeight: "bold", lineHeight: "tight", letterSpacing: "tight" },
          h2: { fontFamily: "heading", fontSize: "2xl", fontWeight: "bold", lineHeight: "tight" },
          h3: { fontFamily: "heading", fontSize: "xl", fontWeight: "semibold" },
        },
        body: {
          base: { fontSize: "base", lineHeight: "base" },
          small: { fontSize: "sm", lineHeight: "base" },
          large: { fontSize: "lg", lineHeight: "loose" },
        },
        button: {
          large: { fontSize: "lg", fontWeight: "medium" },
          small: { fontSize: "sm", fontWeight: "medium" },
        },
        code: { inline: { fontFamily: "mono", fontSize: "sm" } },
      },
    },
    effects: {
      shadow: {
        offsetY: 1, blur: 3, color: "colors.shadow.a10",
        variants: {
          none: "none",
          md: { offsetY: 4, blur: 6, color: "colors.shadow.a7" },
          lg: { offsetY: 10, blur: 20, color: "colors.shadow.a10" },
          xl: { offsetY: 20, blur: 40, color: "colors.shadow.a12" },
        },
      },
      transitions: {
        property: "all", duration: 150, timingFunction: "ease",
        variants: {
          fast: { property: "all", duration: 80, timingFunction: "ease" },
          slow: { property: "all", duration: 300, timingFunction: "ease" },
        },
      },
      recipes: {
        card: {
          default: { boxShadow: "base", transition: "base" },
          elevated: { boxShadow: "lg" },
          flat: { boxShadow: "none" },
        },
      },
    },
    // §14 — border-radius geometry lives in the `borders` subsystem now (moved out of effects).
    // The `box` recipe carries the radius that the effects `card` recipe used to; components
    // compose both (`effects: "card.*"` for shadow/transition, `borders: "box.*"` for radius).
    borders: {
      radius: { base: 6, variants: { none: 0, sm: 4, lg: 12, xl: 16, full: "9999px" } },
      recipes: {
        box: {
          default: { radius: "base" },
          elevated: { radius: "lg" },
          flat: { radius: "sm" },
        },
      },
    },
    layout: {
      spacing: { base: 8, variants: { xs: 4, sm: 6, md: 12, lg: 16, xl: 24, "2xl": 32, "3xl": 48 } },
      recipes: {
        padding: {
          card: { paddingY: "xl", paddingX: "xl" },
          section: { paddingY: "3xl", paddingX: "lg" },
          "button-lg": { paddingY: "md", paddingX: "xl" },
          "button-sm": { paddingY: "sm", paddingX: "md" },
        },
      },
    },
    components: {
      recipes: {
        buttons: {
          primary: {
            colors: "solid.primary", typography: "button.large", layout: "padding.button-lg", effects: "card.default", borders: "box.default",
            css: { cursor: "pointer", border: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "8px" },
          },
          "primary-sm": {
            colors: "solid.primary", typography: "button.small", layout: "padding.button-sm", effects: "card.default", borders: "box.default",
            css: { cursor: "pointer", border: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "6px" },
          },
          danger: {
            colors: "solid.danger", typography: "button.large", layout: "padding.button-lg", effects: "card.default", borders: "box.default",
            css: { cursor: "pointer", border: "none", display: "inline-flex", alignItems: "center", justifyContent: "center" },
          },
        },
        cards: {
          default: { effects: "card.default", borders: "box.default", layout: "padding.card", css: { background: "#fff", overflow: "hidden" } },
          elevated: { effects: "card.elevated", borders: "box.elevated", layout: "padding.card", css: { background: "#fff", overflow: "hidden" } },
        },
        badges: {
          default: { colors: "solid.neutral", typography: "body.small", css: { display: "inline-flex", alignItems: "center", padding: "2px 8px", borderRadius: "9999px" } },
          success: { colors: "solid.success", typography: "body.small", css: { display: "inline-flex", alignItems: "center", padding: "2px 8px", borderRadius: "9999px" } },
        },
      },
    },
    // §9 — globals: a normalization preset (static `:where()` layer + opportunistic default headings)
    // plus a themed `a` element exercising the full surface — bare base rule, a `:hover` state, a
    // responsive `@media` override, and a delta-only `subtle` variant (self-scoped `a.subtle`).
    globals: {
      preset: "preflight",
      elements: {
        a: {
          color: { ref: "colors.primary" },
          textDecoration: "underline",
          states: [{ state: "hover", color: { ref: "colors.primary.dark" } }],
          responsive: [{ breakpoint: "md", query: "min", fontSize: { ref: "typography.fontSize.lg" } }],
          variants: {
            subtle: { color: { ref: "colors.neutral" }, states: [{ state: "hover", color: { ref: "colors.primary" } }] },
          },
        },
      },
    },
  },
};

export const layout = {
  options: { layout: { prefix: "brand", classPrefix: "brand" } },
  rawTheme: {
    breakpoints: { xs: 0, sm: 576, md: 768, lg: 1024, xl: 1280 },
    layout: {
      spacing: {
        base: 16,
        variants: { none: 0, compact: 8, relaxed: 32 },
        responsive: [
          { breakpoint: "sm", target: "relaxed", base: 20 },
          { breakpoint: "lg", target: "relaxed", base: 40 },
        ],
      },
      gutters: { base: 16, variants: { compact: 8, relaxed: 32, loose: 48 } },
      aspectRatio: { base: "auto", variants: { square: "1", video: "16/9", portrait: "3/4" } },
      container: {
        base: "fixed", inset: "base", gutter: "base", direction: "column",
        variants: {
          narrow: { base: "fixed", maxWidth: "md" },
          wide: { base: "fluid", maxWidth: 1600, inset: "relaxed" },
          full: { base: "fluid" },
        },
      },
      columns: 12,
      grids: {
        cards: { templateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "relaxed" },
        feature: {
          templateColumns: "repeat(3, minmax(0, 1fr))", gap: "base",
          responsive: [
            { breakpoint: "md", templateColumns: "repeat(2, minmax(0, 1fr))" },
            { breakpoint: "sm", templateColumns: "1fr" },
          ],
        },
      },
      stacks: {
        vertical: { direction: "column", gap: "relaxed", align: "stretch" },
        horizontal: { direction: "row", gap: "compact", align: "center", responsive: [{ breakpoint: "sm", direction: "column" }] },
        pills: { direction: "row", inline: true, gap: "compact", wrap: "wrap" },
      },
      recipes: {
        section: {
          block: { paddingY: "compact", paddingX: "relaxed" },
          hero: { paddingY: "relaxed", paddingX: "relaxed" },
        },
      },
    },
  },
};

// §11.5 — the smallest theme that lines up the three preconditions for the non-inline
// components responsive `:root` var-override path (`css/index.ts:597–606`):
//   1. a property (`layout.spacing`) carrying a `responsive[]` override on the `relaxed` variant,
//   2. a subsystem recipe (`padding.card`) that references `relaxed`,
//   3. a component (`cards.default`) that references that recipe.
// The chain puts `layout.spacing.relaxed` into the component's `referencedPaths`, so the
// responsive `@media { :root { --…-spacing-relaxed } }` node survives the tree-shake filter.
export const responsiveComponents = {
  options: {
    layout: { prefix: "app", classPrefix: "app-layout" },
    components: { prefix: "app", classPrefix: "app" },
  },
  rawTheme: {
    breakpoints: { sm: 576, md: 768, lg: 1024, xl: 1280 },
    layout: {
      spacing: {
        base: 16,
        variants: { compact: 8, relaxed: 32 },
        responsive: [{ breakpoint: "lg", target: "relaxed", base: 40 }],
      },
      recipes: {
        padding: {
          card: { paddingY: "relaxed", paddingX: "relaxed" },
        },
      },
    },
    components: {
      recipes: {
        cards: {
          default: { layout: "padding.card", css: { background: "#fff" } },
        },
      },
    },
  },
};

export const fixtures = { reactSc, layout };
