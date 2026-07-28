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
    recipes: {
      buttons: {
        primary: {
          colors: "solid.primary",
          css: { cursor: "pointer" },
          states: { hover: { css: { opacity: 0.9 } }, disabled: { css: { opacity: 0.45 } } },
        },
      },
    },
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
    expect(html).toContain('id="rfp-palette"');
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

  it("renders a state matrix with pinnable classes, and ships the rules that make them work", async () => {
    const outDir = makeTmp();
    await emitTheme({ raw: RAW, adapter: createCssAdapter(), outDir, preview: true });
    const html = readFileSync(join(outDir, "preview.html"), "utf8");

    // A column per declared state, and only the declared ones — `focus` was never authored.
    expect(html).toContain("<th>hover</th>");
    expect(html).toContain("<th>disabled</th>");
    expect(html).not.toContain("<th>focus</th>");

    // The specimen carries the pin class so the state renders AT REST — `:hover` can't be
    // triggered from markup, which is the whole reason the pin exists.
    expect(html).toMatch(/<button class="[^"]*dt-components-buttons-primary rfp-s-hover"/);

    // …and the parallel rules that give those classes meaning are inlined into the page.
    expect(html).toContain("data-rfp-state-pins");
    expect(html).toContain(".dt-components-buttons-primary.rfp-s-hover");
    expect(html).toContain(".dt-components-buttons-primary.rfp-s-disabled");

    // Crucially they are NOT in the shipped stylesheet — they exist only to drive a specimen sheet.
    expect(readFileSync(join(outDir, "theme.css"), "utf8")).not.toContain("rfp-s-hover");
  });

  it("breaks a composed identity into its parts, attributing each class to its source recipe", async () => {
    const outDir = makeTmp();
    await emitTheme({ raw: RAW, adapter: createCssAdapter(), outDir, preview: true });
    const html = readFileSync(join(outDir, "preview.html"), "utf8");

    expect(html).toContain("rfp-compose");
    expect(html).toContain("from colors.solid.primary"); // the referenced recipe, by address
    expect(html).toContain("own delta");
  });

  it("names the emitted custom property beside each token, and diffs what the dark mode changes", async () => {
    const outDir = makeTmp();
    await emitTheme({ raw: RAW, adapter: createCssAdapter(), outDir, preview: true });
    const html = readFileSync(join(outDir, "preview.html"), "utf8");

    // tokenName → the variable a reader actually types.
    expect(html).toContain("--dt-colors-primary");
    // The mode diff shows the cause, not just the result.
    expect(html).toContain("rfp-diff");
    expect(html).toContain("What changes in dark");
  });

  it("marks where the base LANDS on a ladder, never claims a rung equals it", async () => {
    const outDir = makeTmp();
    // A numeric ladder is an absolute lightness scale and refract does not snap the seed onto it,
    // so `#4dabf7` equals no rung — testing for equality would mark nothing at all.
    const raw = {
      colors: {
        brand: { base: "#4dabf7", text: "#ffffff", steps: [50, 100, 300, 500, 700, 900] },
      },
    };
    await emitTheme({ raw, adapter: createCssAdapter(), outDir, preview: true });
    const html = readFileSync(join(outDir, "preview.html"), "utf8");

    expect(html).toMatch(/<div class="rfp-rung" data-lands/);
    expect(html).toMatch(/lands &asymp; \d+/);
    expect(html).toContain("base lands here");
    // The retired equality-based marker must not come back.
    expect(html).not.toContain("data-base");
  });

  it("scores contrast only where a text pairing is declared, not on derived tints", async () => {
    const outDir = makeTmp();
    // `light`/`dark` are synthesized tints — they never declared a pairing with brand.text, so
    // scoring them yields fail badges that read as a defect in the user's theme when none exists.
    const raw = { colors: { brand: { base: "#14b8a6", text: "#ffffff" } } };
    await emitTheme({ raw, adapter: createCssAdapter(), outDir, preview: true });
    const html = readFileSync(join(outDir, "preview.html"), "utf8");

    // Contrast is computed at build time, so the readout is in the HTML rather than added by
    // script — the page is complete without JS and the number can't drift from its swatch.
    const scored = [...html.matchAll(/class="rfp-ratio"/g)].length;
    expect(scored).toBe(1); // the family base, and only the base
    expect(html).toMatch(/rfp-ratio">[\d.]+:1 · (AAA|AA|AA large|fail)</);
    expect(html).toContain("colors.brand");
    expect(html).toContain("colors.brand.light"); // the tint still renders, just unscored
  });

  it("supplies the companions a colour-only property needs, and says that it did", async () => {
    const outDir = makeTmp();
    // `border-color` paints NOTHING without a width and style — a colors.border recipe emits
    // exactly that one declaration, so without help the specimen is a completely blank box.
    const raw = {
      colors: {
        primary: { base: "#374571" },
        recipes: {
          surface: { high: { background: "primary", color: "primary" } },
          border: { primary: { borderColor: "primary" } },
        },
      },
    };
    await emitTheme({ raw, adapter: createCssAdapter(), outDir, preview: true });
    const html = readFileSync(join(outDir, "preview.html"), "utf8");

    expect(html).toMatch(/class="dt-colors-border-primary rfp-fill" style="[^"]*border-style:solid/);
    expect(html).toMatch(/style="[^"]*border-width:3px/);

    // …and discloses it, so nobody concludes their theme sets a 3px border.
    expect(html).toContain("preview adds border-width + border-style");

    // A recipe that needs no help gets none.
    const surface = html.slice(html.indexOf("colors.surface.high"), html.indexOf("colors.border.primary"));
    expect(surface).not.toContain("rfp-aid");

    // The emitted stylesheet is untouched — the companion is a preview affordance only.
    expect(readFileSync(join(outDir, "theme.css"), "utf8")).not.toContain("border-style");
  });

  it("gives a stateful colour recipe the same swatch treatment as a stateless one", async () => {
    const outDir = makeTmp();
    // colors.surface (no states) rendered as full swatches while colors.container (states) rendered
    // as text-sized blobs in a matrix — same kind of thing, two presentations, for no visible reason.
    const raw = {
      colors: {
        primary: { base: "#374571" },
        recipes: {
          container: {
            primary: {
              background: "primary",
              color: "primary.light",
              states: [{ state: "hover", background: "primary.dark" }],
            },
          },
        },
      },
    };
    await emitTheme({ raw, adapter: createCssAdapter(), outDir, preview: true });
    const html = readFileSync(join(outDir, "preview.html"), "utf8");

    // Every matrix cell for a dimensionless recipe carries the fill class.
    const cells = [...html.matchAll(/<td><div class="[^"]*rfp-fill/g)].length;
    expect(cells).toBeGreaterThanOrEqual(2); // base + hover
  });
});
