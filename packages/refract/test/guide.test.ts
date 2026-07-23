/**
 * Gate for §C — the self-documenting theme output (`emitTheme({ guide })` → `llms.txt` + `manifest.json`).
 *
 * Uses a minimal in-file stub adapter (so the test stays inside the refract package), exercising the
 * DEFAULT `describeUsage` from `defineAdapter` (recipe identities via `recipeName`). Asserts the guide
 * is emitted only on opt-in, names the theme's real recipes + tokens, uses relative paths, honors the
 * package-specifier overlay + `manifestFile:false`, and — the acceptance check — is self-contained:
 * every file the guide references exists in the output folder (so a zipped `outDir` consumes alone).
 */
import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitTheme } from "../src/build/emitTheme";
import { defineAdapter } from "../src/core/defineAdapter";

const tmpDirs: string[] = [];
const makeTmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "refract-guide-"));
  tmpDirs.push(dir);
  return dir;
};
afterAll(() => tmpDirs.forEach(d => rmSync(d, { recursive: true, force: true })));

/** A tiny emit-capable adapter — its default `describeUsage` names recipes via `recipeName`. */
const stubAdapter = defineAdapter({
  name: "stub",
  version: 1,
  bind() {
    return {
      recipeName: (s: string, g: string, v: string) => `${s}-${g}-${v}`,
      renderRecipe: () => ".x{}",
      renderVariables: () => ":root{}",
      join: (parts: string[]) => parts.join("\n"),
      emit: () => ({ files: { "theme.css": ":root{}\n.x{}\n" } }),
    };
  },
});

const RAW = {
  colors: {
    primary: { base: "#4dabf7", text: "#ffffff" },
    recipes: { solid: { primary: { background: "primary", color: "primary.text" } } },
  },
};

describe("self-documenting output", () => {
  it("is off by default — no guide files unless opted in", async () => {
    const outDir = makeTmp();
    await emitTheme({ raw: RAW, adapter: stubAdapter, outDir });
    expect(existsSync(join(outDir, "llms.txt"))).toBe(false);
    expect(existsSync(join(outDir, "manifest.json"))).toBe(false);
    expect(existsSync(join(outDir, "theme.css"))).toBe(true);
  });

  it("emits llms.txt + manifest.json naming the real recipes and tokens", async () => {
    const outDir = makeTmp();
    await emitTheme({ raw: RAW, adapter: stubAdapter, outDir, guide: true });

    const llms = readFileSync(join(outDir, "llms.txt"), "utf8");
    expect(llms).toContain("# Theme consumption guide (stub)");
    expect(llms).toContain("`./theme.css`"); // relative reference, no package specifier
    expect(llms).not.toMatch(/@[\w-]+\/[\w-]+/); // no bare package specifier when none configured
    expect(llms).toContain("colors.solid.primary"); // recipe address
    expect(llms).toContain("colors-solid-primary"); // real identity from recipeName

    const manifest = JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8"));
    expect(manifest.schema).toBe(1); // versioned agent contract (P2-5) — bump on a breaking shape change
    expect(manifest.format).toBe("stub");
    expect(manifest.recipes).toContainEqual({
      subsystem: "colors",
      group: "solid",
      variant: "primary",
      name: "colors-solid-primary",
    });
    expect(manifest.tokens).toBeTruthy(); // embedded DTCG token export
    expect(JSON.stringify(manifest.tokens)).toContain("primary");
  });

  it("is self-contained — every file the guide references exists in outDir (zip-and-consume)", async () => {
    const outDir = makeTmp();
    await emitTheme({ raw: RAW, adapter: stubAdapter, outDir, guide: true });
    const llms = readFileSync(join(outDir, "llms.txt"), "utf8");
    const referenced = [...llms.matchAll(/`\.\/([\w.-]+)`/g)].map(m => m[1]);
    expect(referenced.length).toBeGreaterThan(0);
    for (const rel of referenced) expect(existsSync(join(outDir, rel))).toBe(true);
  });

  it("adds a package-specifier overlay only when packageName is set", async () => {
    const outDir = makeTmp();
    await emitTheme({ raw: RAW, adapter: stubAdapter, outDir, guide: { packageName: "@acme/theme" } });
    expect(readFileSync(join(outDir, "llms.txt"), "utf8")).toContain("@acme/theme");
  });

  it("suppresses the manifest when manifestFile is false", async () => {
    const outDir = makeTmp();
    await emitTheme({ raw: RAW, adapter: stubAdapter, outDir, guide: { manifestFile: false } });
    expect(existsSync(join(outDir, "llms.txt"))).toBe(true);
    expect(existsSync(join(outDir, "manifest.json"))).toBe(false);
  });
});
