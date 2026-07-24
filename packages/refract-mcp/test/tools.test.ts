/**
 * refract MCP — the pure tools + the project-scoped dispatch. The query tools operate on the built
 * `base` theme the server holds; `getClass` and `validateTheme` answer against the project's REAL
 * adapters (here the CSS adapter), so class names carry the configured prefix and validation catches
 * adapter-level rules a noop stand-in would miss. `callTool` dispatches over held state with NO `theme`
 * in the args (proving project-scoping). Also covers loading a real `theme.config` and reloading it.
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTheme, createNoopAdapter } from "@theme-registry/refract";
import { createCssAdapter } from "@theme-registry/refract-css";
import {
  resolveToken,
  listTokens,
  findToken,
  searchTokens,
  listRecipes,
  getClass,
  renderRecipe,
  checkContrast,
  validateTheme,
  type NamedTheme,
  type Builder,
} from "../src/tools";
import { callTool, loadTheme, guideFiles, serverVersion, isBinEntry, type Held } from "../src/server";

const raw = {
  colors: {
    brand: { base: "#4c6ef5", text: "#fff" },
    recipes: { solid: { brand: { background: "brand", color: "brand.text" } } },
  },
  components: {
    recipes: { buttons: { primary: { colors: "solid.brand", css: { padding: "8px 14px" } } } },
  },
};

// The project's real CSS build — reuse the one adapter object for the load build and validation rebuilds,
// exactly as a `theme.config` target does.
const cssAdapter = createCssAdapter();
const cssTheme = createTheme(raw as never, { adapter: cssAdapter });
const targets: NamedTheme[] = [{ name: "css", theme: cssTheme }];
const cssBuilder: Builder = { name: "css", build: (r) => void createTheme(r, { adapter: createCssAdapter() }) };
const held: Held = {
  targets: [{ name: "css", adapter: cssAdapter, theme: cssTheme }],
  base: cssTheme,
  raw: raw as never,
  path: "/virtual/theme.config.mjs",
  buildOpts: {},
};

const tmpDirs: string[] = [];
const mkTmp = () => { const d = mkdtempSync(join(tmpdir(), "mcp-")); tmpDirs.push(d); return d; };
afterAll(() => tmpDirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("query tools (over the built base theme)", () => {
  it("resolveToken returns a concrete value", () => {
    expect(resolveToken(cssTheme, "colors.brand")).toEqual({ path: "colors.brand", value: "rgb(76, 110, 245)" });
    expect(resolveToken(cssTheme, "colors.brand.dark").value).toBe("rgb(51, 77, 210)");
  });
  it("listTokens + findToken", () => {
    expect(listTokens(cssTheme)).toContain("colors.brand.dark");
    const hits = findToken(cssTheme, "colors.brand");
    expect(hits).toContain("colors.brand");
    expect(hits).toContain("colors.brand.dark");
    expect(hits.every((p) => p.startsWith("colors.brand"))).toBe(true);
  });
  it("listRecipes", () => {
    expect(listRecipes(cssTheme)).toContainEqual({ subsystem: "colors", group: "solid", variant: "brand" });
  });
});

describe("resolveToken — enriched payload", () => {
  it("returns value + varName + derivedFrom for a derived token", () => {
    const res = resolveToken(cssTheme, "colors.brand.dark", targets);
    expect(res.value).toBe("rgb(51, 77, 210)");
    expect(res.varName).toBe("dt-colors-brand-dark".replace(/^/, "--")); // "--dt-colors-brand-dark"
    expect(res.derivedFrom).toContain("colors.brand");
    expect(res.derivedFrom).toContain("darken");
  });
  it("a terminal literal has no derivedFrom; varName still resolves", () => {
    const res = resolveToken(cssTheme, "colors.brand", targets);
    expect(res.value).toBe("rgb(76, 110, 245)");
    expect(res.varName).toBe("--dt-colors-brand");
    expect(res.derivedFrom).toBeUndefined();
  });
  it("carries the configured prefix in varName (MCP-4)", () => {
    const acme = createTheme(raw as never, { adapter: createCssAdapter({ prefix: "acme" }) });
    expect(resolveToken(acme, "colors.brand.dark", [{ name: "acme", theme: acme }]).varName).toBe("--acme-colors-brand-dark");
  });
});

describe("searchTokens — fuzzy discovery on path or value", () => {
  it("matches on the token path", () => {
    const hits = searchTokens(cssTheme, "brand").map((h) => h.path);
    expect(hits).toContain("colors.brand");
    expect(hits).toContain("colors.brand.dark");
  });
  it("matches on the resolved value", () => {
    const hits = searchTokens(cssTheme, "rgb(76, 110, 245)");
    expect(hits.some((h) => h.path === "colors.brand")).toBe(true);
  });
});

describe("renderRecipe + checkContrast", () => {
  it("renderRecipe returns the recipe's own CSS", () => {
    const res = renderRecipe(targets, { subsystem: "colors", group: "solid", variant: "brand" });
    expect(res.css).toContain("background");
    expect(res.target).toBe("css");
  });
  it("checkContrast audits the theme's pairings", () => {
    const res = checkContrast(cssTheme);
    expect(typeof res.ok).toBe("boolean");
    expect(res.summary.total).toBeGreaterThan(0);
    expect(Array.isArray(res.pairings)).toBe(true);
  });
});

describe("getClass — real emitted class names", () => {
  it("returns the plain recipe class", () => {
    expect(getClass(targets, { subsystem: "colors", group: "solid", variant: "brand" })).toEqual({
      className: "dt-colors-solid-brand",
      classList: ["dt-colors-solid-brand"],
      target: "css",
    });
  });
  it("composes a component's class-list (referenced recipes + own delta)", () => {
    const composed = getClass(targets, { subsystem: "components", group: "buttons", variant: "primary" });
    expect(composed.classList).toEqual(["dt-colors-solid-brand", "dt-components-buttons-primary"]);
    expect(composed.className).toBe("dt-colors-solid-brand dt-components-buttons-primary");
    expect(composed.target).toBe("css");
  });
  it("carries the configured prefix and matches theme.getClass (MCP-3)", () => {
    const acme = createTheme(raw as never, { adapter: createCssAdapter({ prefix: "acme" }) });
    const res = getClass([{ name: "acme", theme: acme }], { subsystem: "colors", group: "solid", variant: "brand" });
    expect(res.className).toBe((acme as { getClass: (s: string, g: string, v: string) => string }).getClass("colors", "solid", "brand"));
    expect(res.className.startsWith("acme-")).toBe(true);
  });
  it("errors clearly when no target emits class names", () => {
    const noop = createTheme(raw as never, { adapter: createNoopAdapter() });
    expect(() => getClass([{ name: "json", theme: noop }], { subsystem: "colors", group: "solid", variant: "brand" })).toThrow(
      /emits class names/,
    );
  });
  it("errors on an unknown recipe", () => {
    expect(() => getClass(targets, { subsystem: "colors", group: "solid", variant: "ghost" })).toThrow(/no recipe/);
  });
});

describe("validateTheme — per target, against the real adapter", () => {
  it("passes a good theme on every target", () => {
    const res = validateTheme(raw as never, [cssBuilder]);
    expect(res.ok).toBe(true);
    expect(res.perTarget).toEqual([{ target: "css", ok: true, errors: [] }]);
  });
  it("catches an adapter-level error the noop misses (MCP-1)", () => {
    // An unknown state: core/noop declares no `allowedStates`, so it accepts anything; the CSS adapter rejects it.
    const badState = {
      colors: {
        brand: { base: "#4c6ef5" },
        recipes: { solid: { brand: { background: "brand", states: [{ state: "hoverr", background: "brand" }] } } },
      },
    };
    const core: Builder = { name: "core", build: (r) => void createTheme(r, { adapter: createNoopAdapter() }) };
    expect(validateTheme(badState as never, [core]).ok).toBe(true); // core is blind
    const css = validateTheme(badState as never, [cssBuilder]);
    expect(css.ok).toBe(false);
    expect(css.perTarget[0].errors.join(" ")).toMatch(/hoverr/);
  });
  it("collects all errors from a candidate", () => {
    const bad = validateTheme(
      {
        components: {
          recipes: { b: { a: { css: { color: { ref: "colors.nope1" } } }, c: { css: { color: { ref: "colors.nope2" } } } } },
        },
      } as never,
      [cssBuilder],
    );
    expect(bad.ok).toBe(false);
    expect(bad.perTarget[0].code).toBe("REFRACT_E_VALIDATION");
    expect(bad.perTarget[0].errors).toHaveLength(2);
  });
});

describe("callTool — project-scoped (no theme in args)", () => {
  it("getClass reads the held targets", () => {
    expect(callTool("getClass", { subsystem: "colors", group: "solid", variant: "brand" }, held)).toEqual({
      className: "dt-colors-solid-brand",
      classList: ["dt-colors-solid-brand"],
      target: "css",
    });
  });
  it("resolveToken / findToken read the held base", () => {
    expect((callTool("resolveToken", { path: "colors.brand.dark" }, held) as { value: string }).value).toBe("rgb(51, 77, 210)");
    expect(callTool("findToken", { prefix: "colors.brand" }, held)).toContain("colors.brand");
  });
  it("validateTheme prefers a candidate, falls back to the loaded theme", () => {
    expect((callTool("validateTheme", {}, held) as { ok: boolean }).ok).toBe(true); // the loaded theme is valid
    const bad = callTool("validateTheme", { theme: { colors: { x: { base: "nope" } } } }, held) as {
      ok: boolean;
      perTarget: { code?: string }[];
    };
    expect(bad.ok).toBe(false);
    expect(bad.perTarget[0].code).toBe("REFRACT_E_COLOR_INPUT");
  });
  it("errors — not ok:true — with no candidate and no loaded theme (MCP-2)", () => {
    expect(() => callTool("validateTheme", {}, null)).toThrow(/nothing to validate/);
  });
  it("validateTheme(candidate) still works with no project, via the core fallback", () => {
    const res = callTool("validateTheme", { theme: raw }, null) as { ok: boolean; perTarget: { target: string }[] };
    expect(res.ok).toBe(true);
    expect(res.perTarget[0].target).toBe("core");
  });
  it("query tools error clearly when no theme is loaded", () => {
    expect(() => callTool("getClass", { subsystem: "colors", group: "solid", variant: "brand" }, null)).toThrow(
      /no theme loaded/,
    );
  });
});

describe("coherence — guide resources + version (MCP-5/6)", () => {
  it("renders llms.txt + manifest.json from the same real names the tools return", () => {
    const files = guideFiles(held);
    expect(Object.keys(files).sort()).toEqual(["llms.txt", "manifest.json"]);
    const manifest = JSON.parse(files["manifest.json"]) as { schema: number; recipes: { name: string }[]; tokens: unknown };
    expect(manifest.schema).toBe(1);
    // The manifest's recipe names ARE the getClass names — one source of truth across surfaces.
    expect(manifest.recipes.some((r) => r.name === "dt-colors-solid-brand")).toBe(true);
    expect(manifest.tokens).toBeTruthy(); // embedded DTCG token export
    expect(files["llms.txt"]).toContain("dt-colors-solid-brand");
  });

  it("advertises the package version from package.json (not a hardcoded literal)", () => {
    expect(serverVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("diffTheme — blast radius vs the held theme", () => {
  it("reports the token + class blast radius of a candidate edit", () => {
    const candidate = {
      colors: {
        brand: { base: "#e8590c", text: "#fff" }, // changed base
        recipes: { solid: { brand: { background: "brand", color: "brand.text" } }, outline: { brand: { color: "brand" } } }, // added recipe
      },
      components: { recipes: { buttons: { primary: { colors: "solid.brand", css: { padding: "8px 14px" } } } } },
    };
    const res = callTool("diffTheme", { theme: candidate }, held) as {
      ok: boolean;
      diff: { summary: { tokensChanged: number }; tokens: { path: string; kind: string }[]; classes: { name: string; kind: string }[] };
      targets: { target: string; ok: boolean }[];
    };
    expect(res.ok).toBe(true);
    expect(res.diff.summary.tokensChanged).toBeGreaterThan(0);
    expect(res.diff.tokens.some((t) => t.path === "colors.brand" && t.kind === "changed")).toBe(true);
    expect(res.diff.classes.some((c) => c.name === "dt-colors-outline-brand" && c.kind === "added")).toBe(true);
    expect(res.targets[0].target).toBe("css");
  });

  it("reports ok:false and an empty diff when the candidate doesn't build", () => {
    const res = callTool("diffTheme", { theme: { colors: { x: { base: "nope" } } } }, held) as {
      ok: boolean;
      diff: { summary: { tokensChanged: number } };
      targets: { ok: boolean }[];
    };
    expect(res.ok).toBe(false);
    expect(res.targets[0].ok).toBe(false);
    expect(res.diff.summary.tokensChanged).toBe(0);
  });

  it("errors with no candidate and no loaded theme", () => {
    expect(() => callTool("diffTheme", {}, null)).toThrow(/nothing to diff|no theme loaded/);
  });
});

describe("loadTheme — loads and reloads a project config", () => {
  const writeConfig = (dir: string, brand: string) =>
    writeFileSync(
      join(dir, "theme.config.mjs"),
      `export default { raw: { colors: { brand: { base: "${brand}", text: "#fff" }, recipes: { solid: { brand: { background: "brand" } } } } }, targets: [] };\n`,
    );

  it("builds the base theme from a discovered/explicit config", async () => {
    const dir = mkTmp();
    writeConfig(dir, "#4c6ef5");
    const h = await loadTheme(join(dir, "theme.config.mjs"));
    expect(h.path).toBe(join(dir, "theme.config.mjs"));
    expect(callTool("resolveToken", { path: "colors.brand" }, h)).toEqual({ path: "colors.brand", value: "rgb(76, 110, 245)" });
  });

  it("reload picks up an edited config", async () => {
    const dir = mkTmp();
    const cfg = join(dir, "theme.config.mjs");
    writeConfig(dir, "#4c6ef5");
    let h = await loadTheme(cfg);
    expect((callTool("resolveToken", { path: "colors.brand" }, h) as { value: string }).value).toBe("rgb(76, 110, 245)");
    writeConfig(dir, "#e8590c"); // edit the theme
    h = await loadTheme(cfg); // what the `reload` tool / fs.watch does
    expect((callTool("resolveToken", { path: "colors.brand" }, h) as { value: string }).value).toBe("rgb(232, 89, 12)");
  });
});

describe("bin entry guard (isBinEntry)", () => {
  const self = "/pkg/dist/server.js";

  it("starts when launched through a .bin symlink (resolves both sides)", () => {
    // The failure mode: argv[1] is the symlink, import.meta.url is the real path — a raw compare misses.
    const symlink = "/proj/node_modules/.bin/refract-mcp";
    const real = (p: string): string => (p === symlink ? self : p);
    expect(isBinEntry(symlink, self, real)).toBe(true);
  });

  it("starts when launched by its own real path", () => {
    expect(isBinEntry(self, self, (p) => p)).toBe(true);
  });

  it("does NOT start when imported as a module (a different launched script)", () => {
    expect(isBinEntry("/proj/node_modules/.bin/vitest", self, (p) => p)).toBe(false);
    expect(isBinEntry(undefined, self, (p) => p)).toBe(false);
  });
});
