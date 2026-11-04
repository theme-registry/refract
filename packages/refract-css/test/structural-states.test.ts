// Structural states: what a design-system component needs beyond hover / focus / disabled —
// keyboard focus, focus inside a wrapper, checked / indeterminate native controls, ARIA
// selected / expanded / invalid, an empty input, and the `has-*` forms that style a wrapper
// (a label, a field box) from the control inside it. Existing states keep their order, so a
// theme that doesn't use the new ones emits byte-identical CSS.
import { describe, it, expect } from "vitest";
import { createTheme } from "@theme-registry/refract";
import { createCssAdapter } from "../src";

const recipe = (states: Array<{ state: string; css: Record<string, string> }>) =>
  createTheme(
    { components: { recipes: { field: { box: { css: { borderWidth: "1px" }, states } } } } } as never,
    { adapter: createCssAdapter({ prefix: "t" }) },
  ).css;

describe("structural states", () => {
  it.each([
    ["focus-visible", ".t-components-field-box:focus-visible"],
    ["focus-within", ".t-components-field-box:focus-within"],
    ["has-focus-visible", ".t-components-field-box:has(:focus-visible)"],
    ["checked", ".t-components-field-box:checked"],
    ["has-checked", ".t-components-field-box:has(:checked)"],
    ["indeterminate", ".t-components-field-box:indeterminate"],
    ["has-indeterminate", ".t-components-field-box:has(:indeterminate)"],
    ["selected", '.t-components-field-box[aria-selected="true"]'],
    ["expanded", '.t-components-field-box[aria-expanded="true"]'],
    ["placeholder-shown", ".t-components-field-box:placeholder-shown"],
    ["invalid", '.t-components-field-box[aria-invalid="true"]'],
    ["has-invalid", '.t-components-field-box:has([aria-invalid="true"])'],
    ["has-disabled", ".t-components-field-box:has(:disabled)"],
  ])("%s renders %s", (state, selector) => {
    expect(recipe([{ state, css: { borderColor: "red" } }])).toContain(`${selector} {\n  border-color: red;`);
  });

  it("orders states so invalid and disabled win over hover and focus", () => {
    const css = recipe([
      { state: "has-disabled", css: { opacity: "0.5" } },
      { state: "invalid", css: { borderColor: "red" } },
      { state: "hover", css: { borderColor: "gray" } },
      { state: "focus-visible", css: { borderColor: "gold" } },
    ]);
    const at = (s: string) => css.indexOf(s);
    expect(at(":hover")).toBeLessThan(at(":focus-visible"));
    expect(at(":focus-visible")).toBeLessThan(at("[aria-invalid"));
    expect(at("[aria-invalid")).toBeLessThan(at(":has(:disabled)"));
  });

  it("keeps the existing states in their old order", () => {
    const old = ["link", "visited", "hover", "focus", "active", "disabled", "pressed"];
    const known = [...(createCssAdapter() as unknown as { allowedStates: string[] }).allowedStates];
    expect(known.filter(s => old.includes(s))).toEqual(old);
  });

  it("still rejects an unknown state", () => {
    expect(() => recipe([{ state: "wiggle", css: { color: "red" } }])).toThrow(/wiggle/);
  });
});
