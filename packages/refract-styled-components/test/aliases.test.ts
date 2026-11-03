/**
 * Raw-theme aliases in the styled-components adapter: the theme object holds values, so an alias holds
 * its target's value, and in each mode its target's mode value.
 */
import { describe, expect, it } from "vitest";
import { createTheme } from "@theme-registry/refract";
import { createStyledComponentsAdapter } from "../src";

describe("aliases in the styled-components adapter", () => {
  const theme = createTheme(
    {
      colors: {
        accent: { base: "#e64980", modes: [{ mode: "dark", base: "#f783ac" }] },
        highlight: { ref: "colors.accent" },
        echo: { ref: "colors.highlight" },
      },
    } as never,
    { adapter: createStyledComponentsAdapter() },
  ) as unknown as { theme: { colors: Record<string, string>; modes: Record<string, { colors: Record<string, string> }> } };

  it("holds the target's value", () => {
    expect(theme.theme.colors.highlight).toBe(theme.theme.colors.accent);
  });

  it("follows the target in each mode, through a chain", () => {
    expect(theme.theme.modes.dark.colors.highlight).toBe(theme.theme.modes.dark.colors.accent);
    expect(theme.theme.modes.dark.colors.echo).toBe(theme.theme.modes.dark.colors.accent);
  });
});
