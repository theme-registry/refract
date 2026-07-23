import { describe, it, expect } from "vitest";
import { createTheme } from "@theme-registry/refract";
import { createCssAdapter } from "../src";

// §14 — the `borders` subsystem: stroke geometry (width/style/offset/radius) + border/outline
// recipes. The novel logic is the `(as, side, aspect)` → CSS-property computation; the notable
// cross-cut is a value-level `colors.*` ref for border-color/outline-color (§14.4), which must
// resolve against the GLOBAL path→var map (colors is lowered first) — the Phase-4 watch-point.

const raw = {
  colors: {
    primary: { base: "#4dabf7", text: "#fff", variants: { dark: "#1c7ed6" } },
    neutral: { base: "#868e96", variants: { light: "#f1f3f5" } },
  },
  borders: {
    width: { base: 1, variants: { thick: 2 } },
    style: { base: "solid", variants: { dashed: "dashed" } },
    offset: { base: 2 },
    radius: { base: 6, variants: { lg: 12 } },
    recipes: {
      // no `as` → defaults to "border"; radius always lowers to `border-radius`.
      box: { default: { radius: "base" } },
      // `as` omitted → border; a bare width ref → `border-width`.
      plain: { thin: { width: "base" } },
      // full border with a value-level color ref (`colors.*`).
      edge: { card: { as: "border", width: "base", style: "base", color: "colors.neutral.light", radius: "base" } },
      // per-side longhands (`side` modifier) — bottom hairline divider.
      divider: { bottom: { as: "border", side: "bottom", width: "base", style: "base", color: "colors.neutral" } },
      // color-only partial — just `border-left-color` (§14.4).
      accent: { left: { as: "border", side: "left", color: "colors.primary" } },
      // outline: full-ring, has offset, no side.
      focus: { ring: { as: "outline", width: "thick", style: "base", offset: "base", color: "colors.primary" } },
    },
  },
};

const build = () =>
  createTheme(raw as never, {
    adapter: createCssAdapter({ prefix: "app" }),
  }) as never as {
    tokens: Record<string, { value?: unknown; ref?: string }>;
    model: { subsystems: Record<string, { properties?: Record<string, unknown>; ruleSets?: Record<string, Record<string, { declarations: Record<string, unknown>; references?: string[] }>> }> };
    variablesCss: string;
    recipesCss: string;
  };

describe("borders — property normalization (geometry tokens)", () => {
  const theme = build();

  it("normalizes width/style/offset/radius into borders Model properties", () => {
    const props = theme.model.subsystems.borders!.properties!;
    expect(props.radius).toBeTruthy();
    expect(props.width).toBeTruthy();
    expect(props.style).toBeTruthy();
    expect(props.offset).toBeTruthy();
  });

  it("exposes borders tokens on the flat token map", () => {
    // §21: length leaves carry a resolved unit (px default).
    expect(theme.tokens["borders.radius"]).toEqual({ value: 6, unit: "px" });
    expect(theme.tokens["borders.radius.lg"]).toEqual({ value: 12, unit: "px" });
    expect(theme.tokens["borders.width"]).toEqual({ value: 1, unit: "px" });
    expect(theme.tokens["borders.width.thick"]).toEqual({ value: 2, unit: "px" });
    expect(theme.tokens["borders.style"]).toEqual({ value: "solid" });
    expect(theme.tokens["borders.offset"]).toEqual({ value: 2, unit: "px" });
  });

  it("emits px for width/offset/radius; style stays a raw string", () => {
    expect(theme.variablesCss).toContain("--app-borders-width: 1px;");
    expect(theme.variablesCss).toContain("--app-borders-width-thick: 2px;");
    expect(theme.variablesCss).toContain("--app-borders-offset: 2px;");
    expect(theme.variablesCss).toContain("--app-borders-radius: 6px;");
    expect(theme.variablesCss).toContain("--app-borders-radius-lg: 12px;");
    expect(theme.variablesCss).toContain("--app-borders-style: solid;");
  });
});

describe("borders — recipe interpretation ((as, side, aspect) → CSS property)", () => {
  const theme = build();
  const rs = theme.model.subsystems.borders!.ruleSets!;

  it("defaults `as` to border; radius lowers to border-radius", () => {
    expect(rs.box.default.declarations["border-radius"]).toEqual({ ref: "borders.radius" });
  });

  it("a bare width ref (no `as`) → border-width", () => {
    expect(rs.plain.thin.declarations["border-width"]).toEqual({ ref: "borders.width" });
  });

  it("a full border resolves width/style/radius to borders refs and color to a colors ref", () => {
    const d = rs.edge.card.declarations;
    expect(d["border-width"]).toEqual({ ref: "borders.width" });
    expect(d["border-style"]).toEqual({ ref: "borders.style" });
    expect(d["border-radius"]).toEqual({ ref: "borders.radius" });
    // §14.4 — color is a value-level `colors.*` token ref, NOT a borders token.
    expect(d["border-color"]).toEqual({ ref: "colors.neutral.light" });
  });

  it("the `side` modifier routes to border-<side>-* longhands", () => {
    const d = rs.divider.bottom.declarations;
    expect(d["border-bottom-width"]).toEqual({ ref: "borders.width" });
    expect(d["border-bottom-style"]).toEqual({ ref: "borders.style" });
    expect(d["border-bottom-color"]).toEqual({ ref: "colors.neutral" });
  });

  it("a color-only per-side recipe emits just the one longhand (partial contribution)", () => {
    expect(rs.accent.left.declarations).toEqual({ "border-left-color": { ref: "colors.primary" } });
  });

  it("outline routes to outline-* and carries outline-offset (no side)", () => {
    const d = rs.focus.ring.declarations;
    expect(d["outline-width"]).toEqual({ ref: "borders.width.thick" });
    expect(d["outline-style"]).toEqual({ ref: "borders.style" });
    expect(d["outline-offset"]).toEqual({ ref: "borders.offset" });
    expect(d["outline-color"]).toEqual({ ref: "colors.primary" });
  });

  it("a borders recipe carries NO cross-subsystem references (color is a value ref, not a class ref)", () => {
    // Unlike components, a `colors.*` declaration ref must never be mistaken for a class reference.
    expect(rs.edge.card.references).toBeUndefined();
    expect(rs.accent.left.references).toBeUndefined();
  });
});

describe("borders — CSS lowering (the §14.4 global-path watch-point)", () => {
  const theme = build();

  it("resolves same-subsystem refs to borders vars and color refs to colors vars", () => {
    const css = theme.recipesCss;
    expect(css).toContain(".app-borders-edge-card {");
    expect(css).toContain("border-width: var(--app-borders-width);");
    expect(css).toContain("border-style: var(--app-borders-style);");
    expect(css).toContain("border-radius: var(--app-borders-radius);");
    // colors.* ref resolved via the GLOBAL path→var map (not the borders-local one).
    expect(css).toContain("border-color: var(--app-colors-neutral-light);");
  });

  it("lowers per-side longhands with a colors border-color", () => {
    const css = theme.recipesCss;
    expect(css).toContain("border-bottom-width: var(--app-borders-width);");
    expect(css).toContain("border-bottom-color: var(--app-colors-neutral);");
    expect(css).toContain("border-left-color: var(--app-colors-primary);");
  });

  it("lowers an outline recipe with offset + color", () => {
    const css = theme.recipesCss;
    expect(css).toContain("outline-width: var(--app-borders-width-thick);");
    expect(css).toContain("outline-offset: var(--app-borders-offset);");
    expect(css).toContain("outline-color: var(--app-colors-primary);");
  });

  it("leaves no unresolved token paths (every ref maps to a var name)", () => {
    // A `var(borders.…)` / `var(colors.…)` (a raw path, not a `--…` name) is an unresolved ref.
    expect(theme.recipesCss).not.toMatch(/var\((?!--)/);
  });
});
