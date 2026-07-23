/**
 * Effects `blur` compound reshape (Step 2 sub-criterion).
 *
 * reactSc doesn't exercise `blur`, so this locks the format-neutral reshape directly: the
 * old `effects/recipes.ts` baked `filter: blur(var(--…))` as a `{ value }` literal that
 * embedded `var()`. The clean-room interpreter must emit `{ ref: "effects.blur.<v>",
 * wrap: "blur" }` — no `var()` in the Model — and the CSS adapter renders `ref.wrap` →
 * `filter: blur(var(--…))`.
 */
import { describe, it, expect } from "vitest";
import { createTheme } from "@theme-registry/refract";
import { createCssAdapter } from "../src";

const raw = {
  breakpoints: { sm: 576, md: 768 },
  effects: {
    blur: { base: 4, variants: { lg: 12 } },
    recipes: {
      overlay: {
        frosted: { blur: "lg" },
      },
    },
  },
};

type CssTheme = {
  model: { subsystems: Record<string, { ruleSets?: Record<string, Record<string, unknown>> }> };
  css: string;
};

const build = (): CssTheme =>
  createTheme(raw, {
    adapter: createCssAdapter({ prefix: "app" }),
  }) as unknown as CssTheme;

describe("effects blur compound — format-neutral reshape", () => {
  it("emits { ref: 'effects.blur.lg', wrap: 'blur' } in the Model (no embedded var())", () => {
    const model = build().model.subsystems.effects;
    const decl = (model.ruleSets!.overlay.frosted as { declarations: Record<string, unknown> })
      .declarations.filter as { ref: string; wrap: string };
    expect(decl).toEqual({ ref: "effects.blur.lg", wrap: "blur" });
    expect(JSON.stringify(model)).not.toContain("var(");
  });

  it("renders filter: blur(var(--app-effects-blur-lg)) in the CSS", () => {
    expect(build().css).toContain("filter: blur(var(--app-effects-blur-lg));");
  });
});
