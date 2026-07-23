/**
 * §8b gate — the graph-compiling config loader (`loadConfig` → `compileTsConfigGraph`, Node-only).
 *
 * Proves the 8a payoff: a `.ts` config can `import` a **sibling `theme.raw.ts`** (typed
 * `satisfies RawTheme`), plus a relative `.json`, plus a bare-ish relative `.mjs` adapter — all in one
 * graph — and the emitted temp files are cleaned up. Complements `test/cli.test.ts` (which only ever
 * loaded a single-file `.ts` config) and `test/typescript-optional.test.ts` (the compiler-absent path).
 */
import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/build/config";

const tmpDirs: string[] = [];
const makeTmp = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
};
afterAll(() => tmpDirs.forEach(d => rmSync(d, { recursive: true, force: true })));

/** A plain-ESM stub adapter (no refract import needed) written as a relative `.mjs` sibling. */
const STUB_ADAPTER =
  `export const makeStub = (id) => ({\n` +
  `  name: id, version: 1,\n` +
  `  bind: () => ({\n` +
  `    recipeName: () => "", renderRecipe: () => "", renderVariables: () => "",\n` +
  `    join: (parts) => parts.join(""),\n` +
  `    emit: () => ({ files: { "theme.css": ":root{}\\n" } }),\n` +
  `  }),\n` +
  `});\n`;

describe("graph-compiling config loader", () => {
  it("loads a `.ts` config that imports a sibling `theme.raw.ts` (typed) + a `.mjs` adapter", async () => {
    const dir = makeTmp("tk-graph-ts-");
    writeFileSync(join(dir, "stub-adapter.mjs"), STUB_ADAPTER, "utf8");
    // The separately-authored, RawTheme-typed raw — the file users live in.
    writeFileSync(
      join(dir, "theme.raw.ts"),
      `export const raw = {\n` +
        `  colors: {\n` +
        `    primary: { base: "#4dabf7", text: "#fff", variants: { dark: "#1c7ed6" } },\n` +
        `  },\n` +
        `};\n`,
      "utf8",
    );
    writeFileSync(
      join(dir, "theme.config.ts"),
      `import { makeStub } from "./stub-adapter.mjs";\n` +
        `import { raw } from "./theme.raw";\n` + // extensionless sibling `.ts` — the crux of §8b
        `export default {\n` +
        `  raw,\n` +
        `  targets: [{ name: "css", adapter: makeStub("css"), outDir: "out/css" }],\n` +
        `};\n`,
      "utf8",
    );

    const { config, path } = await loadConfig({ cwd: dir });
    expect(path).toBe(join(dir, "theme.config.ts"));
    expect(config.targets.map(t => t.name)).toEqual(["css"]);
    // The sibling raw flowed through the import graph.
    expect((config.raw as { colors: { primary: { base: string } } }).colors.primary.base).toBe(
      "#4dabf7",
    );

    // No emitted temp files (`.<base>.<pid>-<n>.mjs`) leak after load.
    const leaked = readdirSync(dir).filter(f => /^\..*\.\d+-\d+\.mjs$/.test(f));
    expect(leaked).toEqual([]);
  });

  it("loads a `.ts` config that imports a relative `.json` (attribute-gated)", async () => {
    const dir = makeTmp("tk-graph-json-");
    writeFileSync(join(dir, "palette.json"), JSON.stringify({ primary: "#4dabf7" }), "utf8");
    writeFileSync(
      join(dir, "theme.config.ts"),
      `import palette from "./palette.json" with { type: "json" };\n` +
        `export default {\n` +
        `  raw: { colors: { primary: palette.primary } },\n` +
        `  targets: [],\n` +
        `};\n`,
      "utf8",
    );

    const { config } = await loadConfig({ cwd: dir });
    expect((config.raw as { colors: { primary: string } }).colors.primary).toBe("#4dabf7");
  });

  it("still loads a single-file `.ts` config with no relative `.ts` imports (backward compat)", async () => {
    const dir = makeTmp("tk-graph-single-");
    writeFileSync(
      join(dir, "theme.config.ts"),
      `const config = { raw: { colors: { primary: "#4dabf7" } }, targets: [] };\n` +
        `export default config;\n`,
      "utf8",
    );

    const { config } = await loadConfig({ cwd: dir });
    expect((config.raw as { colors: { primary: string } }).colors.primary).toBe("#4dabf7");
    expect(readdirSync(dir).filter(f => /^\..*\.\d+-\d+\.mjs$/.test(f))).toEqual([]);
  });
});
