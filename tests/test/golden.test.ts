// Golden acceptance gate — the shipped package output, byte-identical to the frozen baseline.
// After the Step 6 barrel flip, `../src` IS the clean-room, so this asserts the clean-room output
// directly against the frozen __snapshots__ (run with `npm test`; NEVER `-u` — the snapshots are
// the parity contract and must not change).
//
// Adapter mapping: the pre-cutover `createTheme(raw, options)` read per-subsystem naming from
// top-level options AND — a legacy quirk — read the colors naming under `palette`, so a fixture's
// `colors` option was INERT and colors used the `dt` defaults. The clean-room moves naming into the
// adapter and reads the `colors` key, so to reproduce the frozen bytes we drop the (formerly inert)
// `colors` option and hand the rest to `createCssAdapter`.
import { describe, it, expect } from "vitest";
import { createTheme } from "@theme-registry/refract";
import { createCssAdapter } from "@theme-registry/refract-css";
import { fixtures } from "@theme-registry/theme-fixtures";

/** The pre-cutover `colors` naming option was inert (read under the legacy `palette` key). */
const cssOptions = (options: Record<string, unknown>): Record<string, unknown> => {
  const { colors: _inert, ...rest } = options;
  return rest;
};

describe("golden output — current-behavior baseline", () => {
  for (const [name, fx] of Object.entries(fixtures)) {
    describe(name, () => {
      const base = cssOptions(fx.options as Record<string, unknown>);
      const build = (extra: Record<string, unknown> = {}) =>
        createTheme(fx.rawTheme as any, { adapter: createCssAdapter({ ...base, ...extra }) }) as any;

      // Default adapter — the full output surface.
      const theme = build();
      it("css", () => expect(theme.css).toMatchSnapshot());
      it("variablesCss", () => expect(theme.variablesCss).toMatchSnapshot());
      it("recipesCss", () => expect(theme.recipesCss).toMatchSnapshot());
      it("nodes", () => expect(theme.nodes).toMatchSnapshot());

      // Delivery modes — CSS adapter options the model-first CSS adapter reproduces.
      it("css · inline", () => expect(build({ inline: true }).css).toMatchSnapshot());
      // A custom `prefix` renames variables AND classes uniformly (MFE isolation: one bundle per prefix).
      it("css · prefixed", () => expect(build({ prefix: "mfe" }).css).toMatchSnapshot());
    });
  }
});
