/**
 * §C end-to-end for the JSON adapter — `emitTheme({ guide })` with the REAL `createJsonAdapter`,
 * proving the adapter's `describeUsage` override names actual dotted `ruleSets` keys and framework-
 * neutral prose in the emitted `llms.txt`, and that the folder is self-contained.
 */
import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitTheme } from "@theme-registry/refract/build";
import { createJsonAdapter } from "../src";

const tmpDirs: string[] = [];
const makeTmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "json-guide-"));
  tmpDirs.push(dir);
  return dir;
};
afterAll(() => tmpDirs.forEach(d => rmSync(d, { recursive: true, force: true })));

const RAW = {
  colors: {
    primary: { base: "#4dabf7", text: "#ffffff" },
    recipes: { solid: { primary: { background: "primary", color: "primary.text" } } },
  },
  components: {
    recipes: { buttons: { primary: { colors: "solid.primary", css: { cursor: "pointer" } } } },
  },
};

describe("JSON adapter self-documenting output", () => {
  it("writes an llms.txt with data-consumption prose + real ruleSet keys and a self-contained folder", async () => {
    const outDir = makeTmp();
    await emitTheme({ raw: RAW, adapter: createJsonAdapter(), outDir, guide: true });

    const llms = readFileSync(join(outDir, "llms.txt"), "utf8");
    expect(llms).toContain("# Theme consumption guide (json)");
    expect(llms).toContain("ruleSets"); // JSON-specific override prose
    expect(llms).toContain("components.buttons.primary"); // real dotted key

    const manifest = JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8"));
    expect(manifest.format).toBe("json");
    const button = manifest.recipes.find(
      (r: { subsystem: string; group: string; variant: string }) =>
        r.subsystem === "components" && r.group === "buttons" && r.variant === "primary",
    );
    expect(button?.name).toBe("components.buttons.primary");

    // Acceptance: every relative file the guide names exists in the folder.
    for (const rel of [...llms.matchAll(/`\.\/([\w.-]+)`/g)].map(m => m[1])) {
      expect(existsSync(join(outDir, rel))).toBe(true);
    }
  });
});
