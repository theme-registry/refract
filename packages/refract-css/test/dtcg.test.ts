import { describe, it, expect } from "vitest";
// Runtime surface from the root entry; DTCG interop from its dedicated `./dtcg` subpath (Step 9).
import { createTheme } from "@theme-registry/refract";
import { createCssAdapter } from "../src";
import { fromDTCG, toDTCG, parseDTCGDocument, type DTCGDocument } from "@theme-registry/refract/dtcg";
import { reactSc } from "@theme-registry/theme-fixtures";

const adapter = () => createCssAdapter();

// A small, well-typed DTCG document exercising color / dimension / composite tokens,
// a reference (`{color.brand.500}`), and a breakpoint group.
const sampleDoc: DTCGDocument = {
  $name: "sample",
  color: {
    $type: "color",
    brand: {
      500: { $value: "#4dabf7" },
      600: { $value: "#1c7ed6" },
      100: { $value: "#a5d8ff" },
    },
    accent: { $value: "{color.brand.500}" },
  },
  spacing: {
    $type: "dimension",
    base: { $value: "16px" },
    sm: { $value: "8px" },
    lg: { $value: "1.5rem" },
  },
  radius: {
    $type: "dimension",
    base: { $value: "6px" },
    lg: { $value: "12px" },
  },
  breakpoint: {
    $type: "dimension",
    md: { $value: "768px" },
    lg: { $value: "1024px" },
  },
};

describe("dtcg — parse", () => {
  it("resolves references and reports paths/types", () => {
    const tokens = parseDTCGDocument(sampleDoc);
    const accent = tokens.find(t => t.path.join(".") === "color.accent");
    expect(accent?.value).toBe("#4dabf7"); // {color.brand.500} resolved
    expect(accent?.type).toBe("color");
    const spacingSm = tokens.find(t => t.path.join(".") === "spacing.sm");
    expect(spacingSm?.type).toBe("dimension");
    expect(spacingSm?.value).toBe("8px");
  });
});

describe("dtcg — fromDTCG → createTheme", () => {
  it("produces a raw input that builds a theme", () => {
    const raw = fromDTCG(sampleDoc, { breakpointGroup: "breakpoint" });

    // Raw shape (unchanged authoring shape) — nested subsystem slices.
    expect(raw.colors).toBeTruthy();
    expect(raw.breakpoints).toEqual({ md: 768, lg: 1024 });
    // rem → px (16px base) in the layout mapping.
    const spacing = (raw.layout as any).spacing;
    expect(spacing.base).toBe(16);
    expect(spacing.variants.lg).toBe(24);

    // Feeds createTheme (adapter required) and yields flat tokens.
    const theme = createTheme(raw, { adapter: adapter() });
    expect(theme.tokens["colors.brand"]).toBeTruthy();
    expect(theme.model.breakpoints).toEqual({ md: 768, lg: 1024 });
  });
});

describe("dtcg — toDTCG (flat theme.tokens, model-first)", () => {
  const theme = createTheme(reactSc.rawTheme, { adapter: createCssAdapter(reactSc.options as any) });
  const doc = toDTCG(theme, { name: "reactSc" });

  it("carries the document name and breakpoints from the Model", () => {
    expect(doc.$name).toBe("reactSc");
    expect((doc.breakpoint as any).$type).toBe("dimension");
    expect((doc.breakpoint as any).sm).toEqual({ $value: "576px" });
    expect((doc.breakpoint as any).xl).toEqual({ $value: "1280px" });
  });

  it("emits colors with base, text (as a sibling), and variants", () => {
    const color = doc.color as any;
    expect(color.$type).toBe("color");
    expect(color.primary.base).toEqual({ $value: "#4dabf7" });
    expect(color.primary.text).toEqual({ $value: "#ffffff" });
    expect(color.primary.dark).toEqual({ $value: "#1c7ed6" });
  });

  it("emits typography with per-property groups and px-formatted font sizes", () => {
    const typo = doc.typography as any;
    expect(typo.fontSize.$type).toBe("dimension");
    expect(typo.fontSize.base).toEqual({ $value: "16px" });
    expect(typo.fontSize.xs).toEqual({ $value: "12px" });
    expect(typo.fontWeight.$type).toBe("fontWeight");
    expect(typo.fontFamily.$type).toBe("fontFamily");
  });

  it("emits effects grouped/typed by property (transitions → transition)", () => {
    expect((doc.radius as any).$type).toBe("dimension");
    expect((doc.radius as any).base).toEqual({ $value: "6px" });
    expect((doc.radius as any).full).toEqual({ $value: "9999px" }); // string kept
    expect((doc.shadow as any).$type).toBe("shadow");
    expect((doc.transition as any).$type).toBe("transition"); // "transitions" → "transition"
  });

  it("emits layout dimension tokens and skips structural-config knobs", () => {
    expect((doc.spacing as any).$type).toBe("dimension");
    expect((doc.spacing as any).base).toEqual({ $value: "8px" });
    // `layout.container--inset` (a `--` config knob) must not leak into the document.
    expect(doc.container).toBeUndefined();
    const hasDoubleDash = Object.keys(doc).some(k => k.includes("--"));
    expect(hasDoubleDash).toBe(false);
  });

  it("does not carry recipes/composition (property tokens only)", () => {
    // No component/recipe groups surface as DTCG groups.
    expect(doc.buttons).toBeUndefined();
    expect(doc.solid).toBeUndefined();
  });
});

describe("dtcg — round-trip (property tokens)", () => {
  it("toDTCG(createTheme(fromDTCG(doc))) preserves dimension tokens", () => {
    const raw = fromDTCG(sampleDoc, { breakpointGroup: "breakpoint" });
    const theme = createTheme(raw, { adapter: adapter() });
    const out = toDTCG(theme);

    // Dimension groups survive the round-trip byte-for-value (px normalized).
    expect((out.spacing as any).base).toEqual({ $value: "16px" });
    expect((out.spacing as any).sm).toEqual({ $value: "8px" });
    expect((out.spacing as any).lg).toEqual({ $value: "24px" }); // 1.5rem → 24px
    expect((out.radius as any).base).toEqual({ $value: "6px" });
    expect((out.radius as any).lg).toEqual({ $value: "12px" });
    expect((out.breakpoint as any).md).toEqual({ $value: "768px" });
  });
});

describe("dtcg — external aliases (dec.6 / §12 Phase 2)", () => {
  it("imports a genuinely-external DTCG alias (absent target) as a refract `external` token", () => {
    // `color.brand` is NOT defined in this document → the alias is genuinely external (parent-owned).
    const doc = { color: { $type: "color", surface: { $value: "{color.brand}" } } } as unknown as DTCGDocument;
    const raw = fromDTCG(doc) as any;
    expect(raw.colors.surface).toEqual({ external: "colors.brand" });
    // and it builds + lowers to a parent var passthrough (no local :root definition).
    const css = createTheme(raw, { adapter: createCssAdapter({ prefix: "dt" }) }).css as string;
    expect(css.includes("--dt-colors-surface:")).toBe(false); // parent owns it — no local def
  });

  it("a RESOLVABLE same-doc alias stays a flattened literal (not external)", () => {
    const doc = {
      color: { $type: "color", brand: { $value: "#4c6ef5" }, surface: { $value: "{color.brand}" } },
    } as unknown as DTCGDocument;
    const raw = fromDTCG(doc) as any;
    expect(raw.colors.surface).toEqual({ base: "#4c6ef5" }); // resolved in-doc → literal, no external
  });
});
