/**
 * Animation subsystem (§10.2) — the post-CSS roadmap's last capability gap.
 *
 * Covers the enabling Model primitive (an ordered `Keyframe` on `SubsystemModel.keyframes`, the
 * first member that is neither a `PropertyModel` nor a `RuleSet`), the motion tokens
 * (duration/easing/delay, regular properties like effects), the animation-shorthand recipes
 * (composed `animation:` classes referencing a keyframe + tokens), the CSS `@keyframes` at-rule
 * lowering (incl. themed step refs), the delivery modes (inline bake / scope namespacing), the
 * unknown-keyframe throw, override re-flow, and the additive/byte-identical guard.
 */
import { describe, it, expect } from "vitest";
import { createTheme } from "@theme-registry/refract";
import { createCssAdapter } from "../src";

const raw = {
  colors: { surface: { base: "#ffffff", text: "#111" } },
  animation: {
    duration: { base: 300, variants: { fast: 150, slow: 500 } },
    easing: { base: "ease", variants: { emphasized: "cubic-bezier(0.2, 0, 0, 1)" } },
    delay: { base: 0, variants: { short: 100 } },
    keyframes: {
      fadeIn: { from: { opacity: 0 }, to: { opacity: 1 } },
      slideUp: {
        "0%": { transform: "translateY(20px)", opacity: 0, background: { ref: "colors.surface" } },
        "100%": { transform: "translateY(0)", opacity: 1 },
      },
    },
    recipes: {
      fade: { default: { keyframes: "fadeIn", duration: "fast", easing: "emphasized" } },
      rise: { default: { keyframes: "slideUp", duration: "slow", easing: "emphasized", delay: "short" } },
    },
  },
};

const build = (extra: Record<string, unknown> = {}, theme: Record<string, unknown> = raw) =>
  createTheme(theme as any, {
    adapter: createCssAdapter({ prefix: "dt", ...extra }),
  }) as any;

describe("animation — additive guard", () => {
  it("no animation slice → no animation subsystem, byte-identical (no @keyframes)", () => {
    const theme = build({}, { colors: { surface: { base: "#fff" } } });
    expect(theme.model.subsystems.animation).toBeUndefined();
    expect(theme.css.includes("@keyframes")).toBe(false);
  });
});

describe("animation — Model shape", () => {
  const model = build().model.subsystems.animation;

  it("motion tokens are regular properties (base + variants)", () => {
    expect(model.properties.duration.base).toEqual({ value: 300 });
    expect(model.properties.duration.variants.fast.base).toEqual({ value: 150 });
    expect(model.properties.easing.variants.emphasized.base).toEqual({ value: "cubic-bezier(0.2, 0, 0, 1)" });
  });

  it("keyframes are ordered { stop, declarations } steps — literal or token-ref Refs", () => {
    expect(model.keyframes.fadeIn.steps).toEqual([
      { stop: "from", declarations: { opacity: { value: 0 } } },
      { stop: "to", declarations: { opacity: { value: 1 } } },
    ]);
    // Ordered stops kept verbatim; a themed value is a token-path Ref, a geometric one a literal.
    expect(model.keyframes.slideUp.steps.map((s: any) => s.stop)).toEqual(["0%", "100%"]);
    expect(model.keyframes.slideUp.steps[0].declarations.background).toEqual({ ref: "colors.surface" });
    expect(model.keyframes.slideUp.steps[0].declarations.transform).toEqual({ value: "translateY(20px)" });
  });

  it("recipes lower to animation-* longhand refs (keyframe-name ref + motion-token refs)", () => {
    const decls = model.ruleSets.fade.default.declarations;
    expect(decls["animation-name"]).toEqual({ ref: "animation.keyframes.fadeIn" });
    expect(decls["animation-duration"]).toEqual({ ref: "animation.duration.fast" });
    expect(decls["animation-timing-function"]).toEqual({ ref: "animation.easing.emphasized" });
    // `delay` absent on `fade` → no animation-delay longhand.
    expect(decls["animation-delay"]).toBeUndefined();
  });

  it("keyframes are NOT tokens; motion tokens ARE", () => {
    const theme = build();
    expect(theme.tokens["animation.duration"]).toEqual({ value: 300 });
    expect(theme.tokens["animation.duration.fast"]).toEqual({ value: 150 });
    expect(Object.keys(theme.tokens).some(k => k.startsWith("animation.keyframes"))).toBe(false);
  });
});

describe("animation — CSS emit", () => {
  const css = build().css;

  it("emits motion-token vars (ms for duration/delay, raw easing)", () => {
    expect(css).toContain("--dt-animation-duration-fast: 150ms;");
    expect(css).toContain("--dt-animation-delay-short: 100ms;");
    expect(css).toContain("--dt-animation-easing-emphasized: cubic-bezier(0.2, 0, 0, 1);");
  });

  it("emits a @keyframes at-rule per keyframe with verbatim stops", () => {
    expect(css).toContain("@keyframes fadeIn {");
    expect(css).toMatch(/@keyframes fadeIn \{\s*from \{\s*opacity: 0;\s*\}\s*to \{\s*opacity: 1;\s*\}\s*\}/);
    // Themed step ref lowers to a var(--…); geometric values pass through.
    expect(css).toContain("@keyframes slideUp {");
    expect(css).toContain("background: var(--dt-colors-surface);");
    expect(css).toContain("transform: translateY(20px);");
  });

  it("recipes lower to a class with the composed animation: shorthand (duration easing [delay] name)", () => {
    expect(css).toContain(".dt-animation-fade-default {\n  animation: var(--dt-animation-duration-fast) var(--dt-animation-easing-emphasized) fadeIn;\n}");
    expect(css).toContain(".dt-animation-rise-default {\n  animation: var(--dt-animation-duration-slow) var(--dt-animation-easing-emphasized) var(--dt-animation-delay-short) slideUp;\n}");
  });

  it("classes surface the recipe class names", () => {
    expect(build().classes.animation).toEqual({
      fade: { default: "dt-animation-fade-default" },
      rise: { default: "dt-animation-rise-default" },
    });
  });
});

describe("animation — delivery modes", () => {
  it("inline bakes every part of the shorthand + the keyframe step ref", () => {
    const css = build({ inline: true }).css;
    expect(css).toContain(".dt-animation-fade-default {\n  animation: 150ms cubic-bezier(0.2, 0, 0, 1) fadeIn;\n}");
    expect(css).toContain(".dt-animation-rise-default {\n  animation: 500ms cubic-bezier(0.2, 0, 0, 1) 100ms slideUp;\n}");
    expect(css).toContain("background: rgb(255, 255, 255);");
    expect(css.includes(":root")).toBe(false); // inline drops the variable blocks
  });

  it("a custom prefix renames the vars but leaves the keyframe identifier untouched", () => {
    const css = build({ prefix: "mfe" }).css;
    expect(css).toContain("--mfe-animation-duration-fast: 150ms;");
    expect(css).toContain("animation: var(--mfe-animation-duration-fast) var(--mfe-animation-easing-emphasized) fadeIn;");
    expect(css).toContain("background: var(--mfe-colors-surface);"); // step ref uses the prefix
    expect(css).toContain("@keyframes fadeIn {"); // keyframe name is not a variable — keeps its identity
  });
});

describe("animation — validation", () => {
  it("an animation recipe referencing an unknown keyframe throws", () => {
    expect(() =>
      build({}, {
        animation: {
          duration: { base: 300 },
          keyframes: { fadeIn: { from: { opacity: 0 }, to: { opacity: 1 } } },
          recipes: { boom: { default: { keyframes: "missing", duration: "base" } } },
        },
      }).css,
    ).toThrow(/unknown keyframe 'missing'/);
  });
});

describe("animation — override re-flow", () => {
  it("re-authoring a motion token re-flows the var + shorthand; a keyframe replaces; parent untouched", () => {
    const parent = build();
    const child = parent.override({
      animation: {
        // keep all variants so the recipe's `slow` ref still resolves; change `fast`.
        duration: { base: 300, variants: { fast: 80, slow: 500 } },
        keyframes: { fadeIn: { from: { opacity: 0.3 }, to: { opacity: 1 } } },
      },
    });

    // Motion-token change re-flows to the var (the shorthand references it, so it flips for free).
    expect(child.css).toContain("--dt-animation-duration-fast: 80ms;");
    expect(child.css).toContain("animation: var(--dt-animation-duration-fast) var(--dt-animation-easing-emphasized) fadeIn;");
    // Keyframe replaced (name-level), slideUp inherited untouched.
    expect(child.css).toMatch(/@keyframes fadeIn \{\s*from \{\s*opacity: 0.3;/);
    expect(child.css).toContain("@keyframes slideUp {");

    // Parent is byte-unchanged (immutable derive).
    expect(parent.css).toContain("--dt-animation-duration-fast: 150ms;");
    expect(parent.css).toMatch(/@keyframes fadeIn \{\s*from \{\s*opacity: 0;/);
  });
});
