/**
 * Step 10e — `typescript` is an OPTIONAL peer dependency, lazy-loaded.
 *
 * Decision (2026-07-11): `typescript` moved off hard `dependencies` to `peerDependenciesMeta.optional`
 * and is now pulled in via a lazy `await import("typescript")` (see `src/build/paths.ts`), reached ONLY
 * on the two paths that genuinely transpile TS — loading a `.ts` config and vendoring a shared helper.
 * A consumer who only runs the runtime, `./dtcg`, or a `.mjs`/`.js` config + CSS `emit()` never needs it.
 *
 * This file proves the promise by MOCKING `typescript` as unresolvable for the whole module:
 *  - a `.mjs` config `runBuild` (CSS emit, no `helpers`) still writes `theme.css`;
 *  - a `.mjs` config `runTokens` still writes `tokens.json`;
 *  - a `.ts` config errors CLEANLY (the actionable "install typescript" message, not an opaque resolve
 *    failure) — because loading it is the one path that needs the compiler.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Simulate `typescript` not being installed: every (static OR dynamic) import of it in this test's
// module graph rejects, exactly as an absent optional peer would. `paths.ts`'s lazy loader catches it.
vi.mock("typescript", () => {
  throw new Error("Cannot find package 'typescript'");
});

const tmpDirs: string[] = [];
const makeTmp = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
};
afterAll(() => tmpDirs.forEach(d => rmSync(d, { recursive: true, force: true })));

// A minimal `.mjs` config: an inline CSS-like adapter (no refract import needed) + one target with
// NO `helpers`, so nothing on the path touches `typescript`. Mirrors the emitTheme/cli fixtures.
const MJS_CONFIG =
  `const adapter = {\n` +
  `  name: "css-stub", version: 1,\n` +
  `  bind: () => ({\n` +
  `    recipeName: () => "", renderRecipe: () => "", renderVariables: () => "",\n` +
  `    join: (parts) => parts.join(""),\n` +
  `    emit: () => ({ files: { "theme.css": ":root { --x: 1; }\\n" } }),\n` +
  `  }),\n` +
  `};\n` +
  `export default {\n` +
  `  raw: { colors: { primary: { base: "#4dabf7", text: "#fff", variants: { dark: "#1c7ed6" } } } },\n` +
  `  targets: [{ adapter, outDir: "out" }],\n` +
  `};\n`;

describe("typescript optional peer — build/tokens work when it is unavailable", () => {
  it("runBuild against a `.mjs` config emits theme.css with typescript absent", async () => {
    const { runBuild } = await import("../src/build/buildCommand");
    const dir = makeTmp("tk-nots-build-");
    writeFileSync(join(dir, "theme.config.mjs"), MJS_CONFIG, "utf8");

    const result = await runBuild({ cwd: dir });
    expect(result.targets).toHaveLength(1);
    const css = join(result.targets[0].outDir, "theme.css");
    expect(existsSync(css)).toBe(true);
    expect(readFileSync(css, "utf8")).toContain("--x: 1;");
  });

  it("runTokens against a `.mjs` config emits tokens.json with typescript absent", async () => {
    const { runTokens } = await import("../src/build/tokensCommand");
    const dir = makeTmp("tk-nots-tokens-");
    writeFileSync(join(dir, "theme.config.mjs"), MJS_CONFIG, "utf8");

    const result = await runTokens({ cwd: dir });
    expect(existsSync(result.outFile)).toBe(true);
    const doc = JSON.parse(readFileSync(result.outFile, "utf8"));
    // The DTCG shape `test/dtcg.test.ts` proves — reached with no adapter and no typescript.
    expect(doc.color.primary.base).toEqual({ $value: "#4dabf7" });
    expect(existsSync(join(dir, "out", "theme.css"))).toBe(false); // tokens is adapter-free
  });

  it("a `.ts` config fails with the actionable install-typescript message", async () => {
    const { loadConfig } = await import("../src/build/config");
    const dir = makeTmp("tk-nots-ts-");
    writeFileSync(
      join(dir, "theme.config.ts"),
      `const config = { raw: {}, targets: [] };\nexport default config;\n`,
      "utf8",
    );

    await expect(loadConfig({ cwd: dir })).rejects.toThrow(/optional peer dependency "typescript" is required/);
  });
});
