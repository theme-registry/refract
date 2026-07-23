// Four preset RawThemes built from ONE factory (makePreset) so every preset shares an
// identical structure (same subsystem/recipe/variant/responsive/structural KEYS) — only the
// scalar token VALUES differ. That guarantees byte-identical class names across presets, so a
// preset switch is a pure stylesheet swap (== refraction). #4 "Halcyon Noir" is a
// theme.override() child of #1.
//
// The schema is deliberately RICH (not maximal, but representative of the full surface): it
// exercises derivation modes, recipes + states, responsive overrides, variant/target swaps, the
// layout structural generators, animation keyframes, and reset — so the showcase's per-subsystem
// deep-dives render real output for each capability.

const softScale = (hex, pct) => {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const f = 1 + pct / 100;
  const r = c(((n >> 16) & 255) * f), g = c(((n >> 8) & 255) * f), b = c((n & 255) * f);
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
};

// Structured shadows reference a translucent COLOUR (§13.3), never a shadow-level alpha. A leaf carries
// its opacity as `alpha` (0–100); the factory turns that into a `colors.shadow.a<alpha>` colour variant
// and points the leaf's `color` at it (opaque base when no alpha).
const shadowColorRef = (alpha) => (alpha == null ? "colors.shadow" : `colors.shadow.a${alpha}`);
const withShadowColor = ({ alpha, ...geo }) => ({ ...geo, color: shadowColorRef(alpha) });
// Collect the distinct alpha levels used across a preset's shadow leaves → named `alpha` colour variants.
const shadowColorToken = (v) => {
  const variants = {};
  for (const leaf of [v.shadow, v.shadowSm, v.shadowMd, v.shadowLg]) {
    if (leaf && leaf.alpha != null) variants[`a${leaf.alpha}`] = { modifiers: [{ alpha: leaf.alpha }] };
  }
  return Object.keys(variants).length ? { base: v.shadowColor, variants } : v.shadowColor;
};

// v = per-preset scalar values (see the three value objects below).
function makePreset(v) {
  return {
    breakpoints: { xs: 0, sm: 576, md: 768, lg: 1024, xl: 1440 },
    // Named query container (§10.5) — the Container-queries concept page resizes it live.
    containers: { card: { type: "inline-size", sizes: { sm: 280, md: 440 } } },

    colors: {
      // brand: relative OKLCH named set (light/lighter/dark/darker), custom lightenBy/darkenBy Δ,
      // + a responsive base swap on wide screens (folded cross-cutting: responsive).
      brand: {
        base: v.brand, text: v.brandText, lightenBy: 10, darkenBy: 12,
        variants: { light: v.brandLight, dark: v.brandDark },
        responsive: [{ breakpoint: "lg", query: "min", base: v.brandLg }],
      },
      // accent: a simple base + dark variant.
      accent: { base: v.accent, text: v.accentText, variants: { dark: v.accentDark } },
      // scale: absolute-L ladder 100–900 — each label at L = (1000 − label)/10 (derivation mode #2).
      scale: { base: v.scale, text: v.scaleText, steps: [100, 200, 300, 400, 500, 600, 700, 800, 900] },
      ink: { base: v.ink, text: v.inkText },
      // shadow ink + its translucent `alpha` variants (§13.3) — structured shadows ref these, no rgba() strings.
      shadow: shadowColorToken(v),
      recipes: {
        // filled surfaces + grouped states (hover/disabled) — folded cross-cutting: states.
        solid: {
          brand: {
            background: "brand", color: "brand.text",
            states: [{ state: "hover", background: "brand.dark" }, { state: "disabled", background: "brand.lighter", color: "brand.dark" }],
          },
          accent: {
            background: "accent", color: "accent.text",
            states: [{ state: "hover", background: "accent.dark" }],
            // container override (§10.5): inside a ≥md `card` container, swap to the brand fill.
            responsive: [{ container: "card", size: "md", query: "min", background: "brand", color: "brand.text" }],
          },
        },
        // outlined surfaces + a responsive VARIANT SWAP (@media lg inherits sibling `subtle`).
        outline: {
          subtle: { color: "scale.700", borderColor: "scale.400" },
          brand: {
            backgroundColor: "transparent", color: "brand", borderColor: "brand", cursor: "pointer",
            responsive: [{ breakpoint: "lg", query: "min", variant: "subtle" }],
          },
        },
      },
    },

    typography: {
      fontFamily: { base: v.font, variants: { display: v.display, mono: v.mono } },
      fontWeight: { base: 400, variants: { medium: 500, semibold: 600, bold: 700 } },
      lineHeight: { base: v.lh, variants: { tight: v.lhTight, snug: v.lhSnug, loose: 1.8 } },
      letterSpacing: { base: "0", variants: { tight: v.lsTight, wide: v.lsWide } },
      // extra text props — exercised by the eyebrow/label recipes.
      fontStyle: { base: "normal", variants: { italic: "italic" } },
      textTransform: { base: "none", variants: { upper: "uppercase" } },
      textDecoration: { base: "none", variants: { underline: "underline" } },
      fontSize: { base: 16, ratio: v.ratio, precision: 2, unit: "rem" },
      recipes: {
        heading: {
          // h1 with a responsive size bump (folded cross-cutting: responsive).
          h1: { fontFamily: "display", fontSize: "3xl", fontWeight: "bold", lineHeight: "tight", letterSpacing: "tight",
                responsive: [{ breakpoint: "lg", query: "min", fontSize: "4xl" }] },
          h3: { fontFamily: "display", fontSize: "xl", fontWeight: "semibold", lineHeight: "snug" },
        },
        body: { base: { fontSize: "base", lineHeight: "base" }, small: { fontSize: "sm", lineHeight: "base" } },
        button: { base: { fontFamily: "base", fontSize: "base", fontWeight: "semibold", letterSpacing: "wide" } },
        label: { caps: { fontFamily: "base", fontSize: "xs", fontWeight: "semibold", letterSpacing: "wide", textTransform: "upper" } },
        // exercises decoration + transform + italic.
        eyebrow: { base: { fontSize: "xs", textTransform: "upper", textDecoration: "underline", letterSpacing: "wide", fontStyle: "italic" } },
        code: { inline: { fontFamily: "mono", fontSize: "sm", letterSpacing: "tight" } },
        // recipe with a STATE (no breakpoint) — folded cross-cutting: states.
        link: { default: { textDecoration: "base", states: [{ state: "hover", textDecoration: "underline" }] } },
      },
    },

    effects: {
      // structured shadows (§15): each level is a flat leaf; the factory points its `color` at the
      // matching translucent `colors.shadow.a<alpha>` variant so presets author only geometry + alpha.
      shadow: {
        ...withShadowColor(v.shadow),
        variants: {
          none: "none",
          sm: withShadowColor(v.shadowSm),
          md: withShadowColor(v.shadowMd),
          lg: withShadowColor(v.shadowLg),
        },
      },
      transitions: { ...v.transition, variants: { fast: v.transitionFast } },
      opacity: { base: 1, variants: { muted: 0.6, disabled: 0.4 } },
      zIndex: { base: 1, variants: { dropdown: 1000, modal: 1300 } },
      blur: { base: 0, variants: { sm: 4, lg: 12 } },
      recipes: {
        surface: {
          card: { boxShadow: "md", transition: "base",
                  states: [{ state: "hover", boxShadow: "lg" }], responsive: [{ breakpoint: "lg", query: "min", boxShadow: "lg" }] },
          focusable: { boxShadow: "sm", transition: "base" },
        },
      },
    },

    // Stroke geometry (§14) — border/outline width/style/offset/radius; colour is a colors.* ref.
    borders: {
      width: { base: 1, variants: { thick: 2, hair: 0.5 } },
      style: { base: "solid", variants: { dashed: "dashed" } },
      offset: { base: 2, variants: { lg: 4 } },
      radius: { base: v.radius, variants: { none: 0, sm: v.radiusSm, lg: v.radiusLg, pill: "9999px" },
                responsive: [{ breakpoint: "lg", query: "min", base: v.radiusLgBp }] },
      recipes: {
        edge: {
          card:     { radius: "lg", width: "base", style: "base", color: "colors.scale.300" },
          button:   { radius: "base" },
          pill:     { radius: "pill" },
          focus:    { as: "outline", width: "thick", style: "base", offset: "base", color: "colors.brand" },
          hairline: { side: "bottom", width: "hair", style: "base", color: "colors.scale.300" },
        },
      },
    },

    layout: {
      // spacing with a responsive TARGET override (the `xl` step grows ≥sm) — folded: responsive+target.
      spacing: { base: v.spacing, variants: { none: 0, xs: 4, sm: v.spSm, md: v.spMd, lg: v.spLg, xl: v.spXl, "2xl": 32, "3xl": 48 },
                 responsive: [{ breakpoint: "sm", query: "min", target: "xl", base: v.spXlBp }] },
      gutters: { base: 16, variants: { compact: v.gutterCompact, relaxed: 32 } },
      aspectRatio: { base: "auto", variants: { square: "1", video: "16/9", wide: "21/9" } },
      // structural generators.
      columns: { size: 12, gutter: "compact", inset: "sm" },
      grids: {
        cards: { templateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "lg", alignItems: "start" },
        dashboard: { templateColumns: "repeat(4, minmax(0, 1fr))", gap: "md",
                     responsive: [{ breakpoint: "md", query: "max", templateColumns: "repeat(2, minmax(0,1fr))" }] },
      },
      stacks: {
        toolbar: { direction: "row", gap: "sm", align: "center", justify: "space-between",
                   responsive: [{ breakpoint: "sm", query: "max", direction: "column", align: "stretch" }] },
        stack: { direction: "column", gap: "md", align: "stretch" },
        tags: { direction: "row", inline: true, wrap: "wrap", gap: "xs" },
      },
      container: {
        base: "fixed", inset: "lg", gutter: "base", maxWidth: "lg",
        variants: { narrow: { base: "fixed", maxWidth: "md" }, fluid: { base: "fluid", maxWidth: 1600, inset: "xl" }, prose: { base: "720px" } },
      },
      recipes: {
        padding: { card: { paddingY: "lg", paddingX: "lg" }, button: { paddingY: "sm", paddingX: "lg" } },
        section: { hero: { paddingY: "3xl", paddingX: "xl", marginY: "xl", gap: "lg" }, block: { paddingY: "xl", paddingX: "lg", gap: "md" } },
      },
    },

    animation: {
      duration: { base: v.dur, variants: { fast: v.durFast, slow: v.durSlow } },
      easing: { base: v.ease, variants: { out: v.easeOut } },
      delay: { base: 0, variants: { short: 80 } },
      keyframes: {
        fadeUp: { from: { opacity: 0, transform: "translateY(14px)" }, to: { opacity: 1, transform: "translateY(0)" } },
        pulse: { "0%,100%": { opacity: 1 }, "50%": { opacity: 0.5 } },
        pop: { from: { transform: "scale(.92)" }, "60%": { transform: "scale(1.03)" }, to: { transform: "scale(1)" } },
      },
      recipes: {
        motion: {
          enter: { keyframes: "fadeUp", duration: "base", easing: "out", fillMode: "both" },
          beat: { keyframes: "pulse", duration: "slow", easing: "base", iterationCount: "infinite" },
          tap: { keyframes: "pop", duration: "fast", easing: "out", fillMode: "both" },
        },
      },
    },

    globals: {
      preset: "preflight",
      elements: {
        // Themed element rules (§9): bare-selector base + a `:hover` state + a delta-only `subtle`
        // variant (self-scoped `a.subtle`). Refs flow to the same tokens the recipes use.
        a: {
          color: { ref: "colors.brand" },
          states: [{ state: "hover", color: { ref: "colors.brand.dark" } }],
          variants: { subtle: { color: { ref: "colors.scale.500" } } },
        },
        h1: { color: { ref: "colors.ink" } },
        h2: { color: { ref: "colors.ink" } },
        blockquote: { color: { ref: "colors.accent" }, borderColor: { ref: "colors.accent" } },
        code: { color: { ref: "colors.accent" } },
      },
    },

    components: {
      recipes: {
        buttons: {
          primary: { colors: "solid.brand", typography: "button.base", layout: "padding.button", effects: "surface.focusable", borders: "edge.button",
                     css: { cursor: "pointer", border: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "8px" },
                     states: [{ state: "hover", css: { transform: "translateY(-1px)" } }] },
          ghost: { colors: "outline.brand", typography: "button.base", layout: "padding.button", borders: "edge.button",
                   css: { cursor: "pointer", background: "transparent", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "8px" } },
        },
        cards: {
          default: { effects: "surface.card", layout: "padding.card", typography: "body.base", borders: "edge.card",
                     css: { display: "flex", flexDirection: "column", gap: "10px" } },
          feature: { effects: "surface.card", layout: "section.block", typography: "body.base", borders: "edge.card",
                     css: { display: "flex", flexDirection: "column", gap: "10px" } },
        },
        badges: {
          accent: { colors: "solid.accent", typography: "label.caps", borders: "edge.pill",
                    css: { display: "inline-flex", alignItems: "center", padding: "3px 10px" } },
          info: { colors: "solid.brand", typography: "eyebrow.base", borders: "edge.pill",
                  css: { display: "inline-flex", alignItems: "center", padding: "3px 10px" } },
        },
      },
    },
  };
}

// ── per-preset scalar VALUES ──────────────────────────────────────────────────────────
export const halcyon = makePreset({
  brand: "#4c6ef5", brandText: "#ffffff", brandLight: "#91a7ff", brandDark: "#3b5bdb", brandLg: "#3b5bdb",
  accent: "#e64980", accentText: "#ffffff", accentDark: "#c92a6a",
  scale: "#7c8db5", scaleText: "#ffffff",
  ink: "#1f2733", inkText: "#ffffff",
  font: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", display: "'Iowan Old Style', Palatino, Georgia, serif", mono: "'JetBrains Mono', ui-monospace, monospace",
  lh: 1.55, lhTight: 1.15, lhSnug: 1.35, lsTight: "-0.02em", lsWide: "0.06em", ratio: "major-third",
  radius: 8, radiusSm: 4, radiusLg: 14, radiusLgBp: 12,
  shadowColor: "#18274b", // rgb(24,39,75)
  shadow: { offsetY: 1, blur: 2, alpha: 10 }, shadowSm: { offsetY: 1, blur: 3, alpha: 12 }, shadowMd: { offsetY: 6, blur: 16, alpha: 12 }, shadowLg: { offsetY: 14, blur: 34, alpha: 16 },
  transition: { property: "all", duration: 160, timingFunction: "cubic-bezier(.2,.7,.3,1)" }, transitionFast: { property: "all", duration: 90, timingFunction: "ease" }, outlineFocus: "2px solid #4c6ef5",
  spacing: 8, spSm: 8, spMd: 12, spLg: 18, spXl: 28, spXlBp: 40, gutterCompact: 10,
  dur: 300, durFast: 150, durSlow: 620, ease: "cubic-bezier(.2,.7,.3,1)", easeOut: "cubic-bezier(.16,.84,.44,1)",
});

export const brutalist = makePreset({
  brand: "#111111", brandText: "#f2ff49", brandLight: "#333333", brandDark: "#000000", brandLg: "#000000",
  accent: "#ff2d2d", accentText: "#ffffff", accentDark: "#c40000",
  scale: "#111111", scaleText: "#ffffff",
  ink: "#111111", inkText: "#ffffff",
  font: "'JetBrains Mono', ui-monospace, 'Courier New', monospace", display: "'JetBrains Mono', ui-monospace, monospace", mono: "'JetBrains Mono', ui-monospace, monospace",
  lh: 1.4, lhTight: 1.0, lhSnug: 1.2, lsTight: "-0.03em", lsWide: "0.12em", ratio: "augmented-fourth",
  radius: 0, radiusSm: 0, radiusLg: 0, radiusLgBp: 0,
  shadowColor: "#111111", // hard opaque offset shadow — no alpha
  shadow: { offsetX: 3, offsetY: 3, blur: 0 }, shadowSm: { offsetX: 2, offsetY: 2, blur: 0 }, shadowMd: { offsetX: 5, offsetY: 5, blur: 0 }, shadowLg: { offsetX: 8, offsetY: 8, blur: 0 },
  transition: { property: "all", duration: 80, timingFunction: "steps(2,end)" }, transitionFast: { property: "all", duration: 40, timingFunction: "steps(2,end)" }, outlineFocus: "3px solid #111",
  spacing: 4, spSm: 6, spMd: 10, spLg: 14, spXl: 22, spXlBp: 30, gutterCompact: 4,
  dur: 120, durFast: 60, durSlow: 240, ease: "steps(3, end)", easeOut: "steps(4, end)",
});

export const pastel = makePreset({
  brand: "#c9b8f0", brandText: "#3a2f5c", brandLight: softScale("#c9b8f0", 10), brandDark: softScale("#c9b8f0", -12), brandLg: softScale("#c9b8f0", -12),
  accent: "#f7a8c4", accentText: "#5c2f42", accentDark: softScale("#f7a8c4", -12),
  scale: "#b9a6e6", scaleText: "#3a2f5c",
  ink: "#5b5570", inkText: "#ffffff",
  font: "'Trebuchet MS', 'Segoe UI', ui-rounded, system-ui, sans-serif", display: "'Trebuchet MS', 'Segoe UI', ui-rounded, sans-serif", mono: "ui-monospace, monospace",
  lh: 1.6, lhTight: 1.25, lhSnug: 1.4, lsTight: "-0.01em", lsWide: "0.04em", ratio: "minor-third",
  radius: 18, radiusSm: 10, radiusLg: 22, radiusLgBp: 26,
  shadowColor: "#a08cc8", // rgb(160,140,200)
  shadow: { offsetY: 4, blur: 12, alpha: 20 }, shadowSm: { offsetY: 2, blur: 8, alpha: 18 }, shadowMd: { offsetY: 8, blur: 24, alpha: 24 }, shadowLg: { offsetY: 16, blur: 40, alpha: 30 },
  transition: { property: "all", duration: 220, timingFunction: "cubic-bezier(.34,1.56,.64,1)" }, transitionFast: { property: "all", duration: 140, timingFunction: "ease" }, outlineFocus: "2px solid #c9b8f0",
  spacing: 12, spSm: 10, spMd: 16, spLg: 22, spXl: 34, spXlBp: 44, gutterCompact: 16,
  dur: 420, durFast: 220, durSlow: 820, ease: "cubic-bezier(.34,1.56,.64,1)", easeOut: "cubic-bezier(.34,1.56,.64,1)",
});

// ── Preset 4 · Halcyon Noir — a theme.override() CHILD of Halcyon (dark reskin) ───────
export const noirOverride = {
  colors: {
    brand: { base: "#8aa2ff", text: "#0b1020", lightenBy: 10, darkenBy: 12, variants: { light: "#b9c7ff", dark: "#5f7cf0" }, responsive: [{ breakpoint: "lg", query: "min", base: "#5f7cf0" }] },
    accent: { base: "#ff7ab0", text: "#1a0a12", variants: { dark: "#e64d8c" } },
    ink: { base: "#e6ebf5", text: "#0b1020" },
    // darker, heavier shadow ink + its translucent variants (§13.3) for the noir reskin.
    shadow: { base: "#000000", variants: { a50: { modifiers: [{ alpha: 50 }] }, a55: { modifiers: [{ alpha: 55 }] }, a60: { modifiers: [{ alpha: 60 }] } } },
  },
  effects: {
    // structured (§15): deeper offsets + higher opacity than the light parent, over a black ink.
    shadow: {
      offsetY: 1, blur: 2, color: "colors.shadow.a50",
      variants: {
        none: "none",
        sm: { offsetY: 2, blur: 6, color: "colors.shadow.a50" },
        md: { offsetY: 8, blur: 22, color: "colors.shadow.a55" },
        lg: { offsetY: 18, blur: 44, color: "colors.shadow.a60" },
      },
    },
  },
};

export const PRESETS = [
  { id: "halcyon",   label: "Halcyon",      kind: "root",     raw: halcyon,   blurb: "Calm blue · serif display · synthesized steps",
    surface: "#ffffff", onSurface: "#1f2733", paneBg: "#f4f6fb" },
  { id: "brutalist", label: "Brutalist",    kind: "root",     raw: brutalist, blurb: "Mono · sharp corners · hard offset shadow",
    surface: "#fbfbf6", onSurface: "#111111", paneBg: "#f3f3ea" },
  { id: "pastel",    label: "Pastel",       kind: "root",     raw: pastel,    blurb: "Soft & round · gentle pastel tints",
    surface: "#fdfbff", onSurface: "#3a2f5c", paneBg: "#f6f0fb" },
  { id: "noir",      label: "Halcyon Noir", kind: "override", from: "halcyon", raw: noirOverride, blurb: "A theme.override() child of Halcyon — dark reskin",
    surface: "#12161f", onSurface: "#e6ebf5", paneBg: "#0b0e15" },
];
