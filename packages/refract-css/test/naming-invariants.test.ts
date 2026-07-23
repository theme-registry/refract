/**
 * §7B / §17 — headline naming invariants (f6). Two guarantees the docs claim (`#naming`: "deterministic
 * … collision-free … throw") that weren't yet exercised on the OVERRIDE path:
 *   1. a custom `naming` override that maps two distinct addresses to one name THROWS (var + class);
 *   2. naming is DETERMINISTIC — a pure function of the address, so independent builds are byte-identical.
 * The default-path collision guard is covered separately in `naming-collision.test.ts`; byte-identical
 * `override()` + structural sharing in `override.test.ts`.
 */
import { describe, it, expect } from "vitest";
import { createTheme } from "@theme-registry/refract";
import { createCssAdapter } from "../src";

const raw = {
  colors: {
    brand: { base: "#4c6ef5", text: "#fff" },
    accent: { base: "#f03e3e" },
    recipes: {
      solid: {
        brand: { background: "brand", color: "brand.text" },
        accent: { background: "accent" },
      },
    },
  },
};

describe("naming — custom override collision guard (override path)", () => {
  it("throws when a variableName override maps distinct token paths to one name", () => {
    const build = () =>
      createTheme(raw, { adapter: createCssAdapter({ naming: { variableName: () => "same" } }) }).css;
    expect(build).toThrow(/variable name "--same" is produced by both/);
  });

  it("throws when a className override maps distinct rule-sets to one name", () => {
    const build = () =>
      createTheme(raw, { adapter: createCssAdapter({ naming: { className: () => "same" } }) }).css;
    expect(build).toThrow(/class name "same" is produced by both/);
  });
});

describe("naming — determinism (pure function of the address)", () => {
  it("two independent builds of the same theme emit byte-identical CSS", () => {
    const a = createTheme(raw, { adapter: createCssAdapter() });
    const b = createTheme(raw, { adapter: createCssAdapter() });
    expect(a.css).toBe(b.css);
  });

  it("re-reading the same theme's CSS is idempotent", () => {
    const t = createTheme(raw, { adapter: createCssAdapter() });
    expect(t.css).toBe(t.css);
  });

  it("names follow the deterministic address formula", () => {
    const t = createTheme(raw, { adapter: createCssAdapter() });
    // path → var name, and rule-set address → class name, both derived purely from the address.
    expect(t.css).toContain("--dt-colors-brand");
    expect(t.css).toContain(".dt-colors-solid-brand");
  });
});
