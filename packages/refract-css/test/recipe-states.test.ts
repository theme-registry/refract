// Recipe states: the four keys on a state entry — `state` (what the element is), `has` (what it
// contains), `within` (whose element it is), `target` (which variant). State names are a CSS state
// from the list or `aria-<name>`; anything else fails the build. Themes that use none of the new
// forms emit byte-identical CSS (the golden suites cover that).
import { describe, it, expect } from "vitest";
import { createTheme } from "@theme-registry/refract";
import { KNOWN_STATES } from "@theme-registry/refract/adapter-kit";
import { createCssAdapter } from "../src";

const build = (recipes: Record<string, unknown>) =>
  createTheme({ components: { recipes } } as never, { adapter: createCssAdapter({ prefix: "t" }) }).css;

/** One `field.box` recipe with the given state entries. */
const box = (states: unknown[]) => build({ field: { box: { css: { borderWidth: "1px" }, states } } });

const BOX = ".t-components-field-box";

describe("state names", () => {
  it.each([
    ["focus-visible", ":focus-visible"],
    ["focus-within", ":focus-within"],
    ["checked", ":checked"],
    ["indeterminate", ":indeterminate"],
    ["placeholder-shown", ":placeholder-shown"],
    ["aria-selected", '[aria-selected="true"]'],
    ["aria-expanded", '[aria-expanded="true"]'],
    ["aria-invalid", '[aria-invalid="true"]'],
    ["aria-current", '[aria-current="true"]'],
    ["aria-pressed", '[aria-pressed="true"]'],
    ["pressed", '[aria-pressed="true"]'],
  ])("%s renders %s", (state, suffix) => {
    expect(box([{ state, css: { borderColor: "red" } }])).toContain(`${BOX}${suffix} {\n  border-color: red;`);
  });

  it.each(["selected", "invalid", "has-checked", "aria-hovered", "hovr"])("rejects %s", state => {
    expect(() => box([{ state, css: { borderColor: "red" } }])).toThrow(/unknown state/);
  });

  it("lists every CSS state and aria state as known", () => {
    expect(KNOWN_STATES).toContain("hover");
    expect(KNOWN_STATES).toContain("aria-busy");
    expect(KNOWN_STATES.filter(s => s.startsWith("has"))).toEqual([]);
  });
});

describe("has", () => {
  it("renders a state name as :has()", () => {
    const css = box([
      { has: "checked", css: { borderColor: "blue" } },
      { has: { state: "aria-invalid" }, css: { borderColor: "red" } },
      { has: "disabled", css: { opacity: "0.5" } },
    ]);
    expect(css).toContain(`${BOX}:has(:checked) {\n  border-color: blue;`);
    expect(css).toContain(`${BOX}:has([aria-invalid="true"]) {\n  border-color: red;`);
    expect(css).toContain(`${BOX}:has([disabled]) {\n  opacity: 0.5;`);
  });

  it("combines with a state", () => {
    expect(box([{ state: "hover", has: "checked", css: { borderColor: "blue" } }])).toContain(
      `${BOX}:hover:has(:checked) {`,
    );
  });

  it("sorts right after its state, so disabled still wins over hover", () => {
    const css = box([
      { has: "disabled", css: { opacity: "0.5" } },
      { state: "aria-invalid", css: { borderColor: "red" } },
      { has: "checked", css: { borderColor: "blue" } },
      { state: "checked", css: { borderColor: "navy" } },
      { state: "hover", css: { borderColor: "gray" } },
    ]);
    const at = (s: string) => css.indexOf(`${BOX}${s} {`);
    const order = [":hover", ":checked", ":has(:checked)", '[aria-invalid="true"]', ":has([disabled])"].map(at);
    expect(order.every(i => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("rejects an unknown state, a recipe, and an entry with neither state nor has", () => {
    expect(() => box([{ has: "chekced", css: {} }])).toThrow(/unknown has state "chekced"/);
    expect(() => box([{ has: ":checked", css: {} }])).toThrow(/unknown has state/);
    expect(() => box([{ has: { recipe: "button.label" }, css: {} }])).toThrow(/`has` takes a state name/);
    expect(() => box([{ css: { color: "red" } }])).toThrow(/needs a `state`, a `has` or both/);
  });
});

describe("within", () => {
  it("styles a part from its root's state or has condition", () => {
    const css = build({
      checkbox: {
        root: { css: { display: "inline-flex" } },
        tick: {
          css: { opacity: "0" },
          states: [
            { has: "checked", within: "root", css: { opacity: "1" } },
            { state: "hover", within: "root", css: { color: "gold" } },
          ],
        },
      },
    });
    expect(css).toContain(".t-components-checkbox-root:has(:checked) .t-components-checkbox-tick {\n  opacity: 1;");
    expect(css).toContain(".t-components-checkbox-root:hover .t-components-checkbox-tick {\n  color: gold;");
    expect(css.indexOf("root:hover .t-")).toBeGreaterThan(css.indexOf(".t-components-checkbox-tick {"));
    expect(css.indexOf("root:hover .t-")).toBeLessThan(css.indexOf("root:has(:checked) .t-"));
  });

  it("follows every variant of the root (variants are full sibling classes)", () => {
    const css = build({
      button: {
        root: { css: { color: "black" }, variants: { primary: { css: { color: "blue" } }, ghost: { css: { color: "gray" } } } },
        label: { css: { color: "black" }, states: [{ state: "hover", within: "root", css: { color: "white" } }] },
      },
    });
    for (const root of ["root", "root-primary", "root-ghost"]) {
      expect(css).toContain(`.t-components-button-${root}:hover .t-components-button-label {\n  color: white;`);
    }
  });

  it("applies to the part's variants, and to one variant with target", () => {
    const css = build({
      button: {
        root: { css: { color: "black" } },
        label: {
          css: { color: "black" },
          variants: { big: { css: { fontSize: "20px" } } },
          states: [
            { state: "hover", within: "root", css: { color: "white" } },
            { state: "focus-visible", within: "root", target: "big", css: { outline: "2px solid" } },
          ],
        },
      },
    });
    expect(css).toContain(".t-components-button-root:hover .t-components-button-label {");
    expect(css).toContain(".t-components-button-root:hover .t-components-button-label-big {");
    expect(css).toContain(".t-components-button-root:focus-visible .t-components-button-label-big {\n  outline: 2px solid;");
    expect(css).not.toContain(".t-components-button-root:focus-visible .t-components-button-label {");
    expect(css).not.toContain(".t-components-button-label-big:focus-visible");
  });

  it("keeps the part's own states as they were", () => {
    const css = build({
      checkbox: { root: { css: {} }, tick: { css: { opacity: "0" }, states: [{ state: "focus-visible", css: { outline: "none" } }] } },
    });
    expect(css).toContain(".t-components-checkbox-tick:focus-visible {\n  outline: none;");
  });

  it("fails loud on a recipe outside the component, or another component's part", () => {
    const tick = (within: string) => () =>
      build({ checkbox: { root: { css: {} }, tick: { css: {}, states: [{ state: "hover", within, css: { color: "gold" } }] } } });
    expect(tick("box")).toThrow(/`within: "box"` is not a recipe of the same component/);
    expect(tick("button.root")).toThrow(/`within: "button.root"` is not a recipe of the same component/);
  });

  it("is only for component recipes", () => {
    expect(() =>
      createTheme(
        { colors: { primary: { base: "#336699" }, recipes: { solid: { primary: { background: "primary", states: [{ has: "checked", background: "primary" }] } } } } } as never,
        { adapter: createCssAdapter({ prefix: "t" }) },
      ),
    ).toThrow(/Unknown recipe property "has"/);
  });
});
