/**
 * The SCSS adapter (§ third adapter) — the idiomatic-Sass proof. Locks:
 *  1. Tokens → compile-time `$variables` (with units), refs → `$dt-…`.
 *  2. Recipes → classes with Sass nesting (`&:hover`, nested `@media`), composition → class list.
 *  3. `inline` bakes values; `emit(plan)` maps single / split (via `@use`) / components; subsystem throws.
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTheme, ref } from "@theme-registry/refract";
import { emitTheme } from "@theme-registry/refract/build";
import { createScssAdapter } from "../src";
import type { Emit } from "@theme-registry/refract";
import { statesTheme } from "@theme-registry/theme-fixtures";

type ScssTheme = {
  scss: string;
  variablesScss: string;
  rulesScss: string;
  classes: Record<string, Record<string, Record<string, unknown>>>;
};
const buildScss = (raw: unknown, options?: Parameters<typeof createScssAdapter>[0]): ScssTheme =>
  createTheme(raw as never, { adapter: createScssAdapter(options) }) as unknown as ScssTheme;

// A focused theme: colors + a fontSize scale + a composed button — enough to exercise every shape
// without the layout-structural noise of the golden fixtures.
const focused = {
  breakpoints: { md: 768 },
  colors: {
    primary: { base: "#4dabf7", text: "#fff", variants: { dark: "#1c7ed6" } },
    recipes: {
      solid: {
        primary: {
          background: "primary",
          color: "primary.text",
          states: { hover: { background: "primary.dark" } },
          responsive: [{ breakpoint: "md", state: "hover", background: "primary.dark" }],
        },
      },
    },
  },
  typography: {
    fontSize: { base: 16, variants: { lg: 20 } },
    recipes: { button: { large: { fontSize: "lg" } } },
  },
  components: {
    recipes: {
      buttons: {
        primary: {
          colors: "solid.primary",
          typography: "button.large",
          css: { cursor: "pointer" },
          states: { hover: { css: { boxShadow: "0 2px 8px" } } },
        },
      },
    },
  },
};

const tmpDirs: string[] = [];
afterAll(() => tmpDirs.forEach(d => rmSync(d, { recursive: true, force: true })));
const emitToMap = async (emit: Emit, raw: unknown, options?: Parameters<typeof createScssAdapter>[0]): Promise<Record<string, string>> => {
  const outDir = mkdtempSync(join(tmpdir(), "tk-scss-"));
  tmpDirs.push(outDir);
  const { files } = await emitTheme({ raw: raw as never, adapter: createScssAdapter(options), outDir, emit });
  const out: Record<string, string> = {};
  for (const abs of files) out[abs.slice(outDir.length + 1)] = readFileSync(abs, "utf8");
  return out;
};

describe("scss adapter — Sass output", () => {
  it("lowers tokens to $variables (with units) and recipes to classes referencing them", () => {
    const { scss, variablesScss } = buildScss(focused);

    // Tokens → compile-time $variables. Colours pass through; fontSize gains px.
    expect(variablesScss).toContain("$dt-colors-primary: rgb(77, 171, 247);");
    expect(variablesScss).toContain("$dt-colors-primary-text: rgb(255, 255, 255);");
    expect(variablesScss).toContain("$dt-typography-fontsize-lg: 20px;");

    // A recipe → a class whose declarations reference the $variables (not var(--…)).
    expect(scss).toContain(".dt-colors-solid-primary {");
    expect(scss).toContain("background: $dt-colors-primary;");
    expect(scss).toContain("color: $dt-colors-primary-text;");
    expect(scss).not.toContain("var(--");

    // States nest with `&`; state × breakpoint nests inside `@media`.
    expect(scss).toContain("&:hover {");
    expect(scss).toMatch(/@media \(min-width: 768px\) \{\s*&:hover \{/);
    // No accidental double @media prefix.
    expect(scss).not.toContain("@media @media");

    expect(scss).toMatchSnapshot();
  });

  it("composes by class list — referenced recipe classes + own delta class", () => {
    const { scss, classes } = buildScss(focused);
    const button = classes.components.buttons.primary as { className: string; classList: string[] };
    expect(button.classList).toEqual([
      "dt-colors-solid-primary",
      "dt-typography-button-large",
      "dt-components-buttons-primary",
    ]);
    // The component's OWN class carries only its delta (cursor + its own hover), not the referenced decls.
    expect(scss).toMatch(/\.dt-components-buttons-primary \{[^}]*cursor: pointer;/);
    expect(scss).toContain("box-shadow: 0 2px 8px;");
  });

  it("inline bakes resolved values — no $variables, no refs", () => {
    const { scss } = buildScss(focused, { inline: true });
    expect(scss).not.toContain("$dt-");
    expect(scss).toContain("background: rgb(77, 171, 247);");
    expect(scss).toContain("font-size: 20px;");
  });

  it("renders states + composition on a richer fixture (statesTheme)", () => {
    const { scss, classes } = buildScss(statesTheme.rawTheme);
    // colors solid.primary carries hover + disabled + a md-hover.
    expect(scss).toContain(".dt-colors-solid-primary {");
    expect(scss).toMatch(/&\[disabled\] \{/);
    // Composition: the button's class list includes the referenced colors recipe (whose :hover rides along).
    const button = classes.components.buttons.primary as { classList: string[] };
    expect(button.classList).toContain("dt-colors-solid-primary");
    expect(button.classList).toContain("dt-components-buttons-primary");
    expect(scss).toMatchSnapshot();
  });
});

describe("scss adapter — emit(plan)", () => {
  it("single (default) → one theme.scss equal to theme.scss", async () => {
    const files = await emitToMap(undefined, focused);
    expect(Object.keys(files)).toEqual(["theme.scss"]);
    expect(files["theme.scss"]).toBe(buildScss(focused).scss);
  });

  it("split → _variables.scss partial + rules file that @uses it", async () => {
    const files = await emitToMap("split", focused);
    expect(Object.keys(files).sort()).toEqual(["_variables.scss", "styles.scss"]);
    expect(files["_variables.scss"]).toContain("$dt-colors-primary:");
    expect(files["_variables.scss"]).not.toContain(".dt-");
    // The rules file wires the partial via @use (Sass module system, not @import).
    expect(files["styles.scss"].startsWith('@use "variables" as *;')).toBe(true);
    expect(files["styles.scss"]).toContain(".dt-colors-solid-primary {");
    expect(files["styles.scss"]).toContain("$dt-colors-primary;");
  });

  it("components (inline, default) → self-contained classes, baked, no $ / no @use", async () => {
    const files = await emitToMap("components", focused);
    const buttons = files["buttons-primary.scss"];
    expect(buttons).toBeTruthy();
    expect(buttons).toContain(".dt-components-buttons-primary {");
    // Merged + baked: the referenced colours recipe is flattened in with literal values.
    expect(buttons).toContain("background: rgb(77, 171, 247);");
    expect(buttons).not.toContain("$dt-");
    expect(buttons).not.toContain("@use");
  });

  it("components (inline:false) → $var refs + @use + tree-shaken _variables.scss", async () => {
    const files = await emitToMap({ type: "components", inline: false }, focused);
    const buttons = files["buttons-primary.scss"];
    expect(buttons.startsWith('@use "variables" as *;')).toBe(true);
    expect(buttons).toContain("background: $dt-colors-primary;");
    const vars = files["_variables.scss"];
    expect(vars).toContain("$dt-colors-primary:");
    // Tree-shaken: a token the button never references is absent.
    expect(vars).not.toContain("$dt-colors-primary-light");
  });

  it("subsystem → throws (v1 boundary)", async () => {
    await expect(emitToMap("subsystem", focused)).rejects.toThrow(/subsystem/);
  });
});

describe("scss adapter — globals (§9)", () => {
  const scss = buildScss({
    ...focused,
    globals: {
      preset: "preflight",
      elements: {
        a: {
          color: ref("colors.primary"),
          textDecoration: "underline",
          states: { hover: { color: ref("colors.primary.dark") } },
          variants: { subtle: { color: ref("colors.primary.dark") } },
        },
      },
    },
  }).scss;

  it("preset layers wrap selectors in :where(), themed elements are bare + nested", () => {
    // Preset normalization stays at specificity-0.
    expect(scss).toContain(":where(*,::before,::after) {");
    // Themed `a` is a bare, nested block (NOT :where()) with a nested state + nested variant.
    expect(scss).toMatch(/\na \{\n {2}color: \$dt-colors-primary;\n {2}text-decoration: underline;/);
    expect(scss).toContain("&:hover {");
    expect(scss).toContain("&.subtle {");
  });
});

describe("scss adapter — @layer (§W9)", () => {
  const raw = { colors: { brand: "#4c6ef5", recipes: { solid: { b: { background: "brand" } } } } };

  it("off by default; layer:true wraps the whole output", () => {
    const off = buildScss({ ...raw }).scss;
    expect(off).not.toContain("@layer");
    const on = (createTheme(raw as any, { adapter: createScssAdapter({ prefix: "dt", layer: true }) }) as any).scss;
    expect(on.startsWith("@layer refract {\n")).toBe(true);
    expect(on.trimEnd().endsWith("}")).toBe(true);
  });
});
