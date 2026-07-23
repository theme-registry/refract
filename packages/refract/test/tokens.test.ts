import { describe, it, expect } from "vitest";
import { createTheme, defineAdapter } from "../src/core";
import type { AdapterSpec } from "../src/core";
import { lighten, darken } from "../src/subsystems/colors/utils";

/**
 * Step 0f gate — the token surface over the colors-only walking skeleton.
 *
 * `theme.tokens` is a flat `path -> Ref` map from the Model (base + derived steps + extras,
 * rule-sets excluded); `theme.resolveToken(path)` runs the entry through the derivation
 * registry (aliases follow refs, `{ ref, fn, arg }` steps run their fn/chain).
 *
 * NOTE: the frozen golden `tokens.test.ts.snap` flows through the multi-subsystem theme
 * assembled in Phase B (steps 1–4); with a colors-only spine there is NO byte-parity to it
 * yet, so this gate asserts the colors slice directly rather than the golden snapshot.
 */

/** A trivial stub adapter — the token surface is core-owned, so render primitives are no-ops. */
function stubAdapter() {
  const spec: AdapterSpec<string> = {
    name: "stub",
    version: 1,
    bind: () => ({
      recipeName: () => "",
      renderRecipe: () => "",
      renderVariables: () => "",
      join: () => "",
    }),
  };
  return defineAdapter(spec);
}

const RAW = {
  breakpoints: { sm: 0, md: 768 },
  colors: {
    recipes: { solid: { primary: { color: "primary" } } }, // reserved — excluded from tokens
    primary: "#4dabf7",
    surface: { base: "#ffffff", text: "#111111" },
  },
} as const;

function build() {
  return createTheme(RAW, { adapter: stubAdapter() });
}

describe("theme.tokens (0f token surface, colors-only)", () => {
  it("is a flat path -> Ref map of the Model's property tokens", () => {
    const tokens = build().tokens;
    // `surface` has a base, so it synthesizes derived steps too (plus its `text` extra).
    expect(Object.keys(tokens).sort()).toEqual([
      "colors.primary",
      "colors.primary.dark",
      "colors.primary.darker",
      "colors.primary.light",
      "colors.primary.lighter",
      "colors.surface",
      "colors.surface.dark",
      "colors.surface.darker",
      "colors.surface.light",
      "colors.surface.lighter",
      "colors.surface.text",
    ]);
  });

  it("carries the base colour as a literal ref", () => {
    expect(build().tokens["colors.primary"]).toEqual({ value: "rgb(77, 171, 247)" });
  });

  it("carries derived steps as override-safe refs (not baked literals)", () => {
    const tokens = build().tokens;
    expect(tokens["colors.primary.light"]).toEqual({
      ref: "colors.primary",
      fn: "lighten",
      arg: 10,
      value: lighten("#4dabf7", 10),
    });
    // darker chains off dark
    expect(tokens["colors.primary.darker"]).toMatchObject({
      ref: "colors.primary.dark",
      fn: "darken",
      arg: 10,
    });
  });

  it("keeps sibling extras (surface.text) and excludes recipes", () => {
    const tokens = build().tokens;
    expect(tokens["colors.surface.text"]).toEqual({ value: "rgb(17, 17, 17)" });
    expect(Object.keys(tokens).some(p => p.includes("solid"))).toBe(false);
  });

  it("is cached — repeated reads return the same map instance", () => {
    const theme = build();
    expect(theme.tokens).toBe(theme.tokens);
  });
});

describe("theme.resolveToken (0f, via the derivation registry)", () => {
  it("returns a literal token's value", () => {
    const theme = build();
    expect(theme.resolveToken("colors.primary")).toBe("rgb(77, 171, 247)");
    expect(theme.resolveToken("colors.surface.text")).toBe("rgb(17, 17, 17)");
  });

  it("runs a single derivation to the concrete value", () => {
    const theme = build();
    expect(theme.resolveToken("colors.primary.light")).toBe(lighten("#4dabf7", 10));
    expect(theme.resolveToken("colors.primary.dark")).toBe(darken("#4dabf7", 10));
  });

  it("resolves a chained derived step (darker = darken(dark)) matching the cached value", () => {
    const theme = build();
    const chained = darken(darken("#4dabf7", 10), 10);
    expect(theme.resolveToken("colors.primary.darker")).toBe(chained);
    expect(theme.resolveToken("colors.primary.darker")).toBe(
      theme.tokens["colors.primary.darker"].value,
    );
  });

  it("throws on an unknown path", () => {
    expect(() => build().resolveToken("nope.missing")).toThrow(/Unknown token path/);
  });
});
