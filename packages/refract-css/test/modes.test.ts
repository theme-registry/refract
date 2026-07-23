/**
 * Appearance modes (§10.3) — dark/light as a general "mode" axis parallel to variants/responsive.
 *
 * Modes are a LIST of override entries (`{ mode, target?, ...value }`), sharing the WHEN/WHERE/WHAT
 * spine with `responsive` + recipe `states`. Covers the core primitive (the `modes` array in
 * normalize → `PropertyModel.modes: PropertyOverride[]`, literal for any subsystem + derived baked by
 * the colors hook), the CSS adapter's dual emit (`prefers-color-scheme` media + `[data-theme]`
 * attribute blocks redefining the same var names), multi-field (base + `text`) modes, arbitrary named
 * modes (attr-only), cross-property refs, `target` (scope into a variant var), `override()`
 * re-derivation, the guard on a derived mode a subsystem can't bake, and additive byte-parity.
 */
import { describe, it, expect } from "vitest";
import { createTheme } from "@theme-registry/refract";
import { createCssAdapter } from "../src";
import { darken, lighten, alpha } from "@theme-registry/refract/color-math";

const build = (raw: Record<string, unknown>, options: Record<string, unknown> = {}) =>
  createTheme(raw as any, {
    adapter: createCssAdapter({ prefix: "dt", ...options }),
  }) as any;

/** Find a mode override entry by name (modes are now a list). */
const modeEntry = (pm: any, mode: string) => pm.modes.find((m: any) => m.mode === mode);
/** The field-map (`base` + extras) of a mode override entry. */
const modeFields = (pm: any, mode: string) => modeEntry(pm, mode).overrides;

describe("modes — core primitive (normalize → PropertyModel.modes list)", () => {
  it("a literal mode fills the PropertyModel modes list (base field)", () => {
    const theme = build({ colors: { surface: { base: "#ffffff", modes: [{ mode: "dark", base: "#0d1117" }] } } });
    const surface = theme.model.subsystems.colors.properties.surface;
    expect(surface.modes).toEqual([{ mode: "dark", overrides: { base: { value: "rgb(13, 17, 23)" } } }]);
  });

  it("a multi-field mode overrides base + extras (colors' text)", () => {
    const theme = build({
      colors: { surface: { base: "#ffffff", text: "#111111", modes: [{ mode: "dark", base: "#0d1117", text: "#e6edf3" }] } },
    });
    const surface = theme.model.subsystems.colors.properties.surface;
    expect(modeFields(surface, "dark")).toEqual({ base: { value: "rgb(13, 17, 23)" }, text: { value: "rgb(230, 237, 243)" } });
  });

  it("modes work on any subsystem (typography literal mode)", () => {
    const theme = build({ typography: { letterSpacing: { base: "0", modes: [{ mode: "dark", base: "0.01em" }] } } });
    const ls = theme.model.subsystems.typography.properties.letterSpacing;
    // §21: letterSpacing is a length — the pinned `0.01em` parses to a resolved dimension.
    expect(ls.modes).toEqual([{ mode: "dark", overrides: { base: { value: 0.01, unit: "em" } } }]);
  });

  it("no modes authored → no modes field, byte-identical model shape", () => {
    const theme = build({ colors: { surface: { base: "#ffffff" } } });
    expect(theme.model.subsystems.colors.properties.surface.modes).toBeUndefined();
    expect(theme.css.includes("prefers-color-scheme")).toBe(false);
    expect(theme.css.includes("data-theme")).toBe(false);
  });

  it("modes are not exposed as tokens (token surface unchanged)", () => {
    // Same palette with and without a mode → identical token keys (modes are emit-only, not tokens).
    const withMode = build({ colors: { surface: { base: "#ffffff", modes: [{ mode: "dark", base: "#0d1117" }] } } });
    const noMode = build({ colors: { surface: { base: "#ffffff" } } });
    expect(Object.keys(withMode.tokens)).toEqual(Object.keys(noMode.tokens));
  });
});

describe("modes — derived (baked by the colors hook, mirrors tonal steps)", () => {
  it("a derived-base mode bakes the value + records the derivation", () => {
    const theme = build({ colors: { ink: { base: "#ffffff", modes: [{ mode: "dark", modifiers: [{ darken: 80 }] }] } } });
    const ink = theme.model.subsystems.colors.properties.ink;
    expect(modeFields(ink, "dark").base).toEqual({
      ref: "colors.ink",
      modifiers: [{ fn: "darken", arg: 80 }], // dec.2 — the folded chain (single dial here)
      value: darken("#ffffff", 80), // OKLCH ΔL 80 off white → a dark grey
    });
    expect(modeFields(ink, "dark").base.value).toBe("rgb(22, 22, 22)");
  });

  it("a derived base + literal extra in one mode object", () => {
    const theme = build({
      colors: { ink: { base: "#111111", text: "#fff", modes: [{ mode: "dark", modifiers: [{ lighten: 80 }], text: "#000" }] } },
    });
    const dark = modeFields(theme.model.subsystems.colors.properties.ink, "dark");
    expect(dark.base.value).toBe(lighten("#111111", 80));
    expect(dark.text).toEqual({ value: "rgb(0, 0, 0)" });
  });

  it("dec.2 — a multi-modifier chain folds left-to-right over the own base", () => {
    const theme = build({ colors: { ink: { base: "#ffffff", modes: [{ mode: "dark", modifiers: [{ darken: 40 }, { alpha: 80 }] }] } } });
    const dark = modeFields(theme.model.subsystems.colors.properties.ink, "dark");
    // darken THEN alpha, in author order.
    expect(dark.base.value).toBe(alpha(darken("#ffffff", 40), 80));
    expect(dark.base.modifiers).toEqual([{ fn: "darken", arg: 40 }, { fn: "alpha", arg: 80 }]);
  });

  it("dec.4 — a mode derives from a SAME-property variant via `ref` (not the own base)", () => {
    const theme = build({
      colors: { ink: { base: "#ffffff", variants: { mid: "#888888" }, modes: [{ mode: "dark", ref: "mid", modifiers: [{ darken: 10 }] }] } },
    });
    const dark = modeFields(theme.model.subsystems.colors.properties.ink, "dark");
    expect(dark.base.value).toBe(darken(theme.resolveToken("colors.ink.mid"), 10));
    expect(dark.base.ref).toBe("colors.ink.mid");
    expect(dark.base.modifiers).toEqual([{ fn: "darken", arg: 10 }]);
  });

  it("dec.4 — a CROSS-property mode ref bakes against the token map (post-build pass)", () => {
    const theme = build({
      colors: { neutral: { base: "#888888" }, ink: { base: "#ffffff", modes: [{ mode: "dark", ref: "colors.neutral", modifiers: [{ darken: 10 }] }] } },
    });
    const dark = modeFields(theme.model.subsystems.colors.properties.ink, "dark");
    // source = colors.neutral's base, then darken(10) — resolved after the whole token map exists.
    expect(dark.base.value).toBe(darken(theme.resolveToken("colors.neutral"), 10));
    expect(dark.base.ref).toBe("colors.neutral");
    expect(dark.base.modifiers).toEqual([{ fn: "darken", arg: 10 }]);
    // and it lowers to the baked value in the dark blocks.
    expect(theme.css).toContain(`--dt-colors-ink: ${darken(theme.resolveToken("colors.neutral"), 10)};`);
  });

  it("dec.4 — a cross-property mode ref to an UNKNOWN token throws loud", () => {
    expect(() =>
      build({
        colors: { ink: { base: "#ffffff", modes: [{ mode: "dark", ref: "colors.nope", modifiers: [{ darken: 10 }] }] } },
      }),
    ).toThrow(/references unknown token 'colors\.nope'/);
  });

  it("dec.4 — a CROSS-property VARIANT ref bakes + emits its var", () => {
    const theme = build({
      colors: { brand: { base: "#3366ff" }, ink: { base: "#ffffff", variants: { brandish: { ref: "colors.brand", modifiers: [{ darken: 20 }] } } } },
    });
    const brandish = theme.model.subsystems.colors.properties.ink.variants.brandish;
    expect(brandish.base.value).toBe(darken(theme.resolveToken("colors.brand"), 20));
    expect(brandish.base.ref).toBe("colors.brand");
    expect(theme.resolveToken("colors.ink.brandish")).toBe(darken(theme.resolveToken("colors.brand"), 20));
    expect(theme.css).toContain(`--dt-colors-ink-brandish: ${darken(theme.resolveToken("colors.brand"), 20)};`);
  });

  it("dec.4 — override of the SOURCE re-derives a cross-property value; parent stays byte-identical", () => {
    const parent = build({
      colors: { brand: { base: "#3366ff" }, ink: { base: "#ffffff", variants: { brandish: { ref: "colors.brand", modifiers: [{ darken: 20 }] } } } },
    });
    const parentValue = parent.model.subsystems.colors.properties.ink.variants.brandish.base.value;
    expect(parentValue).toBe(darken("#3366ff", 20));

    const child = parent.override({ colors: { brand: "#ff0000" } });
    // child re-derives brandish off the NEW brand, even though `ink` wasn't in the partial.
    expect(child.model.subsystems.colors.properties.ink.variants.brandish.base.value).toBe(darken(child.resolveToken("colors.brand"), 20));
    expect(child.resolveToken("colors.brand")).toBe("rgb(255, 0, 0)");
    // parent untouched (shared Refs never mutated).
    expect(parent.model.subsystems.colors.properties.ink.variants.brandish.base.value).toBe(parentValue);
  });

  it("a derived mode on a non-colors subsystem throws (no baker)", () => {
    expect(() =>
      build({ typography: { fontSize: { base: 16, modes: [{ mode: "dark", modifiers: [{ darken: 20 }] }] } } }),
    ).toThrow(/derived modes require a subsystem that resolves them/i);
  });
});

describe("modes — CSS emit (dual media + attribute blocks)", () => {
  it("dark mode emits BOTH a prefers-color-scheme media block and a [data-theme] block", () => {
    const theme = build({ colors: { surface: { base: "#ffffff", modes: [{ mode: "dark", base: "#0d1117" }] } } });
    const css = theme.css as string;

    expect(css).toContain("@media (prefers-color-scheme: dark) {");
    expect(css).toContain(':root[data-theme="dark"] {');
    // Both blocks redefine the SAME base var name.
    const occurrences = css.split("--dt-colors-surface: rgb(13, 17, 23);").length - 1;
    expect(occurrences).toBe(2);
  });

  it("a multi-field mode redefines base + text vars in each block", () => {
    const theme = build({
      colors: { surface: { base: "#ffffff", text: "#111111", modes: [{ mode: "dark", base: "#0d1117", text: "#e6edf3" }] } },
    });
    const css = theme.css as string;
    expect((css.match(/--dt-colors-surface-text: rgb\(230, 237, 243\);/g) ?? []).length).toBe(2);
  });

  it("an arbitrary named mode (no OS signal) emits attribute-only", () => {
    const theme = build({ modes: ["dark", "light", "hc"], colors: { surface: { base: "#ffffff", modes: [{ mode: "hc", base: "#000000" }] } } });
    const css = theme.css as string;
    expect(css).toContain(':root[data-theme="hc"] {');
    expect(css.includes("prefers-color-scheme: hc")).toBe(false);
  });

  it("dec.1 — an UNDECLARED custom mode throws (modes-registry typo detection)", () => {
    expect(() =>
      build({ colors: { surface: { base: "#ffffff", modes: [{ mode: "drak", base: "#000000" }] } } }),
    ).toThrow(/unknown appearance mode 'drak'/);
  });

  it("dec.1 — dark/light need no declaration (default registry)", () => {
    expect(() => build({ colors: { surface: { base: "#ffffff", modes: [{ mode: "dark", base: "#0d1117" }] } } })).not.toThrow();
  });

  it("a regular-subsystem base mode emits through the subsystem's formatting", () => {
    const theme = build({ typography: { letterSpacing: { base: "0", modes: [{ mode: "dark", base: "0.01em" }] } } });
    const css = theme.css as string;
    expect(css).toContain("--dt-typography-letterspacing: 0.01em;");
    expect(css).toContain(':root[data-theme="dark"] {');
  });

  it("a custom prefix renames mode var names too (MFE isolation)", () => {
    const theme = build(
      { colors: { surface: { base: "#ffffff", modes: [{ mode: "dark", base: "#0d1117" }] } } },
      { prefix: "mfe" },
    );
    const css = theme.css as string;
    expect(css).toContain("--mfe-colors-surface: rgb(13, 17, 23);");
    expect(css.includes("--dt-colors-surface: rgb(13, 17, 23);")).toBe(false);
  });

  it("dec.4 — a mode `target` scopes the re-declaration onto a variant's var", () => {
    // A `dark` entry targeting the `lg` variant re-declares `--…-lg` in the dark blocks (not the base var).
    const theme = build({
      colors: {
        ink: {
          base: "#ffffff",
          variants: { lg: "#888888" },
          modes: [
            { mode: "dark", base: "#0d1117" },              // base var in dark
            { mode: "dark", target: "lg", base: "#222222" }, // the lg variant's var in dark
          ],
        },
      },
    });
    const css = theme.css as string;
    // both land in the same dark blocks; the targeted one writes the variant var name.
    expect(css).toContain("--dt-colors-ink: rgb(13, 17, 23);");
    expect(css).toContain("--dt-colors-ink-lg: rgb(34, 34, 34);");
  });
});

describe("modes — override() re-derivation", () => {
  it("overriding a base with the derived-mode spec re-bakes the dark value", () => {
    const parent = build({ colors: { ink: { base: "#ffffff", modes: [{ mode: "dark", modifiers: [{ darken: 80 }] }] } } });
    expect(modeFields(parent.model.subsystems.colors.properties.ink, "dark").base.value).toBe(darken("#ffffff", 80));

    const child = parent.override({ colors: { ink: { base: "#c0c0c0", modes: [{ mode: "dark", modifiers: [{ darken: 80 }] }] } } });
    expect(modeFields(child.model.subsystems.colors.properties.ink, "dark").base.value).toBe(darken("#c0c0c0", 80));

    // Parent untouched (immutable branch).
    expect(modeFields(parent.model.subsystems.colors.properties.ink, "dark").base.value).toBe(darken("#ffffff", 80));
  });

  it("child dark-mode CSS reflects the re-derived value", () => {
    const parent = build({ colors: { ink: { base: "#ffffff", modes: [{ mode: "dark", modifiers: [{ darken: 80 }] }] } } });
    const child = parent.override({ colors: { ink: { base: "#c0c0c0", modes: [{ mode: "dark", modifiers: [{ darken: 80 }] }] } } });
    expect(child.css).toContain(`--dt-colors-ink: ${darken("#c0c0c0", 80)};`);
  });
});
