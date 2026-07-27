/**
 * §20 end-to-end for the CSS adapter — `emitTheme({ preview })` with the REAL `createCssAdapter`.
 *
 * The load-bearing claim under test is the one the design turns on: **the page references the files
 * that were actually written, in every emit mode**. `subsystem` / `components` name their files
 * through a user-supplied `filename` function, so a preview that re-derived names from the plan would
 * drift silently — each case below therefore asserts the referenced set against the real `outDir`
 * listing rather than against hard-coded names.
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitTheme } from "@theme-registry/refract/build";
import { createCssAdapter } from "../src";

const tmpDirs: string[] = [];
const makeTmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "css-preview-"));
  tmpDirs.push(dir);
  return dir;
};
afterAll(() => tmpDirs.forEach(d => rmSync(d, { recursive: true, force: true })));

const RAW = {
  breakpoints: { md: 768, lg: 1200 },
  colors: {
    primary: { base: "#4dabf7", text: "#ffffff", modes: [{ mode: "dark", base: "#1971c2" }] },
    recipes: { solid: { primary: { background: "primary", color: "primary.text" } } },
  },
  layout: { spacing: { base: 8, variants: { lg: 24 } } },
  components: {
    recipes: { buttons: { primary: { colors: "solid.primary", css: { cursor: "pointer" } } } },
  },
};

/** Every `<style data-rfp-source>` / `<link href>` the page pulls in, in document order. */
const referenced = (html: string): string[] => [
  ...[...html.matchAll(/data-rfp-source="([^"]+)"/g)].map(m => m[1]),
  ...[...html.matchAll(/<link rel="stylesheet" href="\.\/([^"]+)"/g)].map(m => m[1]),
];

const cssFilesIn = (dir: string): string[] => readdirSync(dir).filter(f => f.endsWith(".css"));

describe("CSS adapter preview.html", () => {
  it("single: inlines the one stylesheet and renders live recipe markup", async () => {
    const outDir = makeTmp();
    await emitTheme({ raw: RAW, adapter: createCssAdapter(), outDir, preview: true });

    const html = readFileSync(join(outDir, "preview.html"), "utf8");
    expect(referenced(html)).toEqual(["theme.css"]);
    // Inlined, not linked — the default is a single shareable file.
    expect(html).toContain('<style data-rfp-source="theme.css">');
    expect(html).not.toContain('<link rel="stylesheet"');
    expect(html).toContain(readFileSync(join(outDir, "theme.css"), "utf8").trim().slice(0, 60));

    // Live recipe plate: the real composition class, on an inferred <button> for a "buttons" group.
    expect(html).toContain("dt-components-buttons-primary");
    expect(html).toMatch(/<button class="[^"]*dt-components-buttons-primary/);
    expect(html).not.toContain("recipes are listed by name only");

    // Token plates come from the DTCG export, so they exist regardless of adapter.
    expect(html).toContain("#4dabf7");
    expect(html).toContain('rfp-plate-title">color ');
  });

  it("split: links variables BEFORE styles (the load-order contract)", async () => {
    const outDir = makeTmp();
    await emitTheme({ raw: RAW, adapter: createCssAdapter(), outDir, emit: "split", preview: true });

    const html = readFileSync(join(outDir, "preview.html"), "utf8");
    expect(referenced(html)).toEqual(["variables.css", "styles.css"]);
    expect(new Set(referenced(html))).toEqual(new Set(cssFilesIn(outDir)));
  });

  it("subsystem: references every emitted file, variables first, and groups plates by subsystem", async () => {
    const outDir = makeTmp();
    await emitTheme({
      raw: RAW,
      adapter: createCssAdapter(),
      outDir,
      emit: { type: "subsystem", filename: (sub, kind) => `${sub}.${kind}.css` },
      preview: true,
    });

    const html = readFileSync(join(outDir, "preview.html"), "utf8");
    const refs = referenced(html);
    // Against the real listing — a re-derived name would pass a hard-coded assertion and fail here.
    expect(new Set(refs)).toEqual(new Set(cssFilesIn(outDir)));
    expect(refs.every(f => f.endsWith(".variables.css") || f.endsWith(".styles.css"))).toBe(true);
    const firstStyles = refs.findIndex(f => f.endsWith(".styles.css"));
    const lastVariables = refs.map(f => f.endsWith(".variables.css")).lastIndexOf(true);
    expect(lastVariables).toBeLessThan(firstStyles);
    // The custom `filename` fn is what produced these names — proof they came from the real emit.
    expect(refs).toContain("colors.variables.css");
  });

  it("components: uses the OWN class (not the composition list) and marks other subsystems un-emitted", async () => {
    const outDir = makeTmp();
    await emitTheme({
      raw: RAW,
      adapter: createCssAdapter(),
      outDir,
      emit: { type: "components", filename: c => `${c.group}.${c.variant}.css` },
      preview: true,
    });

    const html = readFileSync(join(outDir, "preview.html"), "utf8");
    expect(new Set(referenced(html))).toEqual(new Set(cssFilesIn(outDir)));
    expect(referenced(html)).toContain("buttons.primary.css");

    // The merged rule targets the component's own class, so the markup must not carry the
    // composition list (which references colors rules this mode never emits).
    expect(html).toMatch(/<button class="dt-components-buttons-primary"/);
    // The colors recipe has no CSS in this mode — the page says so instead of pretending.
    expect(html).toContain("not emitted in components mode");
  });

  it("inline: false links relative stylesheets instead of embedding them", async () => {
    const outDir = makeTmp();
    await emitTheme({
      raw: RAW,
      adapter: createCssAdapter(),
      outDir,
      preview: { inline: false, file: "specimen.html", title: "Brand specimen" },
    });

    const html = readFileSync(join(outDir, "specimen.html"), "utf8");
    expect(html).toContain('<link rel="stylesheet" href="./theme.css">');
    expect(html).not.toContain("data-rfp-source");
    expect(html).toContain("<title>Brand specimen</title>");
  });

  it("offers a mode toggle keyed to the CSS [data-theme] convention, and breakpoint frames", async () => {
    const outDir = makeTmp();
    await emitTheme({ raw: RAW, adapter: createCssAdapter(), outDir, preview: true });

    const html = readFileSync(join(outDir, "preview.html"), "utf8");
    expect(html).toContain('data-rfp-mode-attr="data-theme"');
    expect(html).toContain('data-rfp-mode data-value="dark"');
    expect(html).toContain('data-rfp-width data-value="768"');
    expect(html).toContain('data-rfp-width data-value="1200"');
  });

  it("is off by default", async () => {
    const outDir = makeTmp();
    await emitTheme({ raw: RAW, adapter: createCssAdapter(), outDir });
    expect(readdirSync(outDir)).not.toContain("preview.html");
  });
});
