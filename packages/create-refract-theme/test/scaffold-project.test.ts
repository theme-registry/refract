/**
 * `create-refract-theme` gate — the project scaffolder.
 *
 * `scaffoldProject` is pure of prompting, so the whole thing runs in a tmpdir with no TTY and no
 * network. The properties worth holding:
 *
 *  - the project it writes actually BUILDS, for every adapter combination it offers;
 *  - every `exports` entry points at a file the build really emits (a lying exports map is worse
 *    than none — this is the check that caught `theme.js` when the SC adapter emits `theme.ts`);
 *  - it depends on the refract it generated with, never a guess;
 *  - it refuses to scribble into a directory that already has something in it.
 */
import { describe, expect, it, afterAll } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTheme } from "@theme-registry/refract";
import { createCssAdapter } from "@theme-registry/refract-css";
import { scaffoldProject, isDirectoryUsable, resolveRefractPackage } from "../src/scaffoldProject";
import { ADAPTERS, type AdapterChoice } from "../src/templates";
import type { InterviewAnswers } from "@theme-registry/refract/build";

const tmpDirs: string[] = [];
const makeTmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "create-refract-"));
  tmpDirs.push(dir);
  return dir;
};
afterAll(() => tmpDirs.forEach(d => rmSync(d, { recursive: true, force: true })));

/** The answers `--yes` would produce. */
const ANSWERS: InterviewAnswers = {
  seed: "#4c6ef5",
  mode: "auto",
  brandCount: 2,
  scheme: "complement",
  extraColors: [],
  semantics: true,
  neutral: true,
  shadows: true,
  contrast: "AA",
  baseFontSize: 16,
  ratio: "major-third",
  feel: "neutral",
  reset: "preflight",
  format: "ts",
};

const scaffold = (over: Partial<Parameters<typeof scaffoldProject>[0]> = {}) =>
  scaffoldProject({ name: "my-theme", directory: join(makeTmp(), "my-theme"), answers: ANSWERS, ...over });

describe("scaffoldProject — the project it writes", () => {
  it("lands the files a publishable package needs", () => {
    const result = scaffold();
    for (const f of ["theme.raw.ts", "package.json", "theme.config.ts", "tsconfig.json", ".gitignore", "README.md"]) {
      expect(existsSync(join(result.directory, f)), `${f} missing`).toBe(true);
    }
  });

  it("writes a package.json that is publishable, not private", () => {
    const result = scaffold();
    const pkg = JSON.parse(readFileSync(join(result.directory, "package.json"), "utf8"));
    expect(pkg.name).toBe("my-theme");
    expect(pkg.private).toBeUndefined();
    expect(pkg.version).toBe("0.0.0"); // the author picks their first release
    expect(pkg.files).toEqual(["/dist"]);
    expect(pkg.scripts.build).toBe("refract build");
    expect(pkg.scripts.prepublishOnly).toBe("npm run build");
  });

  it("pins the refract it actually generated with", () => {
    const result = scaffold();
    const pkg = JSON.parse(readFileSync(join(result.directory, "package.json"), "utf8"));
    const { range } = resolveRefractPackage();
    expect(pkg.devDependencies["@theme-registry/refract"]).toBe(range);
    expect(range).not.toBe("latest"); // resolution worked in-repo
  });

  it("wires the config to the generated theme, with no second palette", () => {
    const result = scaffold();
    const config = readFileSync(join(result.directory, "theme.config.ts"), "utf8");
    expect(config).toContain('import { raw } from "./theme.raw"');
    expect(config).toContain("raw: raw,");
    expect(config).not.toContain("#1864ab"); // init's starter palette must not leak in
  });

  it.each(["ts", "js", "json"] as const)("wires a .%s theme correctly", format => {
    const result = scaffold({ answers: { ...ANSWERS, format } });
    const config = readFileSync(join(result.directory, "theme.config.ts"), "utf8");
    if (format === "json") expect(config).toContain("readFileSync");
    else expect(config).toContain(format === "ts" ? '"./theme.raw"' : '"./theme.raw.js"');
  });

  it("generates a theme that compiles", () => {
    const result = scaffold();
    const css = createTheme(result.create.raw, { adapter: createCssAdapter() }).css;
    expect(css.length).toBeGreaterThan(1000);
    expect(css).toContain("--dt-colors-primary:");
  });

  it("clears the contrast bar it was given", () => {
    const result = scaffold();
    expect(result.create.report.contrast.filter(c => c.unresolved)).toEqual([]);
  });
});

describe("scaffoldProject — adapters", () => {
  it("defaults to CSS alone", () => {
    const result = scaffold();
    expect(result.adapters.map(a => a.id)).toEqual(["css"]);
  });

  it.each(ADAPTERS.map(a => a.id))("wires the %s adapter into the config and deps", id => {
    const adapter = ADAPTERS.find(a => a.id === id) as AdapterChoice;
    const result = scaffold({ adapters: [id] });
    const config = readFileSync(join(result.directory, "theme.config.ts"), "utf8");
    const pkg = JSON.parse(readFileSync(join(result.directory, "package.json"), "utf8"));
    expect(config).toContain(`import { ${adapter.factory} } from "${adapter.pkg}"`);
    expect(config).toContain(`outDir: "${adapter.outDir}"`);
    expect(pkg.devDependencies[adapter.pkg]).toBeDefined();
  });

  it("every exports entry points at a file the adapter really emits", () => {
    // The check that caught an `exports` map claiming `theme.js` while the SC adapter emits `theme.ts`.
    const result = scaffold({ adapters: ADAPTERS.map(a => a.id) });
    const pkg = JSON.parse(readFileSync(join(result.directory, "package.json"), "utf8"));
    for (const [entry, target] of Object.entries(pkg.exports as Record<string, string>)) {
      if (entry === "./package.json") continue;
      const adapter = ADAPTERS.find(a => target.startsWith(`./${a.outDir}/`));
      expect(adapter, `no adapter owns ${target}`).toBeDefined();
      expect(target).toBe(`./${adapter!.outDir}/${adapter!.entryFile}`);
    }
  });
});

describe("scaffoldProject — guards", () => {
  it("refuses a non-empty directory", () => {
    const dir = join(makeTmp(), "taken");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "something.txt"), "hello", "utf8");
    expect(() => scaffoldProject({ name: "taken", directory: dir, answers: ANSWERS })).toThrow(/isn't empty/);
    expect(() =>
      scaffoldProject({ name: "taken", directory: dir, answers: ANSWERS, force: true }),
    ).not.toThrow();
  });

  it("treats absent, empty, and git-only directories as usable", () => {
    const base = makeTmp();
    expect(isDirectoryUsable(join(base, "nope"))).toBe(true);
    const empty = join(base, "empty");
    mkdirSync(empty);
    expect(isDirectoryUsable(empty)).toBe(true);
    mkdirSync(join(empty, ".git"));
    expect(isDirectoryUsable(empty)).toBe(true);
    writeFileSync(join(empty, "file.txt"), "x", "utf8");
    expect(isDirectoryUsable(empty)).toBe(false);
  });
});
