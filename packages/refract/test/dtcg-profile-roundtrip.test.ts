/**
 * The Refract DTCG profile round trip: raw theme → profile files (writeDTCGProfile) → raw theme
 * (readDTCGProfileSet) builds the same theme. Compared on the built Model, which is what every adapter
 * renders from, over the shared golden fixtures and the profile example.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createTheme, createNoopAdapter } from "../src/core";
import { readDTCGProfileSet } from "../src/dtcg/resolver";
import { writeDTCGProfile } from "../src/dtcg/profileWriter";
import { fixtures, responsiveComponents, statesTheme } from "../../theme-fixtures/src/index.mjs";
import Ajv2020 from "ajv/dist/2020";

const build = (raw: unknown) => createTheme(raw as never, { adapter: createNoopAdapter() });
const roundTrip = (raw: unknown) => readDTCGProfileSet(writeDTCGProfile(raw as never)).raw;
const read = (rel: string) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));

const cases: Record<string, unknown> = {
  reactSc: fixtures.reactSc.rawTheme,
  layout: fixtures.layout.rawTheme,
  responsiveComponents: responsiveComponents.rawTheme,
  statesTheme: statesTheme.rawTheme,
  "aliases and modes": {
    breakpoints: { sm: 576, md: 768 },
    colors: {
      accent: { base: "#e64980", modes: [{ mode: "dark", base: "#f783ac" }] },
      highlight: { ref: "colors.accent" },
      link: { base: { ref: "colors.accent" }, variants: { hover: { ref: "colors.accent.dark" } }, modes: [{ mode: "dark", ref: "colors.accent.light" }] },
      soft: { base: "#4c6ef5", lightenBy: 12, variants: { muted: { modifiers: [{ adjust: { c: 0.5 } }] } } },
    },
    typography: { fontSize: { base: 16, ratio: "major-third", precision: 2 }, textTransform: { base: "none", variants: { upper: "uppercase" } } },
    layout: { spacing: { base: 4, step: 4, steps: { sm: 2, md: 3 }, responsive: [{ breakpoint: "sm", query: "max", target: "md", base: 8 }] } },
    animation: { duration: { base: 200, variants: { slow: 400 } }, easing: { base: "ease-out", variants: { spring: "cubic-bezier(0.2, 0.8, 0.2, 1)" } } },
  },
};

describe("profile round trip: raw → DTCG → raw", () => {
  for (const [name, raw] of Object.entries(cases)) {
    it(`${name} builds the same model`, () => {
      expect(build(roundTrip(raw)).model).toEqual(build(raw).model);
    });
  }

  it("the example profile reads, writes and reads back to the same model", () => {
    const base = read("./fixtures/dtcg-profile/base.tokens.json");
    const dark = read("./fixtures/dtcg-profile/dark.tokens.json");
    const resolver = read("./fixtures/dtcg-profile/resolver.json");
    const once = readDTCGProfileSet({ resolver, files: { "base.tokens.json": base, "dark.tokens.json": dark } }).raw;
    expect(build(roundTrip(once)).model).toEqual(build(once).model);
  });

  it("writes files that pass the profile JSON Schema", () => {
    const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true, allowUnionTypes: true });
    const validate = ajv.compile(read("../schema/dtcg-profile/v1.json"));
    for (const [name, raw] of Object.entries(cases)) {
      const { files, resolver } = writeDTCGProfile(raw as never);
      for (const [file, doc] of Object.entries(files)) {
        expect(validate(doc), `${name} ${file}: ${JSON.stringify(validate.errors?.slice(0, 3))}`).toBe(true);
      }
      const modifier = (resolver.modifiers as any)?.mode?.$extensions?.["com.theme-registry.refract.profile"];
      if (modifier) expect(ajv.getSchema(`${validate.schema && (validate.schema as any).$id}#/$defs/modifierExtension`)!(modifier)).toBe(true);
    }
  });

  it("writes generated tokens with a marker and real values", () => {
    const { files } = writeDTCGProfile({ colors: { brand: { base: "#4c6ef5" } } } as never);
    const brand = (files["base.tokens.json"] as any).colors.brand;
    expect(brand.dark.$extensions["com.theme-registry.refract.profile"].generated).toBe("tones");
    expect(brand.dark.$value.hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("writes a base alias with $root and dark mode as a resolver modifier", () => {
    const { resolver, files } = writeDTCGProfile(cases["aliases and modes"] as never);
    expect((files["base.tokens.json"] as any).colors.highlight.$root.$value).toBe("{colors.accent.$root}");
    expect((resolver.modifiers as any).mode.contexts).toEqual({ light: [], dark: [{ $ref: "dark.tokens.json" }] });
    expect((files["dark.tokens.json"] as any).colors.link.$root.$value).toBe("{colors.accent.light}");
  });
});
