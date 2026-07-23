/**
 * §C end-to-end for the CSS adapter — `emitTheme({ guide })` with the REAL `createCssAdapter`, proving
 * the adapter's `describeUsage` override names actual `dt-`-prefixed classes and CSS-specific prose in
 * the emitted `llms.txt`, and that the folder is self-contained (the zip-and-consume acceptance check).
 * `emitTheme` comes from the built core (`@theme-registry/refract/build`); the adapter from its source.
 */
import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitTheme } from "@theme-registry/refract/build";
import { createCssAdapter } from "../src";

const tmpDirs: string[] = [];
const makeTmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "css-guide-"));
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

describe("CSS adapter self-documenting output", () => {
  it("writes an llms.txt with CSS prose + real dt- class names and a self-contained folder", async () => {
    const outDir = makeTmp();
    await emitTheme({ raw: RAW, adapter: createCssAdapter(), outDir, guide: true });

    const llms = readFileSync(join(outDir, "llms.txt"), "utf8");
    expect(llms).toContain("# Theme consumption guide (css)");
    expect(llms).toContain("Import the stylesheet"); // CSS-specific override prose
    expect(llms).toContain("dt-colors-solid-primary"); // real class name from getClass
    expect(llms).toContain("`./theme.css`");

    // The component recipe's identity is its composition class string (what you drop in markup).
    const manifest = JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8"));
    expect(manifest.format).toBe("css");
    const button = manifest.recipes.find(
      (r: { subsystem: string; group: string; variant: string }) =>
        r.subsystem === "components" && r.group === "buttons" && r.variant === "primary",
    );
    expect(button?.name).toContain("dt-"); // real, prefixed class

    // Acceptance: every relative file the guide names exists in the folder.
    for (const rel of [...llms.matchAll(/`\.\/([\w.-]+)`/g)].map(m => m[1])) {
      expect(existsSync(join(outDir, rel))).toBe(true);
    }
  });
});
