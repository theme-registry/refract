/**
 * Step 10c gate — the `refract` CLI (`init` + `build`), Node-only.
 *
 * Drives the command functions directly (`runInit` / `runBuild`) — they return data, so the CLI
 * layer is testable without spawning a process — plus a light `main()` dispatch smoke.
 *
 * `init`: a runnable `theme.config.(ts|js|mjs)` lands with the right shape; `--js`/`--mjs` pick the
 * variant; a second run refuses to clobber unless `--force`.
 * `build`: loads a fixture config (the relative-`.mjs`-adapter-shim trick from `emitTheme.test.ts`,
 * so it runs in-repo with no dist build) and emits each target; `--target`/`--out`/`--config` and the
 * ambiguous-`--out` guard behave.
 */
import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit, scaffoldConfig } from "@theme-registry/refract/build";
import { runImport, parseBreakpointsFlag } from "@theme-registry/refract/build";
import { runBuild } from "@theme-registry/refract/build";
import { runTokens } from "@theme-registry/refract/build";
import { runAudit } from "@theme-registry/refract/build";
import { runDiff } from "@theme-registry/refract/build";
import { main } from "@theme-registry/refract/build";
import { createTheme, createNoopAdapter, audit } from "@theme-registry/refract";

const tmpDirs: string[] = [];
const makeTmp = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
};
afterAll(() => tmpDirs.forEach(d => rmSync(d, { recursive: true, force: true })));

const PKG = "@theme-registry/refract";
// Post monorepo split the scaffold imports the CSS adapter from its own sibling package (the
// `CSS_ADAPTER_PACKAGE` constant in build/init.ts), while defineConfig/RawTheme still come from core.
const CSS_PKG = "@theme-registry/refract-css";

/** Write a fixture config that imports a relative plain-ESM stub adapter (the in-repo seam trick). */
function writeFixtureConfig(dir: string, filename = "theme.config.ts"): void {
  writeFileSync(
    join(dir, "stub-adapter.mjs"),
    `export const makeStub = (id) => ({\n` +
      `  name: id, version: 1,\n` +
      `  bind: () => ({\n` +
      `    recipeName: () => "", renderRecipe: () => "", renderVariables: () => "",\n` +
      `    join: (parts) => parts.join(""),\n` +
      `    emit: () => ({ files: { "theme.css": \`:root { --id: \${id}; }\\n\` } }),\n` +
      `  }),\n` +
      `});\n`,
    "utf8",
  );
  writeFileSync(
    join(dir, filename),
    `import { makeStub } from "./stub-adapter.mjs";\n` +
      `export default {\n` +
      `  raw: { colors: { primary: "#4dabf7" } },\n` +
      `  targets: [\n` +
      `    { name: "css", adapter: makeStub("css"), outDir: "out/css" },\n` +
      `    { name: "sc", adapter: makeStub("sc"), outDir: "out/sc" },\n` +
      `  ],\n` +
      `};\n`,
    "utf8",
  );
}

describe("refract init", () => {
  it("scaffolds a runnable theme.config.ts (defineConfig + createCssAdapter + one CSS target)", () => {
    const dir = makeTmp("tk-init-ts-");
    const result = runInit({ cwd: dir, packageName: PKG });

    expect(result.path).toBe(join(dir, "theme.config.ts"));
    expect(result.variant).toBe("ts");
    const src = readFileSync(result.path, "utf8");
    expect(src).toContain(`import { defineConfig } from "${PKG}/build";`);
    expect(src).toContain(`import { createCssAdapter } from "${CSS_PKG}";`);
    expect(src).toContain("export default defineConfig({");
    expect(src).toContain("createCssAdapter(");
    expect(src).toMatch(/outDir:\s*"dist\/theme"/);
    // Exactly one active target (the SC line is commented out).
    expect(src.match(/^\s*\{ adapter:/gm)).toHaveLength(1);
  });

  it("the scaffolded starter theme passes its own `refract audit` (WCAG AA)", () => {
    // Dogfood: shipping a default that fails the flagship auditor undercuts it. Reuse the REAL
    // scaffold (no duplicated values) — strip its imports, capture the defineConfig arg, audit the raw.
    const src = scaffoldConfig(PKG)
      .replace(/^\s*import[\s\S]*?;\s*$/gm, "")
      .replace(/export default /, "return ");
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const cfg = new Function("defineConfig", "createCssAdapter", src)(
      (c: unknown) => c,
      () => ({}),
    ) as { raw: unknown };
    const theme = createTheme(cfg.raw as never, { adapter: createNoopAdapter() });
    const report = audit(theme, { minWcag: "AA" });
    expect(report.summary.failed).toBe(0);
    expect(report.summary.total).toBeGreaterThan(0); // it actually scored pairings
  });

  it("--js / --mjs pick the variant filename", () => {
    const dir = makeTmp("tk-init-variants-");
    expect(runInit({ cwd: dir, variant: "js", packageName: PKG }).path).toBe(join(dir, "theme.config.js"));
    expect(runInit({ cwd: dir, variant: "mjs", packageName: PKG }).path).toBe(join(dir, "theme.config.mjs"));
    // Same ESM body across variants (only the extension differs).
    expect(readFileSync(join(dir, "theme.config.js"), "utf8")).toBe(scaffoldConfig(PKG));
    expect(readFileSync(join(dir, "theme.config.mjs"), "utf8")).toBe(scaffoldConfig(PKG));
  });

  it("refuses to clobber an existing config unless --force", () => {
    const dir = makeTmp("tk-init-clobber-");
    runInit({ cwd: dir, packageName: PKG });
    expect(() => runInit({ cwd: dir, packageName: PKG })).toThrow(/already exists/);
    // --force overwrites (marker line replaced by the fresh scaffold).
    writeFileSync(join(dir, "theme.config.ts"), "// stale\n", "utf8");
    expect(runInit({ cwd: dir, force: true, packageName: PKG }).path).toBe(join(dir, "theme.config.ts"));
    expect(readFileSync(join(dir, "theme.config.ts"), "utf8")).not.toContain("// stale");
  });
});

/** A small DTCG document: a color group + a breakpoint dimension group. */
function writeDtcgDoc(dir: string, filename = "tokens.json"): string {
  const doc = {
    $name: "demo",
    breakpoint: { $type: "dimension", sm: { $value: "576px" }, md: { $value: "768px" } },
    color: {
      $type: "color",
      brand: { base: { $value: "#4dabf7" }, dark: { $value: "#1c7ed6" } },
    },
  };
  const path = join(dir, filename);
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  return path;
}

describe("refract import", () => {
  it("seeds a typed theme.raw.ts + companion theme.config.ts from a DTCG doc", () => {
    const dir = makeTmp("tk-import-");
    writeDtcgDoc(dir);

    const result = runImport({ cwd: dir, input: "tokens.json", breakpointGroup: "breakpoint", packageName: PKG });

    expect(result.rawFile).toBe(join(dir, "theme.raw.ts"));
    expect(result.configFile).toBe(join(dir, "theme.config.ts"));
    expect(result.sections).toContain("colors");
    expect(result.counts.colors).toBe(1);

    const raw = readFileSync(result.rawFile!, "utf8");
    expect(raw).toContain(`import type { RawTheme } from "${PKG}/build";`);
    expect(raw).toContain("export const raw: RawTheme =");
    expect(raw).toContain('"brand"');
    // Breakpoints seeded from the named group.
    expect(raw).toContain('"sm": 576');

    const config = readFileSync(result.configFile!, "utf8");
    expect(config).toContain(`import { defineConfig } from "${PKG}/build";`);
    expect(config).toContain(`import { createCssAdapter } from "${CSS_PKG}";`);
    // Extensionless sibling import (the §8b graph-compile resolves it).
    expect(config).toContain(`import { raw } from "./theme.raw";`);
    expect(config).toContain("export default defineConfig({");
  });

  it("--raw-only skips the config; --out renames the raw and its import spec", () => {
    const dir = makeTmp("tk-import-rawonly-");
    writeDtcgDoc(dir);

    const rawOnly = runImport({ cwd: dir, input: "tokens.json", rawOnly: true, packageName: PKG });
    expect(rawOnly.configFile).toBeUndefined();
    expect(existsSync(join(dir, "theme.config.ts"))).toBe(false);

    const dir2 = makeTmp("tk-import-out-");
    writeDtcgDoc(dir2);
    const renamed = runImport({ cwd: dir2, input: "tokens.json", out: "src/tokens.raw.ts", packageName: PKG });
    expect(renamed.rawFile).toBe(join(dir2, "src/tokens.raw.ts"));
    expect(renamed.configFile).toBe(join(dir2, "src/theme.config.ts"));
    expect(readFileSync(renamed.configFile!, "utf8")).toContain(`import { raw } from "./tokens.raw";`);
  });

  it("refuses to clobber existing files unless --force, and errors on a bad input", () => {
    const dir = makeTmp("tk-import-clobber-");
    writeDtcgDoc(dir);
    runImport({ cwd: dir, input: "tokens.json", packageName: PKG });
    expect(() => runImport({ cwd: dir, input: "tokens.json", packageName: PKG })).toThrow(/already exists/);
    // --force overwrites both files.
    expect(() => runImport({ cwd: dir, input: "tokens.json", force: true, packageName: PKG })).not.toThrow();
    // Missing / malformed input.
    expect(() => runImport({ cwd: dir, input: "nope.json", packageName: PKG })).toThrow(/No DTCG document/);
    writeFileSync(join(dir, "broken.json"), "{ not json", "utf8");
    expect(() => runImport({ cwd: dir, input: "broken.json", force: true, packageName: PKG })).toThrow(/not valid JSON/);
  });

  it("parseBreakpointsFlag parses `n:px` pairs and drops malformed ones", () => {
    expect(parseBreakpointsFlag("sm:576,md:768")).toEqual({ sm: 576, md: 768 });
    expect(parseBreakpointsFlag("sm:576, bad, :10, x:")).toEqual({ sm: 576 });
  });
});

describe("refract build", () => {
  it("emits every target of the loaded config", async () => {
    const dir = makeTmp("tk-build-all-");
    writeFixtureConfig(dir);

    const result = await runBuild({ cwd: dir });
    expect(result.configPath).toBe(join(dir, "theme.config.ts"));
    expect(result.targets.map(t => t.name)).toEqual(["css", "sc"]);
    expect(existsSync(join(dir, "out/css/theme.css"))).toBe(true);
    expect(existsSync(join(dir, "out/sc/theme.css"))).toBe(true);
    expect(readFileSync(join(dir, "out/css/theme.css"), "utf8")).toContain("--id: css;");
    expect(readFileSync(join(dir, "out/sc/theme.css"), "utf8")).toContain("--id: sc;");
  });

  it("--target selects one target by name or index; --out overrides its outDir", async () => {
    const dir = makeTmp("tk-build-target-");
    writeFixtureConfig(dir);

    const byName = await runBuild({ cwd: dir, target: "sc" });
    expect(byName.targets.map(t => t.name)).toEqual(["sc"]);
    expect(existsSync(join(dir, "out/sc/theme.css"))).toBe(true);
    expect(existsSync(join(dir, "out/css/theme.css"))).toBe(false);

    const byIndex = await runBuild({ cwd: dir, target: "0", out: "custom-out" });
    expect(byIndex.targets).toHaveLength(1);
    expect(byIndex.targets[0].name).toBe("css");
    expect(existsSync(join(dir, "custom-out/theme.css"))).toBe(true);
  });

  it("rejects an unknown --target and an ambiguous --out across multiple targets", async () => {
    const dir = makeTmp("tk-build-bad-");
    writeFixtureConfig(dir);
    await expect(runBuild({ cwd: dir, target: "nope" })).rejects.toThrow(/No target matched/);
    await expect(runBuild({ cwd: dir, out: "x" })).rejects.toThrow(/--out is ambiguous/);
  });

  it("--config points at a differently-named config file", async () => {
    const dir = makeTmp("tk-build-config-");
    writeFixtureConfig(dir, "custom.config.ts");
    const result = await runBuild({ cwd: dir, configPath: "custom.config.ts" });
    expect(result.configPath).toBe(join(dir, "custom.config.ts"));
    expect(result.targets).toHaveLength(2);
  });
});

/**
 * A plain-object config (no adapter import, empty targets) — `tokens` reads only `raw`, so it needs
 * neither. Proves the command is adapter-free: it builds with the in-package CSS adapter internally.
 */
function writeTokensConfig(dir: string, filename = "theme.config.ts"): void {
  writeFileSync(
    join(dir, filename),
    `export default {\n` +
      `  raw: {\n` +
      `    colors: {\n` +
      `      primary: { base: "#4dabf7", text: "#fff", variants: { dark: "#1c7ed6" } },\n` +
      `    },\n` +
      `  },\n` +
      `  targets: [],\n` +
      `};\n`,
    "utf8",
  );
}

/** A config with one passing (ink 21:1) and one failing (faint ~1.1:1) palette pairing. */
function writeAuditConfig(dir: string, filename = "theme.config.ts"): void {
  writeFileSync(
    join(dir, filename),
    `export default {\n` +
      `  raw: {\n` +
      `    colors: {\n` +
      `      ink: { base: "#000000", text: "#ffffff" },\n` +
      `      faint: { base: "#777777", text: "#808080" },\n` +
      `    },\n` +
      `  },\n` +
      `  targets: [],\n` +
      `};\n`,
    "utf8",
  );
}

describe("refract tokens", () => {
  it("writes a DTCG tokens.json (colors group) and no adapter output", async () => {
    const dir = makeTmp("tk-tokens-");
    writeTokensConfig(dir);

    const result = await runTokens({ cwd: dir });
    expect(result.configPath).toBe(join(dir, "theme.config.ts"));
    expect(result.outFile).toBe(join(dir, "tokens.json"));
    expect(result.groupCount).toBeGreaterThan(0);

    // Parses as JSON with the DTCG shape test/dtcg.test.ts proves toDTCG emits.
    const doc = JSON.parse(readFileSync(join(dir, "tokens.json"), "utf8"));
    expect(doc.color.$type).toBe("color");
    expect(doc.color.primary.base).toEqual({ $value: "#4dabf7" });
    expect(doc.color.primary.text).toEqual({ $value: "#ffffff" });
    expect(doc.color.primary.dark).toEqual({ $value: "#1c7ed6" });

    // Adapter-free: no theme.css (or any other emit artifact) is written.
    expect(existsSync(join(dir, "theme.css"))).toBe(false);
  });

  it("--out overrides the destination file; --config picks the config", async () => {
    const dir = makeTmp("tk-tokens-out-");
    writeTokensConfig(dir, "custom.config.ts");

    const result = await runTokens({ cwd: dir, configPath: "custom.config.ts", out: "design/tokens.json" });
    expect(result.configPath).toBe(join(dir, "custom.config.ts"));
    expect(result.outFile).toBe(join(dir, "design/tokens.json"));
    expect(existsSync(join(dir, "design/tokens.json"))).toBe(true);
    expect(existsSync(join(dir, "tokens.json"))).toBe(false);

    const doc = JSON.parse(readFileSync(join(dir, "design/tokens.json"), "utf8"));
    expect(doc.color.primary.base).toEqual({ $value: "#4dabf7" });
  });
});

describe("refract audit", () => {
  it("reports pass/fail without throwing (adapter-free)", async () => {
    const dir = makeTmp("tk-audit-");
    writeAuditConfig(dir);

    const { configPath, result } = await runAudit({ cwd: dir });
    expect(configPath).toBe(join(dir, "theme.config.ts"));
    expect(result.summary.total).toBe(2); // ink + faint
    expect(result.summary.failed).toBe(1); // faint
    expect(result.ok).toBe(false);

    // Adapter-free like `tokens`: no theme.css is written.
    expect(existsSync(join(dir, "theme.css"))).toBe(false);
  });

  it("--strict throws an aggregated error naming the failing pairing", async () => {
    const dir = makeTmp("tk-audit-strict-");
    writeAuditConfig(dir);
    await expect(runAudit({ cwd: dir, strict: true })).rejects.toThrow(/colors\.faint/);
  });
});

describe("main() dispatch", () => {
  it("help returns 0; an unknown command returns 1", async () => {
    expect(await main(["help"])).toBe(0);
    expect(await main([])).toBe(0);
    expect(await main(["frobnicate"])).toBe(1);
  });

  it("init via main writes a config and returns 0", async () => {
    const dir = makeTmp("tk-main-init-");
    const prev = process.cwd();
    process.chdir(dir);
    try {
      expect(await main(["init"])).toBe(0);
      expect(existsSync(join(dir, "theme.config.ts"))).toBe(true);
      // Second run refuses (exit 1) without --force; --force succeeds.
      expect(await main(["init"])).toBe(1);
      expect(await main(["init", "--force"])).toBe(0);
    } finally {
      process.chdir(prev);
    }
  });

  it("import via main seeds files (0); a missing positional returns 1", async () => {
    const dir = makeTmp("tk-main-import-");
    const prev = process.cwd();
    process.chdir(dir);
    try {
      writeDtcgDoc(dir);
      expect(await main(["import"])).toBe(1); // no positional
      expect(await main(["import", "tokens.json"])).toBe(0);
      expect(existsSync(join(dir, "theme.raw.ts"))).toBe(true);
      expect(existsSync(join(dir, "theme.config.ts"))).toBe(true);
      // Second run refuses without --force.
      expect(await main(["import", "tokens.json"])).toBe(1);
    } finally {
      process.chdir(prev);
    }
  });
});

describe("refract diff", () => {
  const writeCandidate = (dir: string, raw: unknown) =>
    writeFileSync(join(dir, "candidate.json"), JSON.stringify(raw), "utf8");

  it("reports a candidate's token blast radius vs the config", async () => {
    const dir = makeTmp("tk-diff-");
    writeFixtureConfig(dir);
    writeCandidate(dir, { colors: { primary: "#e8590c" } });
    const result = await runDiff({ cwd: dir, candidatePath: "candidate.json" });
    expect(result.diff.summary.tokensChanged).toBeGreaterThan(0);
    expect(result.diff.tokens.some(t => t.path === "colors.primary" && t.kind === "changed")).toBe(true);
    expect(result.targets.every(t => t.ok)).toBe(true);
    expect(result.ok).toBe(true);
  });

  it("fails the CI gate when the token-change threshold is breached", async () => {
    const dir = makeTmp("tk-diff-gate-");
    writeFixtureConfig(dir);
    writeCandidate(dir, { colors: { primary: "#e8590c" } });
    const result = await runDiff({ cwd: dir, candidatePath: "candidate.json", maxTokenChanges: 0 });
    expect(result.ok).toBe(false);
    expect(result.violations.join(" ")).toMatch(/tokens changed/);
  });

  it("flags a candidate that no longer builds for a target", async () => {
    const dir = makeTmp("tk-diff-build-");
    writeFixtureConfig(dir);
    writeCandidate(dir, { colors: { primary: "nope" } });
    const result = await runDiff({ cwd: dir, candidatePath: "candidate.json" });
    expect(result.targets.some(t => !t.ok)).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.violations.join(" ")).toMatch(/no longer builds/);
  });

  it("fails loud with REFRACT_E_RAW_SHAPE on a defineConfig candidate (not a nonsense 'all removed' diff)", async () => {
    const dir = makeTmp("tk-diff-shape-");
    writeFixtureConfig(dir);
    // The documented trap: a defineConfig({ raw, targets }) passed where the bare raw theme was wanted.
    writeCandidate(dir, { raw: { colors: { primary: "#e8590c" } }, targets: [{ name: "css" }] });
    await expect(runDiff({ cwd: dir, candidatePath: "candidate.json" })).rejects.toMatchObject({
      code: "REFRACT_E_RAW_SHAPE",
    });
    // via the CLI it exits nonzero — never a silent exit 0 with a bogus diff.
    const prev = process.cwd();
    process.chdir(dir);
    try {
      expect(await main(["diff", "candidate.json"])).toBe(1);
    } finally {
      process.chdir(prev);
    }
  });

  it("main() dispatches diff — nonzero on a gate breach, zero otherwise", async () => {
    const dir = makeTmp("tk-diff-main-");
    writeFixtureConfig(dir);
    writeCandidate(dir, { colors: { primary: "#e8590c" } });
    const prev = process.cwd();
    process.chdir(dir);
    try {
      expect(await main(["diff", "candidate.json", "--max-token-changes", "0"])).toBe(1);
      expect(await main(["diff", "candidate.json"])).toBe(0);
    } finally {
      process.chdir(prev);
    }
  });
});
