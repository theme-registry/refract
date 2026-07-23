/**
 * §7B — default-path naming collision guard. Segment sanitization collapses spaces / punctuation to
 * `-`, so two distinct token paths (or rule-sets) can sanitize to the same emitted name. The namer
 * checks for this on the DEFAULT path too (not only when a custom `naming` override is supplied), so a
 * silent merge fails loud with a path-labelled error instead of one palette clobbering the other.
 */
import { describe, it, expect } from "vitest";
import { createTheme } from "@theme-registry/refract";
import { createCssAdapter } from "../src";

describe("default-path naming collision guard", () => {
  it("throws when two palette names sanitize to the same variable name", () => {
    const build = () =>
      createTheme(
        {
          colors: {
            "brand accent": { base: "#4c6ef5" },
            "brand-accent": { base: "#f03e3e" },
          },
        },
        { adapter: createCssAdapter() },
      ).css;
    expect(build).toThrow(/naming collision/);
    expect(build).toThrow(/brand-accent/);
  });

  it("does not throw for distinct, non-colliding names (byte-identical default path)", () => {
    const theme = createTheme(
      {
        colors: {
          "brand accent": { base: "#4c6ef5" },
          neutral: { base: "#868e96" },
        },
      },
      { adapter: createCssAdapter() },
    );
    // The space is sanitized to a hyphen; no collision because the two names stay distinct.
    expect(theme.css).toContain("--dt-colors-brand-accent");
    expect(theme.css).toContain("--dt-colors-neutral");
  });
});
