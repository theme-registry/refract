/**
 * The Refract DTCG profile reader, token layer: a profile token file → a raw theme that builds.
 * Uses the synthetic example in fixtures/dtcg-profile; document-level cases (recipes, components,
 * globals, keyframes, layout structure) at the end.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createTheme, createNoopAdapter, RefractError } from "../src/core";
import { readDTCGProfile } from "../src/dtcg/profile";
import type { DTCGDocument } from "../src/dtcg/types";

const KEY = "com.theme-registry.refract.profile";
const read = (rel: string) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));
const fixture = (): any => read("./fixtures/dtcg-profile/base.tokens.json");
const doc = (body: Record<string, unknown>, docExt: Record<string, unknown> = {}): DTCGDocument =>
  ({ $extensions: { [KEY]: { version: 1, ...docExt } }, ...body }) as unknown as DTCGDocument;
const srgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return { colorSpace: "srgb", components: [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255], hex };
};
const failure = (d: DTCGDocument): { code?: string; message: string } => {
  try {
    readDTCGProfile(d);
  } catch (e) {
    expect(e).toBeInstanceOf(RefractError);
    return { code: (e as RefractError).code, message: (e as Error).message };
  }
  throw new Error("expected readDTCGProfile to throw");
};

describe("profile reader — the example file", () => {
  const { raw, report } = readDTCGProfile(fixture());
  const theme = createTheme(raw, { adapter: createNoopAdapter() });

  it("builds", () => {
    expect(Object.keys(theme.tokens).length).toBeGreaterThan(10);
  });

  it("reads breakpoints and containers", () => {
    expect(raw.breakpoints).toEqual({ sm: 576, md: 768, lg: 1024 });
    expect(raw.containers).toEqual({ card: { type: "inline-size", sizes: { sm: 280, md: 480 } } });
  });

  it("maps a group to a property, $root to the base and text to the text extra", () => {
    expect(theme.resolveToken("colors.brand")).toBe("rgb(76, 110, 245)");
    expect(theme.resolveToken("colors.brand.text")).toBe("rgb(255, 255, 255)");
  });

  it("regenerates generated tokens from the group settings", () => {
    expect(report.generated).toEqual(["colors.brand.dark", "layout.spacing.md"]);
    expect(theme.resolveToken("colors.brand.dark")).toBe("rgb(51, 77, 210)");
    expect(theme.resolveToken("colors.brand.lighter")).toBeDefined();
    expect(report.diagnostics.filter(d => d.code === "generated-value-drift")).toEqual([]);
  });

  it("keeps tones: false", () => {
    expect(Object.keys(theme.tokens).filter(p => p.startsWith("colors.surface."))).toEqual([]);
  });

  it("keeps an alias as an alias", () => {
    expect(theme.tokens["colors.highlight"].ref).toBe("colors.brand");
  });

  it("reads typography, the layout scale and the easing keyword", () => {
    expect(theme.resolveToken("typography.fontFamily")).toBe("Inter, sans-serif");
    expect(theme.resolveToken("typography.fontSize.lg")).toBe(20);
    expect(theme.resolveToken("layout.spacing.sm")).toBe(8);
    expect(theme.resolveToken("layout.spacing.md")).toBe(12);
    expect(theme.resolveToken("animation.easing")).toBe("ease-in-out");
  });

  it("reads extension-only values and lists them", () => {
    expect(theme.resolveToken("typography.textTransform.upper")).toBe("uppercase");
    expect(report.extensionOnly).toEqual(["typography.textTransform", "typography.textTransform.upper"]);
  });

  it("keeps a responsive value on a generated step", () => {
    expect(raw.layout?.spacing).toMatchObject({ step: 4, responsive: [{ breakpoint: "sm", query: "max", target: "md", base: 8 }] });
  });
});

describe("profile reader — single cases", () => {
  it("reports drift and uses the rule", () => {
    const { report } = readDTCGProfile(
      doc({
        colors: {
          $type: "color",
          brand: {
            $root: { $value: srgb("#4c6ef5") },
            dark: { $value: srgb("#000000"), $extensions: { [KEY]: { generated: "tones" } } },
          },
        },
      }),
    );
    const drift = report.diagnostics.find(d => d.code === "generated-value-drift");
    expect(drift?.path).toBe("colors.brand.dark");
  });

  it("reports a generated token the rule doesn't produce", () => {
    const { report } = readDTCGProfile(
      doc({
        colors: {
          $type: "color",
          brand: {
            $extensions: { [KEY]: { tones: false } },
            $root: { $value: srgb("#4c6ef5") },
            dark: { $value: srgb("#334dd2"), $extensions: { [KEY]: { generated: "tones" } } },
          },
        },
      }),
    );
    expect(report.diagnostics.find(d => d.code === "generated-not-produced")?.path).toBe("colors.brand.dark");
  });

  it("reads a derivation, a responsive base switch, and variant extras", () => {
    const { raw } = readDTCGProfile(
      doc(
        {
          colors: {
            $type: "color",
            brand: {
              $root: {
                $value: srgb("#4c6ef5"),
                $extensions: { [KEY]: { responsive: [{ breakpoint: "md", query: "min", variant: "deep" }] } },
              },
              deep: { $value: srgb("#24348f") },
              soft: {
                $value: srgb("#91a7ff"),
                $extensions: { [KEY]: { derive: { ref: "{colors.brand}", modifiers: [{ lighten: 15 }] } } },
              },
              light: { $value: srgb("#dbe4ff"), $extensions: { [KEY]: { extras: { text: srgb("#1a1e29") } } } },
            },
          },
        },
        { breakpoints: { md: 768 } },
      ),
    );
    const brand = (raw.colors as any).brand;
    expect(brand.variants.soft).toEqual({ modifiers: [{ lighten: 15 }] }); // the own base: no ref
    expect(brand.responsive).toEqual([{ breakpoint: "md", query: "min", ref: "deep" }]);
    expect(brand.variants.light.text).toBe("#1a1e29");
    expect(() => createTheme(raw, { adapter: createNoopAdapter() })).not.toThrow();
  });

  it("reads shadows with a colour alias and an external", () => {
    const { raw } = readDTCGProfile(
      doc({
        colors: { $type: "color", shadow: { $root: { $value: srgb("#000000") } }, brand: { $root: { $value: "{parent.brand}" } } },
        effects: {
          shadow: {
            $type: "shadow",
            $root: { $value: { color: "{colors.shadow.$root}", offsetX: { value: 0, unit: "px" }, offsetY: { value: 2, unit: "px" }, blur: { value: 4, unit: "px" }, spread: { value: 0, unit: "px" } } },
          },
        },
      }),
    );
    expect((raw.effects as any).shadow.base[0]).toMatchObject({ color: "colors.shadow", offsetY: 2, blur: 4 });
    expect((raw.colors as any).brand).toEqual({ external: "parent.brand" });
  });

  const rejects: Array<[string, DTCGDocument, RegExp]> = [
    ["a file with no profile key", { colors: {} } as unknown as DTCGDocument, /not a Refract profile file/],
    ["another version", doc({}, { version: 2 }), /version 2 isn't supported/],
    ["a top-level group that isn't a subsystem", doc({ color: {} }), /"color" isn't a subsystem/],
    ["an unknown layout property", doc({ layout: { padding: { $type: "dimension", $root: { $value: { value: 8, unit: "px" } } } } }), /layout\.padding/],
    ["a property with no base", doc({ colors: { $type: "color", brand: { dark: { $value: srgb("#000000") } } } }), /no base/],
    ["a nested group", doc({ colors: { $type: "color", brand: { $root: { $value: srgb("#000000") }, alert: { danger: { $value: srgb("#ff0000") } } } } }), /groups don't nest/],
    ["a literal shadow colour", doc({ effects: { shadow: { $type: "shadow", $root: { $value: { color: srgb("#000000"), offsetX: { value: 0, unit: "px" }, offsetY: { value: 1, unit: "px" }, blur: { value: 2, unit: "px" }, spread: { value: 0, unit: "px" } } } } } }), /alias into colors/],
    ["tones outside colours", doc({ layout: { spacing: { $type: "dimension", $extensions: { [KEY]: { tones: false } }, $root: { $value: { value: 4, unit: "px" } } } } }), /only apply to colours/],
    ["a $value alias that names a group", doc({ colors: { $type: "color", brand: { $root: { $value: srgb("#4c6ef5") } }, hl: { $root: { $value: "{colors.brand}" } } } }), /write "\{colors\.brand\.\$root\}"/],
    ["an invalid DTCG value", doc({ colors: { $type: "color", brand: { $root: { $value: 12 } } } }), /DTCG value error/],
  ];
  for (const [name, d, message] of rejects) {
    it(`rejects ${name}`, () => {
      const { code, message: m } = failure(d);
      expect(code).toBe("REFRACT_E_PROFILE");
      expect(m).toMatch(message);
    });
  }
});

describe("profile reader — document level", () => {
  const color = (hex: string) => ({ $value: srgb(hex) });
  const tokens = {
    colors: { $type: "color", brand: { $extensions: { [KEY]: { tones: false } }, $root: color("#4c6ef5"), dark: color("#334dd2"), text: color("#ffffff") }, link: { $extensions: { [KEY]: { tones: false } }, $root: color("#1c7ed6") } },
    typography: { fontSize: { $type: "dimension", $root: { $value: { value: 16, unit: "px" } }, lg: { $value: { value: 20, unit: "px" } } } },
    layout: {
      spacing: { $type: "dimension", $root: { $value: { value: 4, unit: "px" } }, md: { $value: { value: 12, unit: "px" } }, lg: { $value: { value: 16, unit: "px" } } },
      sizes: { $type: "dimension", $root: { $value: { value: 8, unit: "px" } }, lg: { $value: { value: 960, unit: "px" } } },
    },
    borders: { radius: { $type: "dimension", $root: { $value: { value: 6, unit: "px" } } } },
  };
  const withDoc = (docExt: Record<string, unknown>) => doc(tokens, docExt);

  it("reads the example file's recipes and components", () => {
    const { raw } = readDTCGProfile(fixture());
    expect((raw.colors as any).recipes.solid.brand).toEqual({
      background: "brand",
      color: "brand.text",
      states: { hover: { background: "brand.dark" } },
      responsive: [{ breakpoint: "md", query: "min", background: "brand.darker" }],
    });
    expect((raw as any).components.recipes.buttons.primary.css.padding).toEqual({ ref: "layout.spacing.md" });
    const theme = createTheme(raw, { adapter: createNoopAdapter() });
    expect(theme.model.subsystems.components.ruleSets).toBeDefined();
  });

  it("maps each subsystem's recipe fields to its raw form", () => {
    const { raw } = readDTCGProfile(withDoc({
      recipes: {
        typography: { text: { body: { fontSize: "{typography.fontSize.lg}" }, base: { fontSize: "{typography.fontSize}" } } },
        layout: { box: { card: { paddingX: "{layout.spacing.md}", maxWidth: "{layout.sizes.lg}", background: "transparent" } } },
        borders: { box: { card: { radius: "{borders.radius}", color: "{colors.brand}", width: "base" } } },
      },
    }));
    expect((raw.typography as any).recipes.text).toEqual({ body: { fontSize: "lg" }, base: { fontSize: "base" } });
    expect((raw.layout as any).recipes.box.card).toEqual({ paddingX: "md", maxWidth: "lg", background: "transparent" });
    expect((raw.borders as any).recipes.box.card).toEqual({ radius: "base", color: "colors.brand", width: "base" });
  });

  it("reads globals, keyframes and the layout structure", () => {
    const { raw } = readDTCGProfile(withDoc({
      globals: { preset: "preflight", elements: { a: { color: "{colors.link}", textDecoration: "underline", states: { hover: { color: "{colors.brand}" } } } } },
      keyframes: { fade: { from: { opacity: 0 }, to: { opacity: 1, color: "{colors.brand}" } } },
      layout: { stacks: { toolbar: { direction: "row", gap: "{layout.spacing.md}" } } },
    }));
    expect((raw as any).globals.elements.a).toEqual({ color: { ref: "colors.link" }, textDecoration: "underline", states: { hover: { color: { ref: "colors.brand" } } } });
    expect((raw.animation as any).keyframes.fade.to).toEqual({ opacity: 1, color: { ref: "colors.brand" } });
    expect((raw.layout as any).stacks.toolbar).toEqual({ direction: "row", gap: "md" });
    expect(() => createTheme(raw, { adapter: createNoopAdapter() })).not.toThrow();
  });

  const rejects: Array<[string, Record<string, unknown>, RegExp]> = [
    ["a colour recipe pointing at a non-colour", { recipes: { colors: { solid: { a: { background: "{layout.spacing.md}" } } } } }, /colour recipe takes colour tokens/],
    ["a typography field pointing at another property", { recipes: { typography: { text: { a: { fontSize: "{typography.lineHeight.lg}" } } } } }, /must point into typography\.fontSize/],
    ["an alias in a literal-only field", { recipes: { layout: { box: { a: { background: "{colors.brand}" } } } } }, /"background" doesn't take a token/],
    ["a composition field written as an alias", { recipes: { components: { buttons: { a: { colors: "{colors.brand}" } } } } }, /names a recipe/],
    ["a raw { ref } object in a recipe field", { recipes: { colors: { solid: { a: { background: { ref: "colors.brand" } } } } } }, /takes a \{…\} alias or a literal/],
    ["recipes for something that isn't a subsystem", { recipes: { buttons: {} } }, /not a subsystem with recipes/],
    ["an unknown layout structure key", { layout: { padding: {} } }, /takes columns, grids, stacks, container/],
  ];
  for (const [name, docExt, message] of rejects) {
    it(`rejects ${name}`, () => {
      const { code, message: m } = failure(withDoc(docExt));
      expect(code).toBe("REFRACT_E_PROFILE");
      expect(m).toMatch(message);
    });
  }
});
