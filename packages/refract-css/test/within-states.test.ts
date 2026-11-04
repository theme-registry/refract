// `within` states (components): an inner part follows its component's state, read from a sibling
// recipe of the same group (its root) — a checkbox tick shown while the box is checked, an
// input's text colour while the box is hovered — with no JavaScript.
import { describe, it, expect } from "vitest";
import { createTheme } from "@theme-registry/refract";
import { createCssAdapter } from "../src";

const build = (tick: Record<string, unknown>) =>
  createTheme(
    {
      components: {
        recipes: {
          checkbox: {
            root: { css: { display: "inline-flex" } },
            tick: { css: { opacity: "0" }, ...tick },
          },
        },
      },
    } as never,
    { adapter: createCssAdapter({ prefix: "t" }) },
  ).css;

describe("within states", () => {
  it("styles a part from its root's state", () => {
    const css = build({
      states: [
        { state: "has-checked", within: "root", css: { opacity: "1" } },
        { state: "hover", within: "root", css: { color: "gold" } },
      ],
    });
    expect(css).toContain(".t-components-checkbox-root:has(:checked) .t-components-checkbox-tick {\n  opacity: 1;");
    expect(css).toContain(".t-components-checkbox-root:hover .t-components-checkbox-tick {\n  color: gold;");
    // canonical state order: hover before has-checked, after the part's base rule
    expect(css.indexOf("root:hover .t-")).toBeGreaterThan(css.indexOf(".t-components-checkbox-tick {"));
    expect(css.indexOf("root:hover .t-")).toBeLessThan(css.indexOf("root:has(:checked) .t-"));
  });

  it("keeps the part's own states as they were", () => {
    const css = build({ states: [{ state: "focus-visible", css: { outline: "none" } }] });
    expect(css).toContain(".t-components-checkbox-tick:focus-visible {\n  outline: none;");
  });

  it("fails loud on a within that is not in the group", () => {
    expect(() => build({ states: [{ state: "hover", within: "box", css: { color: "gold" } }] })).toThrow(
      /within "box"/,
    );
  });
});
