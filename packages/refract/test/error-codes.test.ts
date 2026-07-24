/**
 * Stable error codes + collect-all validation (P2-3). Every authoring/build error is a `RefractError`
 * carrying a stable `code` an agent can branch on, and the post-build ref-validation stage reports
 * EVERY bad reference at once as one `REFRACT_E_VALIDATION` (its `failures` lists each).
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createTheme, createNoopAdapter, defineAdapter, RefractError, assertRawTheme } from "@theme-registry/refract";

const build = (raw: unknown) => createTheme(raw as never, { adapter: createNoopAdapter() });
const codeOf = (fn: () => unknown): { code?: string; err: unknown } => {
  try {
    fn();
    return { err: undefined };
  } catch (e) {
    return { code: (e as RefractError).code, err: e };
  }
};

describe("stable error codes", () => {
  it("tags an invalid colour with REFRACT_E_COLOR_INPUT", () => {
    const { code, err } = codeOf(() => build({ colors: { x: { base: "nope" } } }));
    expect(err).toBeInstanceOf(RefractError);
    expect(code).toBe("REFRACT_E_COLOR_INPUT");
  });

  it("tags an out-of-range steps ladder with REFRACT_E_STEPS", () => {
    expect(codeOf(() => build({ colors: { x: { base: "#4c6ef5", steps: [1200] } } })).code).toBe("REFRACT_E_STEPS");
  });

  it("tags a variant referencing an unknown source with REFRACT_E_VARIANT_REF", () => {
    expect(
      codeOf(() => build({ colors: { x: { base: "#4c6ef5", variants: { y: { ref: "missing", modifiers: [{ lighten: 10 }] } } } } })).code,
    ).toBe("REFRACT_E_VARIANT_REF");
  });

  it("tags an unknown recipe property with REFRACT_E_RECIPE_PROPERTY (fail-loud passthrough)", () => {
    // `ref:` reads as a variant-swap typo; without the check it would ship as a literal `ref: subtle;`.
    const swapTypo = codeOf(() =>
      build({
        colors: {
          brand: { base: "#4c6ef5" },
          recipes: {
            outline: {
              subtle: { color: "brand" },
              brand: { color: "brand", responsive: [{ breakpoint: "lg", ref: "subtle" }] },
            },
          },
        },
      }),
    );
    expect(swapTypo.err).toBeInstanceOf(RefractError);
    expect(swapTypo.code).toBe("REFRACT_E_RECIPE_PROPERTY");

    // a plain misspelling of a property is caught the same way
    expect(
      codeOf(() => build({ colors: { brand: { base: "#4c6ef5" }, recipes: { solid: { brand: { colr: "brand" } } } } })).code,
    ).toBe("REFRACT_E_RECIPE_PROPERTY");
  });

  it("accepts real CSS properties on a colours recipe (camelCase, custom props, literal passthrough)", () => {
    expect(() =>
      build({
        colors: {
          brand: { base: "#4c6ef5" },
          recipes: {
            solid: {
              brand: { backgroundColor: "brand", color: "brand", cursor: "pointer", "--ring": "brand" },
            },
          },
        },
      }),
    ).not.toThrow();
  });

  it("tags the newly-migrated authoring errors with their domain codes (CORE-2)", () => {
    // The reviewer's named examples — each now carries a code an agent can branch on.
    expect(codeOf(() => build({ colors: { brand: { base: "#4c6ef5" } } }).resolveToken("colors.nope")).code).toBe("REFRACT_E_TOKEN_PATH");
    expect(codeOf(() => build({ globals: { preset: "bogus" } })).code).toBe("REFRACT_E_PRESET");
    expect(codeOf(() => build({ layout: { spacing: { base: 8, ratio: 1.5, step: 2 } } })).code).toBe("REFRACT_E_LAYOUT");
    expect(codeOf(() => build({ effects: { shadow: { base: "0 1px 2px black" } } })).code).toBe("REFRACT_E_EFFECTS");
    expect(
      codeOf(() =>
        build({
          colors: { brand: { base: "#4c6ef5" }, recipes: { solid: { brand: { background: "brand", responsive: [{ breakpoint: "zzz", background: "brand" }] } } } },
          breakpoints: { lg: 1024 },
        }),
      ).code,
    ).toBe("REFRACT_E_BREAKPOINT");
  });

  it("tags an unknown recipe state with REFRACT_E_STATE (needs an adapter that declares allowedStates)", () => {
    const stateful = defineAdapter<string>({
      name: "stateful-test",
      version: 1,
      allowedStates: ["hover"],
      bind: () => ({ recipeName: () => "", renderRecipe: () => "", renderVariables: () => "", join: (p) => p.join(""), emit: () => ({ files: {} }) }),
    });
    const raw = { colors: { brand: { base: "#4c6ef5" }, recipes: { solid: { brand: { background: "brand", states: [{ state: "hoverr", background: "brand" }] } } } } };
    expect(codeOf(() => createTheme(raw as never, { adapter: stateful })).code).toBe("REFRACT_E_STATE");
  });

  it("RefractError extends Error and is instanceof-checkable", () => {
    const { err } = codeOf(() => build({ colors: { x: { base: "nope" } } }));
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(RefractError);
  });
});

describe("coverage — every createTheme-reachable throw is a coded RefractError", () => {
  // Assert coverage structurally rather than by sampling (CORE-2): no raw `throw new Error(` may live
  // in the theme authoring/build path (core / subsystems / dtcg). A new one fails CI until it carries a
  // RefractErrorCode. (CLI-tooling errors under src/build are usage/IO errors and stay plain — see
  // errors.ts.) One allowlisted exception: the vendorable, import-free color-math source, whose parse
  // errors surface re-coded via colors/normalize.ts.
  const SRC = fileURLToPath(new URL("../src", import.meta.url));
  const ALLOWLIST = new Set(["subsystems/colors/utils.ts"]);
  const walk = (dir: string): string[] =>
    readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((p) => p.endsWith(".ts") && !p.endsWith(".test.ts"));

  it("has no uncoded throw in core / subsystems / dtcg", () => {
    const offenders: string[] = [];
    for (const area of ["core", "subsystems", "dtcg"]) {
      for (const rel of walk(`${SRC}/${area}`)) {
        const key = `${area}/${rel}`;
        if (ALLOWLIST.has(key)) continue;
        const text = readFileSync(`${SRC}/${area}/${rel}`, "utf8");
        const count = (text.match(/throw new Error\(/g) ?? []).length;
        if (count) offenders.push(`${key} (${count})`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("CORE-1 — documented build errors that must fire", () => {
  it("throws when a recipe responsive entry sets both variant and target", () => {
    const { err } = codeOf(() =>
      build({
        colors: {
          brand: { base: "#4c6ef5" },
          recipes: { solid: { a: { background: "brand" }, brand: { background: "brand", responsive: [{ breakpoint: "lg", variant: "a", target: "a" }] } } },
        },
        breakpoints: { lg: 1024 },
      }),
    );
    expect((err as Error).message).toContain('cannot set both "variant" and "target"');
  });

  it("keeps property-side ref + target composing (not a conflict)", () => {
    // The property lowering supports read-from-ref, write-into-target — it must NOT be swept up by the
    // recipe-only mutual-exclusion above.
    expect(() =>
      build({
        colors: { brand: { base: "#4c6ef5", variants: { x: "#ff0000" }, responsive: [{ breakpoint: "lg", ref: "x", target: "x" }] } },
        breakpoints: { lg: 1024 },
      }),
    ).not.toThrow();
  });

  it("throws when a component references a recipe that doesn't exist", () => {
    const { code, err } = codeOf(() =>
      build({
        colors: { brand: { base: "#4c6ef5" }, recipes: { solid: { brand: { background: "brand" } } } },
        components: { recipes: { buttons: { primary: { colors: "solid.ghost" } } } },
      }),
    );
    expect(code).toBe("REFRACT_E_VALIDATION");
    expect((err as RefractError).failures!.some((f) => f.includes('is not defined in "colors:solid"'))).toBe(true);
  });
});

describe("REFRACT_E_RAW_SHAPE (candidate shape guard)", () => {
  it("rejects a defineConfig({ raw, targets }) passed where a RawTheme is required", () => {
    // The documented `refract diff` trap — a config where the bare raw theme was wanted.
    const { code, err } = codeOf(() => assertRawTheme({ raw: {}, targets: [{ name: "css" }] }));
    expect(err).toBeInstanceOf(RefractError);
    expect(code).toBe("REFRACT_E_RAW_SHAPE");
  });

  it("rejects a non-object (array / null / primitive)", () => {
    expect(codeOf(() => assertRawTheme([])).code).toBe("REFRACT_E_RAW_SHAPE");
    expect(codeOf(() => assertRawTheme(null)).code).toBe("REFRACT_E_RAW_SHAPE");
    expect(codeOf(() => assertRawTheme(42)).code).toBe("REFRACT_E_RAW_SHAPE");
  });

  it("accepts a bare object — an empty theme is legitimately empty", () => {
    expect(() => assertRawTheme({})).not.toThrow();
    expect(() => assertRawTheme({ colors: { brand: { base: "#4c6ef5" } } })).not.toThrow();
  });
});

describe("collect-all validation", () => {
  it("reports every bad css ref at once as one REFRACT_E_VALIDATION", () => {
    const { code, err } = codeOf(() =>
      build({
        components: {
          recipes: {
            buttons: {
              a: { css: { color: { ref: "colors.nope1" } } },
              b: { css: { color: { ref: "colors.nope2" } } },
            },
          },
        },
      }),
    );
    expect(code).toBe("REFRACT_E_VALIDATION");
    const re = err as RefractError;
    expect(re.failures).toHaveLength(2);
    expect(re.failures!.some((f) => f.includes("colors.nope1"))).toBe(true);
    expect(re.failures!.some((f) => f.includes("colors.nope2"))).toBe(true);
    // the aggregated message still contains each underlying reason (so message-matching keeps working)
    expect(re.message).toContain("references unknown token");
  });
});
