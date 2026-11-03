/**
 * The Refract DTCG profile reader, Resolver stage: a resolver + token files → one raw theme with
 * `as: "modes"` contexts folded in as `modes`, plus partial child themes for `as: "themes"` contexts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createTheme, createNoopAdapter, RefractError } from "../src/core";
import { readDTCGProfileSet } from "../src/dtcg/resolver";
import type { DTCGResolverDocument } from "../src/dtcg/resolver";

const KEY = "com.theme-registry.refract.profile";
const read = (rel: string) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));
const srgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return { colorSpace: "srgb", components: [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255], hex };
};

const fixtureFiles = () => {
  const base = read("./fixtures/dtcg-profile/base.tokens.json");
  delete base.$extensions[KEY].recipes; // the document-level stage comes next
  return { "base.tokens.json": base, "dark.tokens.json": read("./fixtures/dtcg-profile/dark.tokens.json") };
};

const small = (extra: Partial<DTCGResolverDocument> = {}, files: Record<string, unknown> = {}) => ({
  resolver: {
    version: "2025.10",
    sets: { base: { sources: [{ $ref: "base.json" }] } },
    resolutionOrder: [{ $ref: "#/sets/base" }],
    ...extra,
  } as DTCGResolverDocument,
  files: {
    "base.json": {
      $extensions: { [KEY]: { version: 1 } },
      colors: {
        $type: "color",
        surface: { $extensions: { [KEY]: { tones: false } }, $root: { $value: srgb("#ffffff") } },
        brand: { $extensions: { [KEY]: { tones: false } }, $root: { $value: srgb("#4c6ef5") }, hover: { $value: srgb("#3b5bdb") } },
      },
    },
    ...files,
  } as never,
});

const failure = (input: Parameters<typeof readDTCGProfileSet>[0]): string => {
  try {
    readDTCGProfileSet(input);
  } catch (e) {
    expect(e).toBeInstanceOf(RefractError);
    expect((e as RefractError).code).toBe("REFRACT_E_PROFILE");
    return (e as Error).message;
  }
  throw new Error("expected readDTCGProfileSet to throw");
};

describe("profile resolver — the example files", () => {
  const { raw, report } = readDTCGProfileSet({ resolver: read("./fixtures/dtcg-profile/resolver.json"), files: fixtureFiles() });
  const theme = createTheme(raw, { adapter: createNoopAdapter() });

  it("folds the dark context into modes", () => {
    expect(report.modes).toEqual(["dark"]);
    expect(raw.modes).toEqual(["dark", "light"]);
    const surface = theme.model.subsystems.colors.properties!.surface;
    expect(surface.modes).toEqual([{ mode: "dark", overrides: { base: { value: "rgb(20, 23, 28)" } } }]);
  });

  it("keeps the default context as the base", () => {
    expect(theme.resolveToken("colors.surface")).toBe("rgb(255, 255, 255)");
  });
});

describe("profile resolver — single cases", () => {
  const modes = (contexts: Record<string, unknown[]>, def = "light", as?: string) => ({
    modifiers: { scheme: { ...(as ? { $extensions: { [KEY]: { as } } } : {}), default: def, contexts } },
    resolutionOrder: [{ $ref: "#/sets/base" }, { $ref: "#/modifiers/scheme" }],
  });

  it("puts a changed variant in a targeted mode, and an alias as a mode alias", () => {
    const input = small(modes({ light: [], dark: [{ $ref: "dark.json" }] }), {
      "dark.json": { colors: { brand: { hover: { $value: srgb("#91a7ff") } }, surface: { $root: { $value: "{colors.brand.$root}" } } } },
    });
    const { raw } = readDTCGProfileSet(input);
    const colors = raw.colors as any;
    expect(colors.brand.modes).toEqual([{ mode: "dark", target: "hover", base: "#91a7ff" }]);
    expect(colors.surface.modes).toEqual([{ mode: "dark", ref: "colors.brand" }]);
    expect(() => createTheme(raw, { adapter: createNoopAdapter() })).not.toThrow();
  });

  it("reads a named mode with an explicit marker", () => {
    const input = small(modes({ normal: [], hc: [{ $ref: "hc.json" }] }, "normal", "modes"), {
      "hc.json": { colors: { brand: { $root: { $value: srgb("#000000") } } } },
    });
    const { raw, report } = readDTCGProfileSet(input);
    expect(report.modes).toEqual(["hc"]);
    expect(raw.modes).toEqual(["hc", "normal"]);
    expect(() => createTheme(raw, { adapter: createNoopAdapter() })).not.toThrow();
  });

  it("turns an as: themes context into a partial child theme with whole properties", () => {
    const input = small(modes({ a: [], b: [{ $ref: "b.json" }] }, "a", "themes"), {
      "b.json": { colors: { brand: { $root: { $value: srgb("#e64980") } } } },
    });
    const { raw, themes } = readDTCGProfileSet(input);
    const b = themes.scheme.b as any;
    expect(Object.keys(b.colors)).toEqual(["brand"]);
    expect(b.colors.brand.variants.hover).toBe("#3b5bdb"); // the whole property, not just the base
    const child = createTheme(raw, { adapter: createNoopAdapter() }).override(b);
    expect(child.resolveToken("colors.brand")).toBe("rgb(230, 73, 128)");
    expect(child.resolveToken("colors.brand.hover")).toBe("rgb(59, 91, 219)");
  });

  it("merges sources in order, later wins", () => {
    const input = small(
      { sets: { base: { sources: [{ $ref: "base.json" }, { colors: { brand: { hover: { $value: srgb("#000000") } } } }] } } },
    );
    const { raw } = readDTCGProfileSet(input);
    expect((raw.colors as any).brand.variants.hover).toBe("#000000");
  });

  it("rejects a context that adds a token", () => {
    expect(failure(small(modes({ light: [], dark: [{ $ref: "dark.json" }] }), {
      "dark.json": { colors: { brand: { pressed: { $value: srgb("#000000") } } } },
    }))).toMatch(/adds colors\.brand\.pressed/);
  });

  it("rejects two modes modifiers", () => {
    const input = small({
      modifiers: {
        scheme: { default: "light", contexts: { light: [], dark: [] } },
        contrast: { $extensions: { [KEY]: { as: "modes" } }, default: "normal", contexts: { normal: [], hc: [] } } as never,
      },
      resolutionOrder: [{ $ref: "#/sets/base" }, { $ref: "#/modifiers/scheme" }, { $ref: "#/modifiers/contrast" }],
    });
    expect(failure(input)).toMatch(/only one modifier can be "as": "modes"/);
  });

  it("asks for a marker on a modifier that isn't light/dark", () => {
    expect(failure(small(modes({ a: [], b: [] }, "a")))).toMatch(/say how Refract uses it/);
  });

  it("rejects a modifier without a default", () => {
    const input = small({ modifiers: { scheme: { contexts: { light: [], dark: [] } } }, resolutionOrder: [{ $ref: "#/sets/base" }, { $ref: "#/modifiers/scheme" }] });
    expect(failure(input)).toMatch(/needs a default/);
  });

  it("rejects a missing file and a second document block", () => {
    expect(failure(small(modes({ light: [], dark: [{ $ref: "nope.json" }] })))).toMatch(/"nope\.json" isn't among the files/);
    expect(failure(small(modes({ light: [], dark: [{ $ref: "dark.json" }] }), {
      "dark.json": { $extensions: { [KEY]: { version: 1 } }, colors: { brand: { $root: { $value: srgb("#000000") } } } },
    }))).toMatch(/appears in 2 files/);
  });

  it("rejects another resolver version", () => {
    expect(failure(small({ version: "2024" }))).toMatch(/resolver version "2024"/);
  });
});
