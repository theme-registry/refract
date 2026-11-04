// Recipe states in the SCSS adapter: aria states and `has` nest as `&…`; `within` fails the build
// until it is implemented (it needs the sibling recipe's class).
import { describe, it, expect } from "vitest";
import { createTheme } from "@theme-registry/refract";
import { createScssAdapter } from "../src";

const scss = (states: unknown[]) =>
  (createTheme(
    { components: { recipes: { field: { root: { css: {} }, box: { css: { borderWidth: "1px" }, states } } } } } as never,
    { adapter: createScssAdapter({ prefix: "t" }) },
  ) as unknown as { scss: string }).scss;

describe("scss recipe states", () => {
  it("nests aria states and has", () => {
    const out = scss([
      { state: "aria-invalid", css: { borderColor: "red" } },
      { has: "checked", css: { borderColor: "blue" } },
      { state: "hover", has: "focus-visible", css: { borderColor: "gold" } },
    ]);
    expect(out).toContain('&[aria-invalid="true"] {');
    expect(out).toContain("&:has(:checked) {");
    expect(out).toContain("&:hover:has(:focus-visible) {");
  });

  it("fails on within", () => {
    expect(() => scss([{ state: "hover", within: "root", css: { color: "gold" } }])).toThrow(/within: "root".*not supported yet/);
  });
});
