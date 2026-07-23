/**
 * §W6b — external tokens. A property authored `{ external: "<path>" }` (or `"--literal-var"`) is a
 * passthrough to a CSS variable a PARENT theme owns: it is never defined locally, references lower to
 * `var(<parent-var>)` verbatim, `resolveToken` yields that string, colour synthesis is skipped, and it
 * survives `override()`. `extends.prefix` (default `"dt"`) resolves the path form.
 */
import { describe, it, expect } from "vitest";
import { createTheme } from "@theme-registry/refract";
import { createCssAdapter } from "@theme-registry/refract-css";
import { createScssAdapter } from "@theme-registry/refract-scss";
import { createJsonAdapter } from "@theme-registry/refract-json";
import { createStyledComponentsAdapter } from "@theme-registry/refract-styled-components";
import { buildMediaDescriptor, mediaQueryString, resolveMediaConfig } from "@theme-registry/refract";

const RAW = {
  extends: { prefix: "dt" },
  colors: {
    brand: { external: "colors.brand" }, // path form → var(--dt-colors-brand)
    surface: { external: "--mat-sys-surface" }, // literal form → var(--mat-sys-surface)
    ink: "#111111",
    recipes: { solid: { button: { background: "brand", color: "ink" } } },
  },
} as const;

describe("external tokens — resolution", () => {
  const t = createTheme(RAW as any, { adapter: createCssAdapter({ prefix: "app" }) }) as any;

  it("resolveToken yields the parent var() string (path + literal forms)", () => {
    expect(t.resolveToken("colors.brand")).toBe("var(--dt-colors-brand)");
    expect(t.resolveToken("colors.surface")).toBe("var(--mat-sys-surface)");
  });

  it("path-form prefix is configurable — 'dt' / 'ng' / '' (unprefixed)", () => {
    const v = (prefix: string) =>
      (createTheme(
        { extends: { prefix }, colors: { brand: { external: "colors.brand" } } } as any,
        { adapter: createCssAdapter({ prefix: "app" }) },
      ) as any).resolveToken("colors.brand");
    expect(v("dt")).toBe("var(--dt-colors-brand)");
    expect(v("ng")).toBe("var(--ng-colors-brand)");
    expect(v("")).toBe("var(--colors-brand)");
  });

  it("does not synthesize tonal steps for an external colour", () => {
    expect(() => t.resolveToken("colors.brand.light")).toThrow(/Unknown token/);
  });
});

describe("external tokens — CSS adapter", () => {
  const css = (createTheme(RAW as any, { adapter: createCssAdapter({ prefix: "app" }) }) as any).css as string;

  it("emits no :root definition for the external token (the parent owns it)", () => {
    expect(css).not.toMatch(/--app-colors-brand\s*:/);
    expect(css).not.toMatch(/--app-colors-surface\s*:/);
    expect(css).toMatch(/--app-colors-ink\s*:/); // a normal token is still defined
  });

  it("references lower to var(<parent-var>) verbatim", () => {
    expect(css).toContain("background: var(--dt-colors-brand)");
    expect(css).toContain("color: var(--app-colors-ink)");
  });
});

describe("external tokens — every adapter", () => {
  it("SCSS defines no $var and references the parent var()", () => {
    const scss = (createTheme(RAW as any, { adapter: createScssAdapter({ prefix: "app" }) }) as any).scss as string;
    expect(scss).not.toMatch(/\$app-colors-brand\s*:/);
    expect(scss).toContain("var(--dt-colors-brand)");
  });

  it("JSON carries the external marker + the resolved var() value", () => {
    const json = (createTheme(RAW as any, { adapter: createJsonAdapter() }) as any).json;
    expect(json.tokens["colors.brand"]).toEqual({ external: "--dt-colors-brand", value: "var(--dt-colors-brand)" });
  });

  it("SC theme object entry IS the parent var() string", () => {
    const adapter = createStyledComponentsAdapter({ prefix: "app" });
    const built = createTheme(RAW as any, { adapter }) as any;
    const media = buildMediaDescriptor(built.model.breakpoints, o => mediaQueryString(o, resolveMediaConfig(undefined)));
    const src = adapter.bind(built.model, { media, containers: {}, resolve: built.resolveToken } as any).emit().files["theme.ts"];
    expect(src).toContain('"var(--dt-colors-brand)"');
  });
});

describe("external tokens — override() survival (decision 3)", () => {
  it("an external token survives an override that touches the same subsystem", () => {
    const parent = createTheme(RAW as any, { adapter: createCssAdapter({ prefix: "app" }) }) as any;
    const child = parent.override({ colors: { ink: "#222222" } });
    // The override changed ink; brand stays external (still resolves to the parent var, still undefined locally).
    expect(child.resolveToken("colors.brand")).toBe("var(--dt-colors-brand)");
    expect(child.css).not.toMatch(/--app-colors-brand\s*:/);
    expect(child.css).toContain("var(--dt-colors-brand)");
  });
});
