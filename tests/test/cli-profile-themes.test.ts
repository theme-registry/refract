/**
 * `refract build` with a Refract DTCG profile whose resolver has an `"as": "themes"` modifier: the
 * default context builds into the target's outDir, every other context into `<outDir>/<context>/` as a
 * complete theme of its own (same names, its own values). Several such modifiers → `<modifier>-<context>`.
 */
import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBuild } from "@theme-registry/refract/build";

const KEY = "com.theme-registry.refract.profile";
const dirs: string[] = [];
afterAll(() => dirs.forEach(d => rmSync(d, { recursive: true, force: true })));

const srgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return { colorSpace: "srgb", components: [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255], hex };
};
const color = (hex: string) => ({ $root: { $value: srgb(hex) }, $extensions: { [KEY]: { tones: false } } });

/** A stub adapter that writes the brand colour it was given, so each output shows its theme's values. */
const STUB = `export const stub = {
  name: "stub", version: 1,
  bind: (model) => ({
    recipeName: () => "", renderRecipe: () => "", renderVariables: () => "", join: (p) => p.join(""),
    emit: () => ({ files: { "brand.txt": String(model.subsystems.colors.properties.brand.base.value) + "\\n" } }),
  }),
};
`;

const write = (modifiers: Record<string, unknown>, files: Record<string, unknown>) => {
  const dir = mkdtempSync(join(tmpdir(), "refract-themes-"));
  dirs.push(dir);
  writeFileSync(join(dir, "stub.mjs"), STUB);
  writeFileSync(join(dir, "theme.config.mjs"), `import { stub } from "./stub.mjs";\nexport default { raw: "./tokens/resolver.json", targets: [{ name: "out", adapter: stub, outDir: "dist" }] };\n`);
  const tokens = join(dir, "tokens");
  mkdirSync(tokens);
  writeFileSync(join(tokens, "base.tokens.json"), JSON.stringify({
    $extensions: { [KEY]: { version: 1 } },
    colors: { $type: "color", brand: color("#4c6ef5"), surface: color("#ffffff") },
  }));
  for (const [name, doc] of Object.entries(files)) writeFileSync(join(tokens, name), JSON.stringify(doc));
  writeFileSync(join(tokens, "resolver.json"), JSON.stringify({
    version: "2025.10",
    sets: { base: { sources: [{ $ref: "base.tokens.json" }] } },
    modifiers,
    resolutionOrder: [{ $ref: "#/sets/base" }, ...Object.keys(modifiers).map(m => ({ $ref: `#/modifiers/${m}` }))],
  }));
  return dir;
};
const themes = (contexts: Record<string, unknown[]>, def: string) => ({ $extensions: { [KEY]: { as: "themes" } }, default: def, contexts });
const read = (dir: string, rel: string) => readFileSync(join(dir, rel), "utf8").trim();

describe("refract build — as: themes", () => {
  it("builds the default into outDir and each other context into a subfolder", async () => {
    const dir = write({ brand: themes({ a: [], b: [{ $ref: "b.tokens.json" }] }, "a") }, {
      "b.tokens.json": { colors: { brand: { $root: { $value: srgb("#e64980") } } } },
    });
    const result = await runBuild({ cwd: dir });
    expect(result.targets.map(t => t.theme ?? "(base)")).toEqual(["(base)", "b"]);
    expect(read(dir, "dist/brand.txt")).toBe("rgb(76, 110, 245)");
    expect(read(dir, "dist/b/brand.txt")).toBe("rgb(230, 73, 128)");
  });

  it("names folders <modifier>-<context> when there are several themes modifiers", async () => {
    const dir = write(
      {
        brand: themes({ a: [], b: [{ $ref: "b.tokens.json" }] }, "a"),
        density: themes({ normal: [], compact: [{ $ref: "compact.tokens.json" }] }, "normal"),
      },
      {
        "b.tokens.json": { colors: { brand: { $root: { $value: srgb("#e64980") } } } },
        "compact.tokens.json": { colors: { surface: { $root: { $value: srgb("#f1f3f5") } } } },
      },
    );
    await runBuild({ cwd: dir });
    expect(existsSync(join(dir, "dist/brand-b/brand.txt"))).toBe(true);
    expect(existsSync(join(dir, "dist/density-compact/brand.txt"))).toBe(true);
    expect(read(dir, "dist/density-compact/brand.txt")).toBe("rgb(76, 110, 245)"); // compact changes the surface only
  });
});
