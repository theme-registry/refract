// The DTCG token graph — parsing DTCG 2025.10 (and 2024-draft) documents into typed tokens with
// canonical values, alias edges, `$root`, `$extends`, JSON Pointer `$ref`, preserved `$extensions`
// and diagnostics. Plus the `parseDTCGDocument` view `fromDTCG` still maps from.
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { parseDTCGGraph, parseDTCGDocument, fromDTCG, type DTCGDocument } from "../src/dtcg";
import { createTheme, RefractError } from "../src/core";
import { createNoopAdapter } from "../src/core/noopAdapter";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/dtcg-2025-10.tokens.json", import.meta.url), "utf8"),
) as DTCGDocument;

const graph = parseDTCGGraph(fixture);
const tok = (id: string) => {
  const t = graph.byId.get(id);
  if (!t) throw new Error(`no token ${id}`);
  return t;
};

describe("dtcg graph — 2025.10 parsing", () => {
  it("reads every token, including group $root tokens, in document order", () => {
    expect(graph.tokens).toHaveLength(30);
    expect(graph.tokens[0].id).toBe("color.palette.blue.100");
    expect(tok("brand.primary.$root").path).toEqual(["brand", "primary", "$root"]);
    expect(tok("elevation.low.$root").type).toBe("color");
  });

  it("keeps colour objects canonical and reads native spaces", () => {
    expect(tok("color.palette.blue.500").value).toEqual({
      colorSpace: "srgb",
      components: [0.298, 0.4314, 0.9608],
      hex: "#4c6ef5",
    });
    expect(tok("color.palette.blue.900").value).toMatchObject({ colorSpace: "oklch" });
  });

  it("canonicalizes dimensions, durations, font weights and composites", () => {
    expect(tok("dimension.200").value).toEqual({ value: 0.5, unit: "rem" });
    expect(tok("motion.duration.fast").value).toEqual({ value: 150, unit: "ms" });
    expect(tok("font.weight.regular").value).toBe(400);
    expect(tok("text.body").value).toEqual({
      fontFamily: ["Inter", "sans-serif"],
      fontSize: { value: 16, unit: "px" },
      fontWeight: 400,
      letterSpacing: { value: 0, unit: "px" },
      lineHeight: 1.5,
    });
  });

  it("keeps whole-value aliases as edges and takes an untyped alias's type from its target", () => {
    const root = tok("brand.primary.$root");
    expect(root.alias).toBe("color.palette.blue.500");
    expect(root.value).toEqual(tok("color.palette.blue.500").value);
    expect(root.raw).toBe("{color.palette.blue.500}");

    const surface = tok("surface");
    expect(surface.type).toBe("color");
    expect(surface.alias).toBe("color.palette.grey.Stone 6");
  });

  it("resolves aliases inside composites and records them as references", () => {
    const low = tok("shadow.low");
    expect(low.references).toEqual(["elevation.low.$root", "elevation.low.y", "elevation.low.blur"]);
    expect(low.value).toMatchObject({
      color: { colorSpace: "srgb", alpha: 0.15 },
      offsetY: { value: 2, unit: "px" },
      blur: { value: 8, unit: "px" },
    });
    const focus = tok("shadow.focus");
    expect(Array.isArray(focus.value)).toBe(true);
    expect(focus.references).toEqual(["brand.primary.$root", "color.palette.blue.100"]);
  });

  it("resolves JSON Pointer $refs, to a token and into another token's value", () => {
    expect(tok("spacing.inset").alias).toBe("dimension.100");
    expect(tok("spacing.inset").value).toEqual({ value: 4, unit: "px" });
    expect(tok("radius.md").value).toEqual({ value: 0.5, unit: "rem" });
    expect(tok("focusColor").alias).toBe("shadow.low");
    expect(tok("focusColor").value).toMatchObject({ colorSpace: "srgb", alpha: 0.15 });
  });

  it("deep-merges $extends groups and inherits a group's $deprecated", () => {
    expect(tok("theme.legacy.fg").alias).toBe("color.palette.blue.900"); // inherited from theme.base
    expect(tok("theme.legacy.bg").alias).toBe("color.palette.blue.900"); // overridden
    expect(tok("theme.legacy.bg").deprecated).toBe("Use theme.base");
    expect(tok("theme.base.bg").deprecated).toBeUndefined();
  });

  it("preserves $extensions on tokens and on the document", () => {
    expect(tok("color.palette.blue.500").extensions).toEqual({
      "com.figma": { collection: "primitives", scopes: ["ALL_SCOPES"] },
    });
    expect(graph.extensions).toEqual({ "com.example.exporter": { version: 1, source: "synthetic" } });
    expect(tok("text.body").description).toBe("Body copy");
  });

  it("reports only what the spec or refract can't read", () => {
    expect(graph.diagnostics.map(d => [d.severity, d.code, d.path])).toEqual([
      ["warning", "color-space-fallback", "color.palette.wide"],
      ["error", "color-space-unsupported", "color.palette.lost"],
    ]);
  });
});

describe("dtcg graph — 2024-draft input", () => {
  it("reads 2024 string values into the same canonical shapes", () => {
    const g = parseDTCGGraph({
      color: { $type: "color", brand: { $value: "#4c6ef5" }, faint: { $value: "rgba(0, 0, 0, 0.5)" } },
      size: { $type: "dimension", md: { $value: "16px" }, zero: { $value: "0" } },
      fast: { $type: "duration", $value: "200ms" },
    } as unknown as DTCGDocument);
    expect(g.byId.get("color.brand")!.value).toEqual({
      colorSpace: "srgb",
      components: [0.298, 0.4314, 0.9608],
      hex: "#4c6ef5",
    });
    expect(g.byId.get("color.faint")!.value).toMatchObject({ alpha: 0.5, hex: "#000000" });
    expect(g.byId.get("size.md")!.value).toEqual({ value: 16, unit: "px" });
    expect(g.byId.get("size.zero")!.value).toEqual({ value: 0, unit: "px" });
    expect(g.byId.get("fast")!.value).toEqual({ value: 200, unit: "ms" });
    expect(g.diagnostics).toEqual([]);
  });
});

describe("dtcg graph — diagnostics and errors", () => {
  const diag = (doc: unknown) =>
    parseDTCGGraph(doc as DTCGDocument).diagnostics.map(d => [d.severity, d.code, d.path]);

  it("rejects values the spec doesn't allow, without guessing", () => {
    expect(
      diag({
        heavy: { $type: "fontWeight", $value: 1200 },
        bare: { $type: "dimension", $value: "16" },
        curve: { $type: "cubicBezier", $value: [0, 0, 1.5, 1] },
        mystery: { $value: 4 },
        em: { $type: "dimension", $value: { value: 1, unit: "em" } },
      }),
    ).toEqual([
      ["error", "invalid-value", "heavy"],
      ["error", "invalid-value", "bare"],
      ["error", "invalid-value", "curve"],
      ["error", "type-unknown", "mystery"],
      ["warning", "dimension-unit", "em"],
    ]);
  });

  it("keeps an alias to a token outside the document as an external edge", () => {
    const g = parseDTCGGraph({ color: { $type: "color", surface: { $value: "{color.brand}" } } } as unknown as DTCGDocument);
    const surface = g.byId.get("color.surface")!;
    expect(surface.external).toBe("color.brand");
    expect(surface.value).toBeUndefined();
    expect(g.diagnostics.map(d => d.code)).toEqual(["alias-unresolved"]);
  });

  it("treats a JSON Pointer $ref to nothing as an error, not an external alias", () => {
    const g = parseDTCGGraph({ c: { $type: "color", $value: { $ref: "#/nope" } } } as unknown as DTCGDocument);
    expect(g.byId.get("c")!.external).toBeUndefined();
    expect(g.byId.get("c")!.value).toBeUndefined();
    expect(g.diagnostics.map(d => [d.severity, d.code])).toEqual([["error", "alias-unresolved"]]);
    expect(parseDTCGDocument({ c: { $type: "color", $value: { $ref: "#/nope" } } } as unknown as DTCGDocument)).toEqual([]);
  });

  it("reports an $extends that names no group", () => {
    expect(diag({ a: { $extends: "{nope}", x: { $type: "number", $value: 1 } } })).toEqual([
      ["error", "extends-unresolved", "a"],
    ]);
  });

  it("throws REFRACT_E_CYCLE on a circular alias or $extends", () => {
    const aliasCycle = { a: { $type: "color", $value: "{b}" }, b: { $type: "color", $value: "{a}" } };
    const extendsCycle = { a: { $extends: "{b}" }, b: { $extends: "{a}" } };
    for (const doc of [aliasCycle, extendsCycle]) {
      try {
        parseDTCGGraph(doc as unknown as DTCGDocument);
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(RefractError);
        expect((err as RefractError).code).toBe("REFRACT_E_CYCLE");
      }
    }
  });
});

describe("parseDTCGDocument — the 2024 string view fromDTCG maps from", () => {
  const flat = parseDTCGDocument(fixture);
  const at = (path: string) => flat.find(t => t.path.join(".") === path)?.value;

  it("serializes 2025.10 objects to the strings the importer reads", () => {
    expect(at("color.palette.blue.500")).toBe("#4c6ef5");
    expect(at("color.palette.grey.Stone 6")).toBe("#5c6370"); // hsl(220 10% 40%)
    expect(at("color.palette.wide")).toBe("#4c6ef5"); // through the hex fallback
    expect(at("elevation.low.base")).toBe("rgba(0, 0, 0, 0.15)");
    expect(at("dimension.200")).toBe("0.5rem");
    expect(at("shadow.low")).toMatchObject({ offsetY: "2px", blur: "8px", color: "rgba(0, 0, 0, 0.15)" });
  });

  it("reads a $root token as its group's base, and drops a colour it can't read", () => {
    expect(at("brand.primary.base")).toBe("#4c6ef5");
    expect(flat.some(t => t.path.includes("$root"))).toBe(false);
    expect(at("color.palette.lost")).toBeUndefined();
    expect(flat).toHaveLength(29);
  });

  it("fromDTCG on a 2025.10 document produces no [object Object] and builds", () => {
    expect(JSON.stringify(fromDTCG(fixture))).not.toContain("[object Object]");
    // Shadows are left out of the build: see the todo below.
    const { shadow: _shadow, ...noShadows } = fixture as Record<string, unknown>;
    const raw = fromDTCG(noShadows as DTCGDocument);
    expect(() => createTheme(raw, { adapter: createNoopAdapter() })).not.toThrow();
  });

  // fromDTCG still maps a shadow to a CSS string, which effects has rejected since shadows became
  // structured (colour = a `colors.*` path). Needs the importer's naming map: Step B.
  it.todo("fromDTCG maps shadow tokens to structured layers that build");
});
