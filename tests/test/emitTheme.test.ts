/**
 * Step 10b gate — the programmatic build API (`emitTheme`) + config plumbing (`defineConfig` /
 * `loadConfig`), Node-only.
 *
 * Proves:
 *  1. `emitTheme` writes an adapter's `emit()` output to disk for BOTH in-repo adapters (CSS + SC).
 *  2. The opted-in shared `color-math` helper is materialized from its single source (Option A) and
 *     **re-imports in isolation** (temp dir, refract absent) matching the live `lighten`/`darken`.
 *  3. The SC adapter's theme-specific vendored `media.ts` rides along and is self-contained.
 *  4. `loadConfig` resolves + loads a `theme.config.ts` (ts→mjs→js order, ts type-stripped) and the
 *     loaded config drives `emitTheme` end-to-end (the config-as-adapter-seam).
 */
import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createTheme } from "@theme-registry/refract";
import { createCssAdapter } from "@theme-registry/refract-css";
import { createStyledComponentsAdapter } from "@theme-registry/refract-styled-components";
import { emitTheme } from "@theme-registry/refract/build";
import { defineConfig, loadConfig } from "@theme-registry/refract/build";
import { lighten as liveLighten, darken as liveDarken } from "@theme-registry/refract/color-math";
import { reactSc } from "@theme-registry/theme-fixtures";

const tmpDirs: string[] = [];
const makeTmp = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
};
afterAll(() => tmpDirs.forEach(d => rmSync(d, { recursive: true, force: true })));

const relFiles = (files: string[], outDir: string): string[] =>
  files.map(f => f.slice(outDir.length + 1)).sort();

describe("emitTheme — CSS adapter", () => {
  it("writes theme.css + the opted-in color-math helper (materialized from source)", async () => {
    const outDir = makeTmp("tk-emit-css-");
    const result = await emitTheme({
      raw: reactSc.rawTheme,
      adapter: createCssAdapter(),
      outDir,
      helpers: ["color-math"],
    });

    expect(relFiles(result.files, outDir)).toEqual(["color-math.js", "theme.css"]);
    const css = readFileSync(join(outDir, "theme.css"), "utf8");
    expect(css).toContain(":root {");
    expect(css).toMatch(/\.dt-colors-solid-primary\s*\{/);
  });

  it("the emitted color-math re-imports in isolation and matches the live math", async () => {
    const outDir = makeTmp("tk-emit-iso-");
    await emitTheme({ raw: reactSc.rawTheme, adapter: createCssAdapter(), outDir, helpers: ["color-math"] });

    const source = readFileSync(join(outDir, "color-math.js"), "utf8");
    expect(source).not.toMatch(/from\s+["']/); // self-contained (import-free)
    // Node treats a bare `.js` in a package-less dir as CJS; copy to `.mjs` to import the ESM as-is.
    const mjs = join(outDir, "color-math.mjs");
    writeFileSync(mjs, source, "utf8");
    const vendored = (await import(pathToFileURL(mjs).href)) as {
      lighten: (hex: string, percent: number) => string;
      darken: (hex: string, percent: number) => string;
    };

    for (const hex of ["#4dabf7", "#000", "#fff"]) {
      for (const percent of [0, 20, 50]) {
        expect(vendored.lighten(hex, percent)).toBe(liveLighten(hex, percent));
        expect(vendored.darken(hex, percent)).toBe(liveDarken(hex, percent));
      }
    }
  });
});

describe("emitTheme — styled-components adapter", () => {
  it("writes theme.ts (module) + theme.d.ts + a self-contained vendored media.ts", async () => {
    const outDir = makeTmp("tk-emit-sc-");
    const result = await emitTheme({
      raw: reactSc.rawTheme,
      adapter: createStyledComponentsAdapter(),
      outDir,
    });

    // §8: the SC target emits TS/JS modules, not a stylesheet.
    expect(relFiles(result.files, outDir)).toEqual(["media.ts", "theme.d.ts", "theme.ts"]);

    const theme = readFileSync(join(outDir, "theme.ts"), "utf8");
    expect(theme).toContain("export const theme = {");
    expect(theme).toContain("export const colorsSolidPrimary = css`");
    expect(theme).not.toContain("var(");

    const media = readFileSync(join(outDir, "media.ts"), "utf8");
    expect(media).toContain('import { css } from "styled-components"');
    // Self-contained: the ONLY import is styled-components (no refract / core import), so the app
    // keeps working after dropping refract. (The package name in the header comment is not an import.)
    expect(media).not.toMatch(/from\s+["'](?!styled-components["'])/);
    expect(media).toContain("export const media");
  });
});

describe("defineConfig / loadConfig", () => {
  it("loads a theme.config.ts (default export) and drives emitTheme end-to-end", async () => {
    const dir = makeTmp("tk-config-");
    // A relative, plain-ESM adapter shim — proves the config's `import` seam works in-repo (Node
    // can't import `.ts`, but real configs import the built `.js` package the same way).
    writeFileSync(
      join(dir, "file-adapter.mjs"),
      `export const fileAdapter = {\n` +
        `  name: "file-stub", version: 1,\n` +
        `  bind: () => ({\n` +
        `    recipeName: () => "", renderRecipe: () => "", renderVariables: () => "",\n` +
        `    join: (parts) => parts.join(""),\n` +
        `    emit: () => ({ files: { "theme.css": ":root { --x: 1; }\\n" } }),\n` +
        `  }),\n` +
        `};\n`,
      "utf8",
    );
    writeFileSync(
      join(dir, "theme.config.ts"),
      `import { fileAdapter } from "./file-adapter.mjs";\n` +
        `const config = {\n` +
        `  raw: { colors: { primary: "#4dabf7" } },\n` +
        `  targets: [{ adapter: fileAdapter, outDir: "out-css", helpers: ["color-math"] as const }],\n` +
        `};\n` +
        `export default config;\n`,
      "utf8",
    );

    const { config, path } = await loadConfig({ cwd: dir });
    expect(basename(path)).toBe("theme.config.ts");
    expect((config.raw as { colors: { primary: string } }).colors.primary).toBe("#4dabf7");
    expect(config.targets).toHaveLength(1);
    expect(config.targets[0].adapter.name).toBe("file-stub");
    expect(config.targets[0].outDir).toBe("out-css");
    expect(config.targets[0].helpers).toEqual(["color-math"]);
    // The transpile temp `.mjs` is cleaned up (no leftover `.theme.config.*.mjs`).
    expect(readdirSync(dir).filter(f => /^\.theme\.config\..*\.mjs$/.test(f))).toEqual([]);

    // Drive emitTheme with the loaded target — the full config → build loop.
    const target = config.targets[0];
    const outDir = join(dir, target.outDir);
    const result = await emitTheme({ raw: config.raw, adapter: target.adapter, outDir, helpers: target.helpers });
    expect(relFiles(result.files, outDir)).toEqual(["color-math.js", "theme.css"]);
    expect(readFileSync(join(outDir, "theme.css"), "utf8")).toContain("--x: 1;");
  });

  it("defineConfig is an identity fn and findConfigFile honors ts→mjs→js", async () => {
    const cfg = { raw: {}, targets: [] };
    expect(defineConfig(cfg)).toBe(cfg);

    const dir = makeTmp("tk-config-mjs-");
    writeFileSync(join(dir, "theme.config.mjs"), `export default { raw: {}, targets: [] };\n`, "utf8");
    const { path } = await loadConfig({ cwd: dir });
    expect(basename(path)).toBe("theme.config.mjs");
  });

  it("throws a clear error when no config is found", async () => {
    const dir = makeTmp("tk-config-none-");
    await expect(loadConfig({ cwd: dir })).rejects.toThrow(/No theme config found/);
  });
});

describe("createTheme guard (unchanged public surface)", () => {
  it("still builds a model-first theme with a required adapter", () => {
    const theme = createTheme(reactSc.rawTheme, { adapter: createCssAdapter() });
    expect(theme.model.subsystems.colors).toBeDefined();
  });
});
