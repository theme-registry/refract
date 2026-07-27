/**
 * §20 for the SCSS adapter — its output is not something a browser loads, so `preview.html`
 * must degrade to token plates plus an honest explanation rather than rendering unstyled boxes.
 * The token half is format-neutral, so it still carries the theme's real values.
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitTheme } from "@theme-registry/refract/build";
import { createScssAdapter } from "../src";

const tmpDirs: string[] = [];
const makeTmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "scss-preview-"));
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

describe("SCSS adapter preview.html", () => {
  it("renders token plates and explains why recipes can't render live", async () => {
    const outDir = makeTmp();
    await emitTheme({ raw: RAW, adapter: createScssAdapter(), outDir, preview: true });

    const html = readFileSync(join(outDir, "preview.html"), "utf8");

    // Nothing loadable — no inlined stylesheet, no link, and the adapter's own explanation instead.
    expect(html).not.toContain("data-rfp-source");
    expect(html).not.toContain('<link rel="stylesheet"');
    expect(html).toContain("emits Sass partials, which a browser cannot load directly");

    // Tokens still carry exact values, and recipes are still named by their real identity.
    expect(html).toContain("#4dabf7");
    expect(html).toContain('rfp-plate-title">color ');
    expect(html).toContain("components.buttons.primary");
  });
});
