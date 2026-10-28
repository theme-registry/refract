// The default DTCG importer — tokens placed one by one from the token graph, colours kept in their
// groups with `tones: false`, dimensions placed by keyword, shadows as structured layers, text styles
// as typography recipes, and a report of everything it did.
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { importDTCG, fromDTCG, type DTCGDocument } from "../src/dtcg";
import { createTheme } from "../src/core";
import { createNoopAdapter } from "../src/core/noopAdapter";
import { importReportLines } from "../src/build/importCommand";

const load = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as DTCGDocument;

const sample = load("dtcg-import-sample.tokens.json");
const { raw, report } = importDTCG(sample);
const colors = raw.colors as Record<string, any>;

describe("importDTCG — colours", () => {
  it("names a property after the token's group, so same-named tokens no longer collide", () => {
    expect(colors["panel-main"]).toEqual({
      base: "#24348f",
      tones: false,
      variants: { hover: "#2f44a8", pressed: "#18246a" },
    });
    expect(colors["panel-alert-danger"].variants).toEqual({ hover: "#9e1f25", pressed: "#7a181d" });
    // border.primary and brand.primary used to be overwritten by panel.main.
    expect(colors.border.variants.primary).toBe("#24348f");
    expect(colors.brand.variants.primary).toBe("#2f44a8");
    expect(colors["border-onPanel-main"]).toEqual({ base: "#a3b0e0", tones: false });
  });

  it("sets tones: false, so no colour is invented", () => {
    for (const prop of Object.values(colors)) expect(prop.tones).toBe(false);
    const theme = createTheme(raw, { adapter: createNoopAdapter() });
    const tokens = Object.keys(theme.tokens).filter(k => k.startsWith("colors."));
    expect(tokens.some(k => /\.(light|lighter|dark|darker)$/.test(k))).toBe(false);
  });

  it("takes the first member in name order as the base of a group with no $root, and reports it", () => {
    expect(colors["palette-indigo"].base).toBe("#eef1fb"); // "010", not "100" (JSON key order)
    expect(Object.keys(colors["palette-indigo"].variants)).toHaveLength(5);
    expect(report.bases).toContainEqual({ property: "colors.palette-indigo", from: "010" });
  });

  it("records where every colour landed", () => {
    expect(report.placements["panel.main.$root"]).toBe("colors.panel-main");
    expect(report.placements["panel.main.hover"]).toBe("colors.panel-main.hover");
    expect(report.placements["color.palette.indigo.090"]).toBe("colors.palette-indigo.090");
  });

  it("turns spaces and punctuation in names into dashes", () => {
    const { raw: r } = importDTCG({
      color: { $type: "color", neutral: { "Stone 6": { $value: "#5c6370" }, "Off White": { $value: "#ffffff" } } },
    } as unknown as DTCGDocument);
    expect(Object.keys((r.colors as any).neutral.variants)).toEqual(["Off-White", "Stone-6"]);
  });

  it("keeps a colour alias to another document as an external property", () => {
    const { raw: r } = importDTCG({
      color: { $type: "color", surface: { $value: "{color.brand}" } },
    } as unknown as DTCGDocument);
    expect((r.colors as any).surface).toEqual({ external: "colors.brand" });
  });
});

describe("importDTCG — dimensions, by path keyword", () => {
  it("places each dimension in the property its path names", () => {
    expect((raw.layout as any).spacing.variants).toEqual({ "padding-field-compact": 8, "padding-field-default": 12 });
    expect((raw.borders as any).radius).toEqual({ base: 4, variants: { default: 4, round: 999 } });
    expect((raw.typography as any).fontSize.variants["700"]).toBe(28);
    expect((raw.effects as any).blur.variants).toEqual({ "elevation-low-blur": 8 });
  });

  it("splits a mixed group: elevation's colour goes to colours, its blur to effects", () => {
    expect(colors["elevation-low"]).toEqual({ base: "#cccccc", tones: false });
    expect(report.placements["elevation.low.blur"]).toBe("effects.blur.elevation-low-blur");
  });

  it("keeps a non-px unit instead of assuming a 16px root", () => {
    const { raw: r } = importDTCG({
      spacing: { $type: "dimension", md: { $value: { value: 1.5, unit: "rem" } } },
    } as unknown as DTCGDocument);
    expect((r.layout as any).spacing.base).toBe("1.5rem");
  });

  it("honours groupMapping, including ignore", () => {
    const doc = {
      tokens: { $type: "dimension", a: { $value: "4px" } },
      skip: { $type: "dimension", gap: { $value: "8px" } },
    } as unknown as DTCGDocument;
    const { raw: r, report: rep } = importDTCG(doc, { groupMapping: { tokens: "borders", skip: "ignore" } });
    expect((r.borders as any).radius.base).toBe(4);
    expect(rep.unmapped).toEqual([{ path: "skip.gap", reason: "ignored by groupMapping" }]);
  });

  it("reads a breakpoint group as breakpoints", () => {
    const { raw: r } = importDTCG(
      { bp: { $type: "dimension", md: { $value: "768px" }, lg: { $value: { value: 64, unit: "rem" } } } } as unknown as DTCGDocument,
      { breakpointGroup: "bp" },
    );
    expect(r.breakpoints).toEqual({ md: 768, lg: 1024 });
  });
});

describe("importDTCG — text styles", () => {
  it("turns each typography token into a recipe whose fields name typography variants", () => {
    const typography = raw.typography as any;
    expect(typography.recipes.text["heading-h1"]).toEqual({
      fontFamily: "heading-h1",
      fontSize: "heading-h1",
      fontWeight: "heading-h1",
      lineHeight: "heading-h1",
      letterSpacing: "heading-h1",
    });
    expect(typography.fontSize.variants["heading-h1"]).toBe(28);
    expect(typography.lineHeight.variants["heading-h1"]).toBe(1.2);
    expect(report.placements["text.heading.h1"]).toBe("typography.recipes.text.heading-h1");
  });

  it("references an imported token when a text style aliases it", () => {
    const { raw: r } = importDTCG({
      font: { size: { $type: "dimension", "700": { $value: "28px" } } },
      text: { $type: "typography", h1: { $value: { fontFamily: "Inter", fontSize: "{font.size.700}", fontWeight: 700, lineHeight: 1.2 } } },
    } as unknown as DTCGDocument);
    const typography = r.typography as any;
    expect(typography.recipes.text.h1.fontSize).toBe("700");
    expect(typography.fontSize.variants).toEqual({ "700": 28 }); // no per-style copy
  });
});

describe("importDTCG — shadows", () => {
  const fixture = load("dtcg-2025-10.tokens.json");
  const { raw: r } = importDTCG(fixture);
  const shadow = (r.effects as any).shadow;

  it("writes structured layers whose colour is the imported colour they alias", () => {
    expect(shadow.base).toBe("none");
    expect(shadow.variants.low).toEqual([{ offsetX: 0, offsetY: 2, blur: 8, spread: 0, color: "colors.elevation-low" }]);
    expect(shadow.variants.focus[0].color).toBe("colors.brand-primary");
    expect(shadow.variants.focus[1]).toMatchObject({ spread: 4, inset: true, color: "colors.palette-blue.100" });
  });

  it("gives a literal shadow colour a colour property of its own", () => {
    const { raw: lit } = importDTCG({
      shadow: { $type: "shadow", card: { $value: { color: "#00000026", offsetX: "0px", offsetY: "1px", blur: "2px", spread: "0px" } } },
    } as unknown as DTCGDocument);
    expect((lit.effects as any).shadow.variants.card[0].color).toBe("colors.shadow-card");
    expect((lit.colors as any)["shadow-card"]).toMatchObject({ tones: false });
  });

  it("builds: the whole 2025.10 fixture, shadows included", () => {
    expect(() => createTheme(r, { adapter: createNoopAdapter() })).not.toThrow();
  });
});

describe("importDTCG — the report", () => {
  it("accounts for every token in the sample", () => {
    expect(report.tokens).toBe(24);
    expect(report.mapped).toBe(24);
    expect(report.unmapped).toEqual([]);
    expect(report.renamed).toEqual([]);
    expect(report.diagnostics).toEqual([]);
  });

  it("says why a token was left out", () => {
    const { report: rep } = importDTCG({
      dimension: { $type: "dimension", "100": { $value: "4px" }, "350": { $value: "10px" } },
      gap: { $type: "dimension", sm: { $value: "{dimension.100}" } },
      fade: { $type: "gradient", $value: [{ color: "#000000", position: 0 }] },
      mystery: { $value: 1 },
    } as unknown as DTCGDocument);
    const why = Object.fromEntries(rep.unmapped.map(u => [u.path, u.reason]));
    expect(why["dimension.100"]).toBe("used by gap.sm, which carries its value");
    expect(why["dimension.350"]).toMatch(/^no placement for a dimension/);
    expect(why["fade"]).toBe("gradients have no refract equivalent");
    expect(why["mystery"]).toMatch(/no \$type/);
    expect(rep.mapped).toBe(1);
  });

  it("renames a member that would overwrite another", () => {
    const { raw: r, report: rep } = importDTCG({
      color: { $type: "color", x: { "a b": { $value: "#111111" }, "a-b": { $value: "#222222" } } },
    } as unknown as DTCGDocument);
    expect(Object.keys((r.colors as any).x.variants)).toEqual(["a-b", "a-b-2"]);
    expect(rep.renamed).toEqual([{ path: "color.x.a-b", from: "a-b", to: "a-b-2" }]);
  });

  it("fromDTCG is the raw half of importDTCG", () => {
    expect(fromDTCG(sample)).toEqual(raw);
  });

  it("prints as CLI lines: per-subsystem counts, chosen bases, and what was left out", () => {
    const lines = importReportLines(raw, report);
    expect(lines).toContain("  colors       7 properties · 11 variants");
    expect(lines).toContain("  typography   5 properties · 12 variants · 2 recipes");
    expect(lines).toContain('    colors.palette-indigo ← "010"');
    expect(lines).toContain("  unmapped: none");
    expect(lines.filter(l => l.startsWith("    …"))).toEqual(["    … 3 more"]); // 11 bases, 8 shown
  });
});
