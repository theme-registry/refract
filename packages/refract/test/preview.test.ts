/**
 * Gate for §20 — the human-facing `preview.html` (`emitTheme({ preview })`).
 *
 * Covers the build layer's own guarantees, independent of any real adapter:
 *  - token plates come from the format-neutral DTCG export, so an adapter that has never heard of
 *    previews (no `describePreview` — the third-party case) still gets a useful page;
 *  - a tokens-only theme (what `refract create` scaffolds) says so instead of showing an empty box;
 *  - a descriptor naming a file that wasn't written degrades to tokens-only rather than emitting a
 *    page that points at a missing artifact;
 *  - theme-authored values can't break out of the HTML/CSS they're embedded in.
 */
import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitTheme } from "../src/build/emitTheme";
import { defineAdapter } from "../src/core/defineAdapter";

const tmpDirs: string[] = [];
const makeTmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "refract-preview-"));
  tmpDirs.push(dir);
  return dir;
};
afterAll(() => tmpDirs.forEach(d => rmSync(d, { recursive: true, force: true })));

/** The third-party case: emit-capable, but no `describePreview` at all. */
const plainAdapter = defineAdapter({
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

/** An adapter whose descriptor has drifted from what `emit()` actually writes. */
const driftedAdapter = defineAdapter({
  name: "drifted",
  version: 1,
  bind() {
    return {
      recipeName: (s: string, g: string, v: string) => `${s}-${g}-${v}`,
      renderRecipe: () => ".x{}",
      renderVariables: () => ":root{}",
      join: (parts: string[]) => parts.join("\n"),
      emit: () => ({ files: { "theme.css": ":root{}\n" } }),
      describePreview: () => ({ stylesheets: ["renamed-last-week.css"], markup: () => ({ attrs: {} }) }),
    };
  },
});

const RAW = {
  colors: {
    primary: { base: "#4dabf7", text: "#ffffff" },
    recipes: { solid: { primary: { background: "primary", color: "primary.text" } } },
  },
};

/** What `refract create` scaffolds: tokens, no recipes. */
const TOKENS_ONLY = { colors: { primary: { base: "#4dabf7" } } };

describe("preview.html", () => {
  it("is off by default", async () => {
    const outDir = makeTmp();
    await emitTheme({ raw: RAW, adapter: plainAdapter, outDir });
    expect(existsSync(join(outDir, "preview.html"))).toBe(false);
  });

  it("renders token plates for an adapter with no describePreview, and says why recipes aren't live", async () => {
    const outDir = makeTmp();
    await emitTheme({ raw: RAW, adapter: plainAdapter, outDir, preview: true });

    const html = readFileSync(join(outDir, "preview.html"), "utf8");
    // Tokens are format-neutral, so they render regardless.
    expect(html).toContain("#4dabf7");
    expect(html).toContain('id="rfp-palette"');
    // No adapter opinion ⇒ the build layer's own honest fallback, naming the format.
    expect(html).toContain("built with the stub adapter");
    expect(html).toContain("recipes are listed by name only");
    // Recipes are still NAMED (the identity is knowable) — just not rendered.
    expect(html).toContain("colors-solid-primary");
    expect(html).not.toContain("<style data-rfp-source");
  });

  it("tells a tokens-only theme what it's missing instead of showing an empty recipes box", async () => {
    const outDir = makeTmp();
    await emitTheme({ raw: TOKENS_ONLY, adapter: plainAdapter, outDir, preview: true });

    const html = readFileSync(join(outDir, "preview.html"), "utf8");
    expect(html).toContain("No recipes yet — this theme is tokens only.");
    expect(html).toContain("<code>recipes</code>");
    expect(html).toContain("#4dabf7"); // the tokens they DO have still render
  });

  it("drops a stylesheet the adapter names but never wrote, rather than linking a missing file", async () => {
    const outDir = makeTmp();
    await emitTheme({ raw: RAW, adapter: driftedAdapter, outDir, preview: true });

    const html = readFileSync(join(outDir, "preview.html"), "utf8");
    expect(html).not.toContain("renamed-last-week.css");
    expect(html).not.toContain("<link rel=\"stylesheet\"");
    // With nothing loadable left, the page degrades to tokens-only.
    expect(html).toContain("recipes are listed by name only");
  });

  it("renders no mode toggle when the adapter doesn't say how to switch modes", async () => {
    const outDir = makeTmp();
    const raw = {
      colors: { primary: { base: "#4dabf7", modes: [{ mode: "dark", base: "#1971c2" }] } },
    };
    await emitTheme({ raw, adapter: plainAdapter, outDir, preview: true });

    const html = readFileSync(join(outDir, "preview.html"), "utf8");
    // The <html> element carries no switch attribute, and no mode buttons are rendered. (The
    // inline control script always ships; it simply finds nothing to bind.)
    expect(html).not.toMatch(/<html[^>]*data-rfp-mode-attr/);
    expect(html).not.toContain('<button type="button" data-rfp-mode');
  });

  it("neutralizes theme-authored values so they can't break out of the page", async () => {
    const outDir = makeTmp();
    const raw = {
      colors: {
        // A colour keyword is passed through verbatim by the export, so it's the honest injection vector.
        "evil</style><script>alert(1)</script>": { base: "red" },
      },
    };
    await emitTheme({ raw, adapter: plainAdapter, outDir, preview: true });

    const html = readFileSync(join(outDir, "preview.html"), "utf8");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;/style&gt;&lt;script&gt;");
  });

  it("omits a section entirely when the theme has no tokens of that kind", async () => {
    const outDir = makeTmp();
    await emitTheme({ raw: TOKENS_ONLY, adapter: plainAdapter, outDir, preview: true });
    const html = readFileSync(join(outDir, "preview.html"), "utf8");

    // Colour is present; a theme with no shadows/transitions must not show empty plates for them.
    expect(html).toContain('id="rfp-palette"');
    expect(html).not.toContain('id="rfp-shape"');
    expect(html).not.toContain('id="rfp-motion"');
    // …and the rail can't advertise a section that isn't there.
    expect(html).not.toContain('href="#rfp-shape"');
  });

  it("shows no mode diff when the theme declares no modes", async () => {
    const outDir = makeTmp();
    await emitTheme({ raw: RAW, adapter: plainAdapter, outDir, preview: true });
    const html = readFileSync(join(outDir, "preview.html"), "utf8");
    expect(html).not.toContain('id="rfp-modes"');
  });

  it("keeps an unrecognized token group visible instead of dropping it", async () => {
    const outDir = makeTmp();
    // `zIndex` is mapped; a subsystem-shaped group refract doesn't special-case must still render.
    const raw = { effects: { zIndex: { base: 0, variants: { modal: 1300 } } } };
    await emitTheme({ raw, adapter: plainAdapter, outDir, preview: true });
    const html = readFileSync(join(outDir, "preview.html"), "utf8");
    expect(html).toContain("1300");
  });
});
