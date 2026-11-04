// Recipe states in the styled-components adapter: aria states and `has` become `&…` blocks;
// `within` fails the build until it is implemented (it needs the sibling recipe's component).
import { describe, it, expect } from "vitest";
import { createTheme } from "@theme-registry/refract";
import { createStyledComponentsAdapter } from "../src";

const build = (states: unknown[]) =>
  createTheme(
    { components: { recipes: { field: { root: { css: {} }, box: { css: { borderWidth: "1px" }, states } } } } } as never,
    { adapter: createStyledComponentsAdapter({ prefix: "t" }) },
  ) as any;

/** A live SC recipe (a `css` interpolation list) → its CSS text. */
const renderLive = (rs: unknown, theme: unknown): string =>
  (rs as unknown[])
    .flat(Infinity)
    .map(x => (typeof x === "function" ? (x as (p: unknown) => unknown)({ theme }) : x))
    .map(x => (Array.isArray(x) ? renderLive(x, theme) : x))
    .filter(x => typeof x === "string")
    .join("");

describe("styled-components recipe states", () => {
  it("renders aria states and has", () => {
    const theme = build([
      { state: "aria-invalid", css: { borderColor: "red" } },
      { has: "checked", css: { borderColor: "blue" } },
    ]);
    const out = renderLive(theme.recipes.components.field.box, theme.theme);
    expect(out).toContain('&[aria-invalid="true"]');
    expect(out).toContain("&:has(:checked)");
  });

  it("fails on within", () => {
    expect(() => {
      const theme = build([{ state: "hover", within: "root", css: { color: "gold" } }]);
      renderLive(theme.recipes.components.field.box, theme.theme);
    }).toThrow(/within: "root".*not supported yet/);
  });
});
