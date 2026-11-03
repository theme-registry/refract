/**
 * Raw-theme aliases: `{ ref }` with no `modifiers` means "this value IS that token". The model keeps the
 * link (`ref`) and the post-build alias pass fills the resolved value / unit; errors for a missing
 * target, a different kind of value, a cycle, or a generator asked of an aliased property.
 */
import { describe, it, expect } from "vitest";
import { createTheme, createNoopAdapter, RefractError } from "@theme-registry/refract";
import { toDTCG } from "@theme-registry/refract/dtcg";

const build = (raw: unknown) => createTheme(raw as never, { adapter: createNoopAdapter() });
const failure = (raw: unknown): { code?: string; message: string } => {
  try {
    build(raw);
  } catch (e) {
    expect(e).toBeInstanceOf(RefractError);
    return { code: (e as RefractError).code, message: (e as Error).message };
  }
  throw new Error("expected createTheme to throw");
};

const raw = {
  breakpoints: { sm: 576, md: 768 },
  colors: {
    accent: { base: "#e64980", modes: [{ mode: "dark", base: "#f783ac" }] },
    highlight: { ref: "colors.accent" },
    link: {
      base: { ref: "colors.accent" },
      variants: { hover: { ref: "colors.accent.dark" }, visited: { ref: "hover" } },
      modes: [{ mode: "dark", ref: "colors.accent.light" }],
      responsive: [{ breakpoint: "sm", query: "max", base: { ref: "colors.accent.darker" } }],
    },
  },
  layout: { spacing: { base: 4, variants: { md: 12 } }, sizes: { base: 8, variants: { full: "100%" } } },
  borders: { radius: { base: 6, variants: { card: { ref: "layout.spacing.md" } } } },
};

describe("raw-theme aliases", () => {
  const theme = build(raw);

  it("keeps the link and fills the value", () => {
    expect(theme.tokens["colors.highlight"]).toEqual({ ref: "colors.accent", value: "rgb(230, 73, 128)" });
    expect(theme.resolveToken("colors.highlight")).toBe(theme.resolveToken("colors.accent"));
  });

  it("accepts the bare form and the base: form", () => {
    expect(theme.tokens["colors.link"].ref).toBe("colors.accent");
  });

  it("aliases variants, including a same-property variant by bare name", () => {
    expect(theme.tokens["colors.link.hover"].ref).toBe("colors.accent.dark");
    expect(theme.tokens["colors.link.visited"].ref).toBe("colors.link.hover");
    expect(theme.resolveToken("colors.link.visited")).toBe(theme.resolveToken("colors.accent.dark"));
  });

  it("aliases in a mode and at a breakpoint", () => {
    const link = theme.model.subsystems.colors.properties!.link;
    expect(link.modes?.[0].overrides?.base.ref).toBe("colors.accent.light");
    expect(link.responsive?.[0].overrides?.base.ref).toBe("colors.accent.darker");
  });

  it("generates no tones for an aliased colour", () => {
    expect(Object.keys(theme.tokens).filter(p => p.startsWith("colors.highlight."))).toEqual([]);
  });

  it("crosses subsystems and carries the target's unit", () => {
    expect(theme.tokens["borders.radius.card"]).toMatchObject({ ref: "layout.spacing.md", value: 12, unit: "px" });
  });

  it("follows a target a child theme overrides", () => {
    const child = theme.override({ colors: { accent: "#228be6" } });
    expect(child.resolveToken("colors.highlight")).toBe(child.resolveToken("colors.accent"));
    expect(child.resolveToken("colors.highlight")).not.toBe(theme.resolveToken("colors.highlight"));
  });

  it("writes a DTCG alias in toDTCG", () => {
    const doc = toDTCG(theme) as Record<string, any>;
    expect(doc.color.highlight.base.$value).toBe("{color.accent.base}");
    expect(doc.radius.card.$value).toBe("{spacing.md}");
  });

  it("still treats { ref, modifiers } as a colour derivation", () => {
    const t = build({ colors: { accent: "#e64980", soft: { base: "#fff", variants: { a: { ref: "colors.accent", modifiers: [{ lighten: 10 }] } } } } });
    expect(t.tokens["colors.soft.a"].modifiers).toEqual([{ fn: "lighten", arg: 10 }]);
  });
});

describe("alias errors", () => {
  it("reports a missing target", () => {
    const { code, message } = failure({ colors: { a: { ref: "colors.nope" } } });
    expect(code).toBe("REFRACT_E_VALIDATION");
    expect(message).toContain('colors.a: alias { ref: "colors.nope" } points at a token that doesn\'t exist');
  });

  it("reports a different kind of value", () => {
    const { code, message } = failure({ colors: { a: { ref: "layout.spacing" } }, layout: { spacing: 4 } });
    expect(code).toBe("REFRACT_E_VALIDATION");
    expect(message).toContain("points at a length token, but colors.a holds a colour");
  });

  it("reports every bad alias at once", () => {
    const { message } = failure({ colors: { a: { ref: "colors.x" }, b: { ref: "colors.y" } } });
    expect(message).toContain("2 validation error(s)");
  });

  it("throws on a cycle", () => {
    expect(failure({ colors: { a: { ref: "colors.b" }, b: { ref: "colors.a" } } }).code).toBe("REFRACT_E_CYCLE");
  });

  it("rejects generators on an aliased property", () => {
    expect(failure({ colors: { x: "#000", a: { base: { ref: "colors.x" }, lightenBy: 5 } } }).code).toBe("REFRACT_E_PROPERTY");
    expect(failure({ colors: { x: "#000", a: { base: { ref: "colors.x" }, steps: [100, 500] } } }).code).toBe("REFRACT_E_PROPERTY");
    expect(
      failure({ typography: { lineHeight: 1.5, fontSize: { base: { ref: "typography.letterSpacing" }, ratio: "major-third" }, letterSpacing: 1 } })
        .code,
    ).toBe("REFRACT_E_PROPERTY");
    expect(failure({ layout: { gutters: 16, spacing: { base: { ref: "layout.gutters" }, step: 4 } } }).code).toBe("REFRACT_E_PROPERTY");
  });

  it("rejects a variant deriving from an aliased colour's own base", () => {
    const { code, message } = failure({ colors: { x: "#000", a: { base: { ref: "colors.x" }, variants: { soft: { modifiers: [{ lighten: 10 }] } } } } });
    expect(code).toBe("REFRACT_E_PROPERTY");
    expect(message).toContain('derive from the target instead');
  });

  it("rejects an alias with no path", () => {
    expect(failure({ colors: { a: { ref: "" } } }).code).toBe("REFRACT_E_REFERENCE");
  });
});
