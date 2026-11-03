/**
 * The Refract DTCG profile JSON Schema (`schema/dtcg-profile/v1.json`): it compiles in strict mode,
 * accepts the example profile files, and rejects the mistakes producers are most likely to make.
 * The schema checks structure and Refract's extension; DTCG value shapes are the reader's job.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020";

const read = (rel: string) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));
const schema = read("../schema/dtcg-profile/v1.json");
const base = read("./fixtures/dtcg-profile/base.tokens.json");
const dark = read("./fixtures/dtcg-profile/dark.tokens.json");
const resolver = read("./fixtures/dtcg-profile/resolver.json");

// strictRequired is off: `oneOf: [{ required: ["$value"] }, { required: ["variant"] }]` is the standard
// way to say "one of these keys" and names keys declared one level up.
const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true, allowUnionTypes: true });
const validate = ajv.compile(schema);
const validateModifier = ajv.getSchema(`${schema.$id}#/$defs/modifierExtension`)!;

const clone = <T>(v: T): T => structuredClone(v);
const ok = (doc: unknown) => validate(doc);

describe("dtcg-profile v1 schema", () => {
  it("has the published $id", () => {
    expect(schema.$id).toBe("https://theme-registry.github.io/refract/schema/dtcg-profile/v1.json");
  });

  it("accepts the example files", () => {
    expect(ok(base), JSON.stringify(validate.errors, null, 2)).toBe(true);
    expect(ok(dark), JSON.stringify(validate.errors, null, 2)).toBe(true);
    const modifierExt = resolver.modifiers.scheme.$extensions["com.theme-registry.refract.profile"];
    expect(validateModifier(modifierExt)).toBe(true);
  });

  const rejects: Array<[string, (doc: any) => void]> = [
    ["a top-level group that isn't a subsystem", d => (d.color = { $type: "color" })],
    ["an unknown layout property", d => (d.layout.padding = { $root: { $value: 8 } })],
    ["a document extension without version", d => delete d.$extensions["com.theme-registry.refract.profile"].version],
    ["version 2", d => (d.$extensions["com.theme-registry.refract.profile"].version = 2)],
    ["an unknown document key", d => (d.$extensions["com.theme-registry.refract.profile"].modes = ["dark"])],
    ["a property with no $root", d => delete d.colors.surface.$root],
    ["a group nested below a property", d => (d.colors.brand.hover = { soft: { $value: "#fff" } })],
    ["a token without $value", d => (d.colors.brand.text = { $type: "color" })],
    ["a property name with a dot", d => (d.colors["panel.alert"] = { $root: { $value: "#fff" } })],
    ["an unknown generated kind", d => (d.colors.brand.dark.$extensions["com.theme-registry.refract.profile"].generated = "auto")],
    ["tones: true", d => (d.colors.surface.$extensions["com.theme-registry.refract.profile"].tones = true)],
    ["a colour step out of range", d => (d.colors.brand.$extensions["com.theme-registry.refract.profile"].steps = [1200])],
    ["a responsive entry with neither $value nor variant", d => {
      d.layout.spacing.md.$extensions["com.theme-registry.refract.profile"].responsive = [{ breakpoint: "sm" }];
    }],
    ["an unknown responsive query", d => {
      d.layout.spacing.md.$extensions["com.theme-registry.refract.profile"].responsive[0].query = "below";
    }],
    ["a derive ref that isn't a {…} alias", d => {
      d.colors.brand.text.$extensions = { "com.theme-registry.refract.profile": { derive: { ref: "colors.brand", modifiers: [{ darken: 10 }] } } };
    }],
    ["raw-theme { ref } objects in a recipe css block", d => {
      d.$extensions["com.theme-registry.refract.profile"].recipes.components.buttons.primary.css.color = { ref: "colors.brand" };
    }],
    ["recipes for an unknown subsystem", d => (d.$extensions["com.theme-registry.refract.profile"].recipes.buttons = {})],
    ["an external that isn't a CSS variable", d => {
      d.colors.surface.$root.$extensions = { "com.theme-registry.refract.profile": { external: "colors.brand" } };
    }],
  ];

  for (const [name, mutate] of rejects) {
    it(`rejects ${name}`, () => {
      const doc = clone(base);
      mutate(doc);
      expect(ok(doc)).toBe(false);
    });
  }

  it("rejects a modifier extension without as", () => {
    expect(validateModifier({})).toBe(false);
    expect(validateModifier({ as: "layers" })).toBe(false);
  });
});
