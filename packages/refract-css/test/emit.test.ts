/**
 * §9, 9a gate — the `emit` output-shape vocabulary + the `emit(plan)` adapter contract.
 *
 * Proves:
 *  1. `resolveEmitPlan` normalizes every authored `Emit` form (string shorthands, object forms,
 *     discriminator inference) into a fully-defaulted `NormalizedEmit`.
 *  2. The CSS adapter honors `single` (default + rename) — `emit: { file: "app.css" }` writes
 *     `app.css`, byte-identical to the default `theme.css`.
 *  3. The CSS adapter throws a clear "not yet implemented" for split/subsystem/components (9b–9e).
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCssAdapter } from "../src";
import { emitTheme } from "@theme-registry/refract/build";
import { resolveEmitPlan } from "@theme-registry/refract/build";
import { createTheme } from "@theme-registry/refract";
import { mergeComponentRuleSet } from "@theme-registry/refract";
import { reactSc, layout, responsiveComponents } from "@theme-registry/theme-fixtures";
import { statesTheme } from "@theme-registry/theme-fixtures";

/** Every `--name:` custom-property *definition* (not `var(--name)` references) in a stylesheet. */
const varDefinitions = (css: string): Set<string> =>
  new Set([...css.matchAll(/^\s*(--[A-Za-z0-9-]+)\s*:/gm)].map(m => m[1]));

/** Every `var(--name)` reference in a stylesheet. */
const varReferences = (css: string): Set<string> =>
  new Set([...css.matchAll(/var\((--[A-Za-z0-9-]+)\)/g)].map(m => m[1]));

const tmpDirs: string[] = [];
const makeTmp = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
};
afterAll(() => tmpDirs.forEach(d => rmSync(d, { recursive: true, force: true })));

const relFiles = (files: string[], outDir: string): string[] =>
  files.map(f => f.slice(outDir.length + 1)).sort();

describe("resolveEmitPlan — normalization + discriminator inference", () => {
  it("undefined → single/theme.css", () => {
    expect(resolveEmitPlan(undefined)).toEqual({ type: "single", file: "theme.css" });
  });

  it('string "single" → single/theme.css', () => {
    expect(resolveEmitPlan("single")).toEqual({ type: "single", file: "theme.css" });
  });

  it('string "split" → styles.css + variables.css', () => {
    expect(resolveEmitPlan("split")).toEqual({
      type: "split",
      file: "styles.css",
      variables: "variables.css",
    });
  });

  it('string "subsystem" → default filename fn (<sub>.css / <sub>.variables.css)', () => {
    const plan = resolveEmitPlan("subsystem");
    expect(plan.type).toBe("subsystem");
    if (plan.type !== "subsystem") throw new Error("narrowing");
    expect(plan.filename("colors", "styles")).toBe("colors.css");
    expect(plan.filename("colors", "variables")).toBe("colors.variables.css");
  });

  it('string "components" → inline true, default filename, variables on', () => {
    const plan = resolveEmitPlan("components");
    expect(plan.type).toBe("components");
    if (plan.type !== "components") throw new Error("narrowing");
    expect(plan.inline).toBe(true);
    expect(plan.variables).toBe("variables.css");
    expect(plan.filename({ group: "buttons", variant: "primary" })).toBe("buttons-primary.css");
  });

  it("{} → single (inference)", () => {
    expect(resolveEmitPlan({})).toEqual({ type: "single", file: "theme.css" });
  });

  it("{ file } → single, renamed (inference — no variables key)", () => {
    expect(resolveEmitPlan({ file: "app.css" })).toEqual({ type: "single", file: "app.css" });
  });

  it("{ variables } → split (inference — variables key tips it)", () => {
    expect(resolveEmitPlan({ variables: "vars.css" })).toEqual({
      type: "split",
      file: "styles.css",
      variables: "vars.css",
    });
  });

  it("{ file, variables } → split (both custom)", () => {
    expect(resolveEmitPlan({ file: "s.css", variables: "v.css" })).toEqual({
      type: "split",
      file: "s.css",
      variables: "v.css",
    });
  });

  it('explicit { type: "single", file } stays single', () => {
    expect(resolveEmitPlan({ type: "single", file: "one.css" })).toEqual({
      type: "single",
      file: "one.css",
    });
  });

  it('explicit { type: "split" } fills both defaults', () => {
    expect(resolveEmitPlan({ type: "split" })).toEqual({
      type: "split",
      file: "styles.css",
      variables: "variables.css",
    });
  });

  it('{ type: "subsystem" } with a custom filename fn passes it through', () => {
    const fn = (s: string, k: "styles" | "variables"): string => `${k}-${s}.css`;
    const plan = resolveEmitPlan({ type: "subsystem", filename: fn });
    if (plan.type !== "subsystem") throw new Error("narrowing");
    expect(plan.filename("layout", "variables")).toBe("variables-layout.css");
  });

  it('{ type: "components", inline: false, variables: false } preserved', () => {
    const plan = resolveEmitPlan({ type: "components", inline: false, variables: false });
    if (plan.type !== "components") throw new Error("narrowing");
    expect(plan.inline).toBe(false);
    expect(plan.variables).toBe(false);
    // default filename still filled
    expect(plan.filename({ group: "cards", variant: "elevated" })).toBe("cards-elevated.css");
  });
});

describe("emitTheme — CSS adapter honors `single` (default + rename)", () => {
  it("emit: { file: 'app.css' } writes app.css, byte-identical to default theme.css", async () => {
    const defaultOut = makeTmp("tk-emit-default-");
    const renamedOut = makeTmp("tk-emit-rename-");

    const def = await emitTheme({ raw: reactSc.rawTheme, adapter: createCssAdapter(), outDir: defaultOut });
    const ren = await emitTheme({
      raw: reactSc.rawTheme,
      adapter: createCssAdapter(),
      outDir: renamedOut,
      emit: { file: "app.css" },
    });

    expect(relFiles(def.files, defaultOut)).toEqual(["theme.css"]);
    expect(relFiles(ren.files, renamedOut)).toEqual(["app.css"]);

    const defaultCss = readFileSync(join(defaultOut, "theme.css"), "utf8");
    const renamedCss = readFileSync(join(renamedOut, "app.css"), "utf8");
    expect(renamedCss).toBe(defaultCss); // rename is the ONLY difference
  });

  it('emit: "single" behaves like the default', async () => {
    const outDir = makeTmp("tk-emit-single-");
    const result = await emitTheme({
      raw: reactSc.rawTheme,
      adapter: createCssAdapter(),
      outDir,
      emit: "single",
    });
    expect(relFiles(result.files, outDir)).toEqual(["theme.css"]);
  });
});

describe("emitTheme — CSS adapter rejects unimplemented modes + contradictory combos", () => {
  it("global inline + split throws (inline bakes values → no variables file)", async () => {
    const outDir = makeTmp("tk-emit-inline-split-");
    await expect(
      emitTheme({
        raw: reactSc.rawTheme,
        adapter: createCssAdapter({ inline: true }),
        outDir,
        emit: "split",
      }),
    ).rejects.toThrow(/emit mode 'split' cannot be combined with the global inline option/);
  });

  it("global inline + subsystem throws (same contradiction)", async () => {
    const outDir = makeTmp("tk-emit-inline-sub-");
    await expect(
      emitTheme({
        raw: reactSc.rawTheme,
        adapter: createCssAdapter({ inline: true }),
        outDir,
        emit: "subsystem",
      }),
    ).rejects.toThrow(/emit mode 'subsystem' cannot be combined with the global inline option/);
  });
});

describe("emitTheme — CSS adapter `split` mode (9b)", () => {
  it("writes styles.css + variables.css (defaults), no @import", async () => {
    const outDir = makeTmp("tk-split-");
    const result = await emitTheme({
      raw: reactSc.rawTheme,
      adapter: createCssAdapter(),
      outDir,
      emit: "split",
    });
    expect(relFiles(result.files, outDir)).toEqual(["styles.css", "variables.css"]);

    const stylesCss = readFileSync(join(outDir, "styles.css"), "utf8");
    const variablesCss = readFileSync(join(outDir, "variables.css"), "utf8");
    expect(stylesCss).toMatchSnapshot("split-styles.css");
    expect(variablesCss).toMatchSnapshot("split-variables.css");

    // Load-order contract — neither file re-joins the split with an @import.
    expect(stylesCss).not.toContain("@import");
    expect(variablesCss).not.toContain("@import");
  });

  it("honors custom file names (emit: { file, variables })", async () => {
    const outDir = makeTmp("tk-split-named-");
    const result = await emitTheme({
      raw: reactSc.rawTheme,
      adapter: createCssAdapter(),
      outDir,
      emit: { file: "rules.css", variables: "vars.css" },
    });
    expect(relFiles(result.files, outDir)).toEqual(["rules.css", "vars.css"]);
  });

  it("var/rule split is complete on a responsive theme (incl. :root overrides ↔ @media rules)", async () => {
    const outDir = makeTmp("tk-split-resp-");
    await emitTheme({
      raw: layout.rawTheme,
      adapter: createCssAdapter(),
      outDir,
      emit: "split",
    });
    const stylesCss = readFileSync(join(outDir, "styles.css"), "utf8");
    const variablesCss = readFileSync(join(outDir, "variables.css"), "utf8");

    // No var *definition* leaks into the styles file (responsive :root overrides route to variables).
    expect(stylesCss).not.toMatch(/^\s*--[A-Za-z0-9-]+\s*:/m);
    // No selector rule leaks into the variables file (responsive rule overrides route to styles).
    expect(variablesCss).not.toMatch(/^\s*\.[A-Za-z0-9-]/m);
    // But responsive machinery IS present on the right sides.
    expect(variablesCss).toContain("@media"); // responsive :root var overrides
    expect(stylesCss).toContain("@media"); // responsive rule overrides

    // Every var(--…) referenced in styles is defined in the single variables file.
    const defs = varDefinitions(variablesCss);
    for (const ref of varReferences(stylesCss)) {
      expect(defs.has(ref)).toBe(true);
    }
  });
});

describe("emitTheme — CSS adapter `subsystem` mode (9b)", () => {
  it("writes a styles+variables pair per subsystem (components = styles only)", async () => {
    const outDir = makeTmp("tk-sub-");
    const result = await emitTheme({
      raw: reactSc.rawTheme,
      adapter: createCssAdapter(),
      outDir,
      emit: "subsystem",
    });
    const files = relFiles(result.files, outDir);
    expect(files).toMatchSnapshot("subsystem-files");

    // The components subsystem owns no properties → styles file only, NO variables file.
    if (files.includes("components.css")) {
      expect(files).not.toContain("components.variables.css");
    }
    // No file is an @import re-join.
    for (const f of result.files) {
      expect(readFileSync(f, "utf8")).not.toContain("@import");
    }
  });

  it("var/rule split holds per subsystem, cross-subsystem refs resolve against sibling vars files", async () => {
    const outDir = makeTmp("tk-sub-resp-");
    const result = await emitTheme({
      raw: layout.rawTheme,
      adapter: createCssAdapter(),
      outDir,
      emit: "subsystem",
    });

    // Union of every var definition across ALL *.variables.css files (the load-order contract
    // covers the whole set — a cross-subsystem ref resolves against the sibling's file).
    const allDefs = new Set<string>();
    for (const f of result.files) {
      const css = readFileSync(f, "utf8");
      if (f.endsWith(".variables.css")) {
        expect(css).not.toMatch(/^\s*\.[A-Za-z0-9-]/m); // variables files carry no rules
        for (const d of varDefinitions(css)) allDefs.add(d);
      } else {
        expect(css).not.toMatch(/^\s*--[A-Za-z0-9-]+\s*:/m); // styles files carry no var defs
      }
    }

    // Every var(--…) referenced by any styles file resolves against the union of vars files.
    for (const f of result.files) {
      if (f.endsWith(".variables.css")) continue;
      const css = readFileSync(f, "utf8");
      for (const ref of varReferences(css)) {
        expect(allDefs.has(ref)).toBe(true);
      }
    }
  });
});

describe("emitTheme — CSS adapter `components` mode, inline (9d)", () => {
  it("writes one self-contained file per component variant (default filenames), zero var(", async () => {
    const outDir = makeTmp("tk-comp-inline-");
    const result = await emitTheme({
      raw: reactSc.rawTheme,
      adapter: createCssAdapter(reactSc.options),
      outDir,
      emit: { type: "components" },
    });

    // Default filename fn → `${group}-${variant}.css`, one file per variant.
    expect(relFiles(result.files, outDir)).toMatchSnapshot("components-inline-files");

    for (const f of result.files) {
      const css = readFileSync(f, "utf8");
      // Fully self-contained: no var(--…) reference survives inline baking.
      expect(css).not.toContain("var(");
      // No :root variable *definitions* either — the components export writes no variables file.
      expect(css).not.toMatch(/^\s*--[A-Za-z0-9-]+\s*:/m);
    }

    // Snapshot a representative flattened variant — referenced colors/typography/layout/effects
    // declarations baked in + its own `css` delta.
    expect(readFileSync(join(outDir, "buttons-primary.css"), "utf8")).toMatchSnapshot(
      "components-inline-buttons-primary.css",
    );
    // `cards.elevated` references `borders: box.elevated` (radius 12) — the baked value is 12px,
    // not the base box radius; border-radius geometry flows through the borders subsystem now (§14).
    expect(readFileSync(join(outDir, "cards-elevated.css"), "utf8")).toContain("border-radius: 12px;");
  });

  it("baked values match the resolved token variables (no drift from the referenced recipes)", async () => {
    const outDir = makeTmp("tk-comp-inline-match-");
    await emitTheme({
      raw: reactSc.rawTheme,
      adapter: createCssAdapter(reactSc.options),
      outDir,
      emit: { type: "components" },
    });
    const css = readFileSync(join(outDir, "buttons-primary.css"), "utf8");
    // colors.primary=#4dabf7, colors.primary.text=#fff, typography.fontSize.lg=20px,
    // layout.spacing.md=12px / .xl=24px, borders.radius=6px — all baked from the referenced recipes.
    expect(css).toContain("background: rgb(77, 171, 247);");
    expect(css).toContain("color: rgb(255, 255, 255);");
    expect(css).toContain("font-size: 20px;");
    expect(css).toContain("padding-top: 12px;");
    expect(css).toContain("padding-left: 24px;");
    expect(css).toContain("border-radius: 6px;");
  });

  it("filename collisions concatenate — a per-group fn bundles buttons, cards stay per-variant", async () => {
    const outDir = makeTmp("tk-comp-bundle-");
    const result = await emitTheme({
      raw: reactSc.rawTheme,
      adapter: createCssAdapter(reactSc.options),
      outDir,
      emit: {
        type: "components",
        filename: c => (c.group === "buttons" ? "buttons.css" : `${c.group}-${c.variant}.css`),
      },
    });
    const files = relFiles(result.files, outDir);
    // buttons collapse into one file; cards/badges stay one-per-variant.
    expect(files).toContain("buttons.css");
    expect(files).not.toContain("buttons-primary.css");
    expect(files).toContain("cards-default.css");
    expect(files).toContain("cards-elevated.css");

    // All three button variants are concatenated into the single buttons.css.
    const buttonsCss = readFileSync(join(outDir, "buttons.css"), "utf8");
    expect(buttonsCss).toContain(".dt-components-buttons-primary {");
    expect(buttonsCss).toContain(".dt-components-buttons-primary-sm {");
    expect(buttonsCss).toContain(".dt-components-buttons-danger {");
  });

  it('`filename: () => "components.css"` collapses every variant into one file', async () => {
    const outDir = makeTmp("tk-comp-collapse-");
    const result = await emitTheme({
      raw: reactSc.rawTheme,
      adapter: createCssAdapter(reactSc.options),
      outDir,
      emit: { type: "components", filename: () => "components.css" },
    });
    expect(relFiles(result.files, outDir)).toEqual(["components.css"]);
    const css = readFileSync(join(outDir, "components.css"), "utf8");
    // Every component variant present in the one file, still var(-free.
    expect(css).toContain(".dt-components-buttons-primary {");
    expect(css).toContain(".dt-components-cards-elevated {");
    expect(css).toContain(".dt-components-badges-success {");
    expect(css).not.toContain("var(");
  });

  it("renders states (:hover / [disabled]) and responsive (@media) inline", async () => {
    const outDir = makeTmp("tk-comp-states-");
    await emitTheme({
      raw: statesTheme.rawTheme,
      adapter: createCssAdapter(statesTheme.options),
      outDir,
      emit: { type: "components" },
    });
    const css = readFileSync(join(outDir, "buttons-primary.css"), "utf8");
    expect(css).toMatchSnapshot("components-inline-states.css");

    // Base + :hover (referenced colors hover baked + own box-shadow delta) + [disabled] + @media:hover.
    expect(css).toContain(".dt-components-buttons-primary {");
    expect(css).toContain(".dt-components-buttons-primary:hover {");
    expect(css).toContain(".dt-components-buttons-primary[disabled] {");
    expect(css).toMatch(/@media[^{]+\{\s*\n\s*\.dt-components-buttons-primary:hover \{/);
    // Referenced hover background baked (colors.primary.dark = #1c7ed6), no var(.
    expect(css).toContain("background: rgb(28, 126, 214);");
    expect(css).not.toContain("var(");
  });
});

describe("emitTheme — CSS adapter `components` mode, non-inline (9e)", () => {
  /** Union of every emitted component variant's referenced token paths (the tree-shake source). */
  const unionReferencedPaths = (): string[] => {
    const theme = createTheme(reactSc.rawTheme, { adapter: createCssAdapter(reactSc.options) });
    const paths: string[] = [];
    const ruleSets = theme.model.subsystems.components?.ruleSets ?? {};
    for (const [group, group_] of Object.entries(ruleSets)) {
      for (const variant of Object.keys(group_)) {
        for (const p of mergeComponentRuleSet(theme.model, group, variant).referencedPaths) {
          if (!paths.includes(p)) paths.push(p);
        }
      }
    }
    return paths;
  };

  it("styles files use var(--…) refs (NOT baked literals) + a tree-shaken variables.css, no @import", async () => {
    const outDir = makeTmp("tk-comp-noninline-");
    const result = await emitTheme({
      raw: reactSc.rawTheme,
      adapter: createCssAdapter(reactSc.options),
      outDir,
      emit: { type: "components", inline: false },
    });

    const files = relFiles(result.files, outDir);
    // Same per-variant layout as 9d inline, PLUS the shared tree-shaken variables file.
    expect(files).toContain("variables.css");
    expect(files).toMatchSnapshot("components-noninline-files");

    const buttons = readFileSync(join(outDir, "buttons-primary.css"), "utf8");
    expect(buttons).toMatchSnapshot("components-noninline-buttons-primary.css");
    // Refs, not baked literals: the primary background is a var, NOT `rgb(77, 171, 247)`.
    expect(buttons).toContain("var(--dt-colors-primary)");
    expect(buttons).not.toContain("rgb(77, 171, 247)");

    const variablesCss = readFileSync(join(outDir, "variables.css"), "utf8");
    expect(variablesCss).toMatchSnapshot("components-noninline-variables.css");

    // Every var(--…) referenced by any styles file is defined in variables.css; and every def in
    // variables.css is actually referenced (no dead vars leak) → set equality.
    const usedByStyles = new Set<string>();
    for (const f of result.files) {
      if (f.endsWith("variables.css")) continue;
      const css = readFileSync(f, "utf8");
      for (const ref of varReferences(css)) usedByStyles.add(ref);
      // No `@import` re-join anywhere.
      expect(css).not.toContain("@import");
    }
    expect(variablesCss).not.toContain("@import");

    const definedByVars = varDefinitions(variablesCss);
    expect([...definedByVars].sort()).toEqual([...usedByStyles].sort());
  });

  it("variables.css is tree-shaken — only referenced tokens, unreferenced ones absent", async () => {
    const outDir = makeTmp("tk-comp-treeshake-");
    await emitTheme({
      raw: reactSc.rawTheme,
      adapter: createCssAdapter(reactSc.options),
      outDir,
      emit: { type: "components", inline: false },
    });
    const variablesCss = readFileSync(join(outDir, "variables.css"), "utf8");
    const defined = varDefinitions(variablesCss);

    // Referenced tokens ARE defined (colors.primary, typography.fontSize.lg, borders.radius, …).
    expect(defined).toContain("--dt-colors-primary");
    expect(defined).toContain("--dt-typography-fontsize-lg");
    expect(defined).toContain("--dt-borders-radius");

    // Unreferenced tokens are tree-shaken OUT: no component references the `primary.lighter` palette
    // step or the `2xl`/`3xl` heading font sizes → absent (they exist in the full single-file theme).
    expect(defined).not.toContain("--dt-colors-primary-lighter");
    expect(defined).not.toContain("--dt-typography-fontsize-2xl");
    expect(defined).not.toContain("--dt-typography-fontsize-3xl");

    // The def count matches the union of every emitted variant's `referencedPaths` (1 var per path).
    expect(defined.size).toBe(unionReferencedPaths().length);

    // And it is a strict subset of the full theme's variables (tree-shake actually removed vars).
    const fullOut = makeTmp("tk-comp-full-");
    await emitTheme({ raw: reactSc.rawTheme, adapter: createCssAdapter(reactSc.options), outDir: fullOut, emit: "split" });
    const fullDefs = varDefinitions(readFileSync(join(fullOut, "variables.css"), "utf8"));
    expect(defined.size).toBeLessThan(fullDefs.size);
    for (const v of defined) expect(fullDefs).toContain(v);
  });

  it("variables: false suppresses the variables file; styles are unchanged", async () => {
    const withVarsOut = makeTmp("tk-comp-withvars-");
    const noVarsOut = makeTmp("tk-comp-novars-");
    const withVars = await emitTheme({
      raw: reactSc.rawTheme,
      adapter: createCssAdapter(reactSc.options),
      outDir: withVarsOut,
      emit: { type: "components", inline: false },
    });
    const noVars = await emitTheme({
      raw: reactSc.rawTheme,
      adapter: createCssAdapter(reactSc.options),
      outDir: noVarsOut,
      emit: { type: "components", inline: false, variables: false },
    });

    // No variables file at all — the consumer supplies the vars.
    expect(relFiles(noVars.files, noVarsOut)).not.toContain("variables.css");
    // The styles files are byte-identical to the with-variables emit (suppression is variables-only).
    for (const f of noVars.files) {
      const rel = f.slice(noVarsOut.length + 1);
      const paired = withVars.files.find(x => x.slice(withVarsOut.length + 1) === rel)!;
      expect(readFileSync(f, "utf8")).toBe(readFileSync(paired, "utf8"));
    }
  });

  it("honors a custom variables filename + bundling fn together", async () => {
    const outDir = makeTmp("tk-comp-noninline-custom-");
    const result = await emitTheme({
      raw: reactSc.rawTheme,
      adapter: createCssAdapter(reactSc.options),
      outDir,
      emit: {
        type: "components",
        inline: false,
        filename: () => "components.css",
        variables: "tokens.css",
      },
    });
    const files = relFiles(result.files, outDir);
    expect(files).toEqual(["components.css", "tokens.css"]);
    // Every ref in the collapsed styles file resolves against the custom-named variables file.
    const styles = readFileSync(join(outDir, "components.css"), "utf8");
    const tokens = varDefinitions(readFileSync(join(outDir, "tokens.css"), "utf8"));
    for (const ref of varReferences(styles)) expect(tokens).toContain(ref);
  });

  it("a custom prefix names both the styles refs and the variables defs consistently", async () => {
    const outDir = makeTmp("tk-comp-noninline-prefix-");
    const result = await emitTheme({
      raw: reactSc.rawTheme,
      adapter: createCssAdapter({ ...reactSc.options, prefix: "mfe" }),
      outDir,
      emit: { type: "components", inline: false },
    });
    const variablesCss = readFileSync(join(outDir, "variables.css"), "utf8");
    // Var defs carry the custom prefix: `--mfe-colors-primary` (not the default `--dt-…`).
    expect(variablesCss).toContain("--mfe-colors-primary");
    expect(variablesCss).not.toContain("--dt-colors-primary");

    // Styles refs use the SAME prefixed names, and every one resolves against those defs.
    const defined = varDefinitions(variablesCss);
    for (const f of result.files) {
      if (f.endsWith("variables.css")) continue;
      const css = readFileSync(f, "utf8");
      for (const ref of varReferences(css)) expect(defined).toContain(ref);
    }
  });
});

describe("emitTheme — CSS adapter `components` mode, non-inline (9e) — responsive :root overrides (§11.5)", () => {
  it("tree-shaken variables.css carries the referenced property's responsive @media :root overrides", async () => {
    const outDir = makeTmp("tk-comp-noninline-responsive-");
    const result = await emitTheme({
      raw: responsiveComponents.rawTheme,
      adapter: createCssAdapter(responsiveComponents.options),
      outDir,
      emit: { type: "components", inline: false },
    });

    const variablesCss = readFileSync(join(outDir, "variables.css"), "utf8");
    expect(variablesCss).toMatchSnapshot("components-noninline-responsive-variables.css");

    // The component (`cards.default`) references `layout.spacing.relaxed`, which carries a
    // responsive override at `lg`. So the tree-shaken variables file must contain BOTH a base
    // `:root` definition of that var AND a media-scoped override of the SAME var — proving the
    // loop at `css/index.ts:597–606` fired and survived the `referencedVars` intersection.
    const relaxedVar = [...varDefinitions(variablesCss)].find(v => v.endsWith("spacing-relaxed"));
    expect(relaxedVar).toBeDefined();

    // A media block exists, keyed to the `lg` (1024px) breakpoint...
    expect(variablesCss).toContain("@media");
    expect(variablesCss).toContain("min-width: 1024px");

    // ...and the responsive-overridden var appears inside it (base value 32px, override 40px).
    const mediaBlock = variablesCss.slice(variablesCss.indexOf("@media"));
    expect(mediaBlock).toContain(relaxedVar!);
    expect(mediaBlock).toContain("40px");

    // Tree-shaking still holds: every ref in the styles files resolves against variables.css.
    const defined = varDefinitions(variablesCss);
    for (const f of result.files) {
      if (f.endsWith("variables.css")) continue;
      for (const ref of varReferences(readFileSync(f, "utf8"))) expect(defined).toContain(ref);
    }
  });
});

describe("emitTheme — §21 units config reaches disk", () => {
  it("a units-configured build emits rem (build-time twin of createTheme's units)", async () => {
    const outDir = makeTmp("tk-emit-units-");
    const raw = {
      breakpoints: { md: 768 },
      typography: { fontSize: { base: 16, variants: { lg: 24 } } },
      layout: { spacing: { base: 16 } },
    };
    await emitTheme({
      raw: raw as never,
      adapter: createCssAdapter({ prefix: "app" }),
      outDir,
      units: { default: "rem" },
      baseFontSize: 16,
    });
    const css = readFileSync(join(outDir, "theme.css"), "utf8");
    expect(css).toContain("--app-typography-fontsize: 1rem;"); // 16 ÷ 16
    expect(css).toContain("--app-typography-fontsize-lg: 1.5rem;"); // 24 ÷ 16
    expect(css).toContain("--app-layout-spacing: 1rem;");
  });

  it("without units, a build stays px (default unchanged)", async () => {
    const outDir = makeTmp("tk-emit-nounits-");
    await emitTheme({
      raw: { typography: { fontSize: { base: 16 } } } as never,
      adapter: createCssAdapter({ prefix: "app" }),
      outDir,
    });
    expect(readFileSync(join(outDir, "theme.css"), "utf8")).toContain("--app-typography-fontsize: 16px;");
  });
});
