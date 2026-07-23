/**
 * §C end-to-end for the styled-components adapter — `emitTheme({ guide })` with the REAL
 * `createStyledComponentsAdapter`, proving the adapter's `describeUsage` override names actual `css`
 * export identifiers and SC-specific wiring prose in the emitted `llms.txt`, and that the folder is
 * self-contained (the zip-and-consume acceptance check).
 */
import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitTheme } from "@theme-registry/refract/build";
import { createStyledComponentsAdapter } from "../src";

const tmpDirs: string[] = [];
const makeTmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "sc-guide-"));
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

describe("styled-components adapter self-documenting output", () => {
  it("writes an llms.txt with SC prose + real export identifiers and a self-contained folder", async () => {
    const outDir = makeTmp();
    await emitTheme({ raw: RAW, adapter: createStyledComponentsAdapter(), outDir, guide: true });

    const llms = readFileSync(join(outDir, "llms.txt"), "utf8");
    expect(llms).toContain("# Theme consumption guide (styled-components)");
    expect(llms).toContain("ThemeProvider"); // SC-specific override prose
    expect(llms).toContain("componentsButtonsPrimary"); // real export identifier

    const manifest = JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8"));
    expect(manifest.format).toBe("styled-components");
    const button = manifest.recipes.find(
      (r: { subsystem: string; group: string; variant: string }) =>
        r.subsystem === "components" && r.group === "buttons" && r.variant === "primary",
    );
    expect(button?.name).toBe("componentsButtonsPrimary");

    // Acceptance: every relative file the guide names exists in the folder.
    for (const rel of [...llms.matchAll(/`\.\/([\w.-]+)`/g)].map(m => m[1])) {
      expect(existsSync(join(outDir, rel))).toBe(true);
    }
  });
});
