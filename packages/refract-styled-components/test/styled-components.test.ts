/**
 * styled-components adapter (§8 TS/JS emit) — the SC target emits **modules**, not a stylesheet.
 *
 * One renderer, two sinks: `emit()` serializes a literal theme object + flat `css` recipes to source;
 * the runtime `extend()` exposes the SAME shapes live & lazy. These assertions pin both — the runtime
 * surface (theme object · lazy recipes · GlobalStyle · media · scheme) and the emitted module source.
 * The Model stays format-neutral (no `var(` — values read from the theme, no CSS variables at all).
 */
import { describe, it, expect } from "vitest";
import { createTheme } from "@theme-registry/refract";
import {
  createStyledComponentsAdapter,
  type WrappedMediaDescriptor,
} from "../src";
import {
  buildMediaDescriptor,
  mediaQueryString,
  resolveMediaConfig,
} from "@theme-registry/refract";
import { reactSc } from "@theme-registry/theme-fixtures";

/** Render a live recipe `css` RuleSet to plain CSS by resolving its interpolation fns against `theme`. */
const renderLive = (rs: unknown, theme: unknown): string =>
  (rs as unknown[])
    .flat(Infinity)
    .map(x => (typeof x === "function" ? (x as (p: unknown) => unknown)({ theme }) : x))
    .map(x => (Array.isArray(x) ? renderLive(x, theme) : x))
    .filter(x => typeof x === "string")
    .join("");

const buildReactSc = () =>
  createTheme(reactSc.rawTheme as any, {
    adapter: createStyledComponentsAdapter({ prefix: "app" }),
  }) as any;

/** Bind with the PLAIN core media descriptor (what `emitTheme` passes into `bind`), for emit tests. */
const boundFor = (theme: any, options: any = {}) => {
  const adapter = createStyledComponentsAdapter(options);
  const breakpoints = theme.model.breakpoints as Record<string, number>;
  const media = buildMediaDescriptor(breakpoints, o => mediaQueryString(o, resolveMediaConfig(undefined)));
  return adapter.bind(theme.model, { media, containers: {}, resolve: theme.resolveToken } as any) as any;
};

describe("styled-components adapter — runtime surface", () => {
  it("keeps the Model format-neutral (no var(); no CSS variables)", () => {
    const theme = buildReactSc();
    expect(theme.model.subsystems.colors).toBeTruthy();
    expect(JSON.stringify(theme.model)).not.toContain("var(");
  });

  it("theme is a literal object — variants fold into their group as camelCase keys, no var()", () => {
    const theme = buildReactSc();
    expect(theme.theme.colors.primary).toBe("rgb(77, 171, 247)");
    expect(theme.theme.colors.primaryText).toBe("rgb(255, 255, 255)");
    expect(theme.theme.colors.primaryDark).toBe("rgb(28, 126, 214)");
    // A length leaf carries its unit; a unit-less number stays a number.
    expect(theme.theme.layout.spacingXl).toBe("24px");
    expect(theme.theme.typography.fontWeightSemibold).toBe(600);
    expect(theme.theme.borders.radius).toBe("6px");
    // The object IS the indirection — no CSS variable syntax anywhere.
    expect(JSON.stringify(theme.theme.colors)).not.toContain("var(");
  });

  it("recipes read values off the theme; composition spreads the referenced siblings", () => {
    const theme = buildReactSc();

    const solid = renderLive(theme.recipes.colors.solid.primary, theme.theme);
    expect(solid).toContain("background: rgb(77, 171, 247);");
    expect(solid).toContain("color: rgb(255, 255, 255);");

    // A component recipe inlines its referenced recipes (colors + typography + layout + borders) then
    // its own delta. effects/card is structured (deferred) → contributes nothing.
    const button = renderLive(theme.recipes.components.buttons.primary, theme.theme);
    expect(button).toContain("background: rgb(77, 171, 247);"); // from colors.solid.primary
    expect(button).toContain("font-size: 20px;"); // from typography.button.large
    expect(button).toContain("padding-left: 24px;"); // from layout.padding.button-lg
    expect(button).toContain("border-radius: 6px;"); // from borders.box.default
    expect(button).toContain("cursor: pointer;"); // own delta
  });

  it("renders recipe states as a nested &:hover block", () => {
    const theme = createTheme(
      {
        colors: {
          primary: { base: "#4dabf7", text: "#fff", variants: { dark: "#1c7ed6" } },
          recipes: {
            solid: {
              primary: {
                background: "primary",
                color: "primary.text",
                states: { hover: { background: "primary.dark" } },
              },
            },
          },
        },
      },
      { adapter: createStyledComponentsAdapter() },
    ) as any;

    const solid = renderLive(theme.recipes.colors.solid.primary, theme.theme);
    expect(solid).toContain("&:hover {");
    expect(solid).toContain("background: rgb(28, 126, 214);");
  });

  it("GlobalStyle is presence-driven (only when the raw defines the globals subsystem)", () => {
    // reactSc DEFINES globals → GlobalStyle present.
    expect(buildReactSc().GlobalStyle).toBeTruthy();
    // A globals-less theme → no GlobalStyle.
    const noGlobals = createTheme(
      { colors: { surface: { base: "#fff", text: "#111" } } },
      { adapter: createStyledComponentsAdapter() },
    ) as any;
    expect(noGlobals.GlobalStyle).toBeUndefined();
  });

  it("theme.media exposes SC tagged templates carrying the raw query", () => {
    const theme = buildReactSc();
    const media = theme.theme.media as WrappedMediaDescriptor<string>;
    expect(media.md.min.query).toBe("@media (min-width: 768px)");
    expect(renderLive(media.md.min`color: red;`, theme.theme)).toContain("@media (min-width: 768px)");
  });

  it("validates recipe state refs against the adapter's allowedStates", () => {
    expect(() =>
      createTheme(
        {
          colors: {
            primary: { base: "#4dabf7", text: "#fff" },
            recipes: { solid: { primary: { background: "primary", states: { nope: { background: "primary" } } } } },
          },
        },
        { adapter: createStyledComponentsAdapter() },
      ),
    ).toThrow();
  });
});

describe("styled-components adapter — emit()", () => {
  it("writes theme.ts (object + recipes + barrel) + theme.d.ts + a vendored media.ts", () => {
    const theme = buildReactSc();
    const emitted = boundFor(theme, { prefix: "app" }).emit();

    expect(Object.keys(emitted.files).sort()).toEqual(["theme.d.ts", "theme.ts"]);
    expect(Object.keys(emitted.vendorHelpers)).toEqual(["media.ts"]);

    const src = emitted.files["theme.ts"];
    // Literal theme object (no var()), camelCased variant keys.
    expect(src).toContain("export const theme = {");
    expect(src).toContain('primary: "rgb(77, 171, 247)",');
    expect(src).toContain('primaryText: "rgb(255, 255, 255)",');
    expect(src).toContain("fontWeightSemibold: 600,");
    expect(src).not.toContain("var(");

    // Flat, tree-shakeable recipe consts reading from the theme.
    expect(src).toContain("export const colorsSolidPrimary = css`");
    expect(src).toContain("background: ${({ theme }) => theme.colors.primary};");
    expect(src).toContain("color: ${({ theme }) => theme.colors.primaryText};");

    // Composition = a css spread of the referenced siblings + own delta.
    expect(src).toContain("export const componentsButtonsPrimary = css`");
    expect(src).toContain("${colorsSolidPrimary}");
    expect(src).toContain("${bordersBoxDefault}");
    expect(src).toContain("cursor: pointer;");

    // Grouped barrel referencing the flat consts.
    expect(src).toContain("export const recipes = {");
    expect(src).toContain("primary: colorsSolidPrimary,");

    // theme.d.ts augments DefaultTheme.
    expect(emitted.files["theme.d.ts"]).toContain("export interface DefaultTheme extends Readonly<typeof theme>");

    // Vendored media helper: self-contained (only styled-components), baked @media strings.
    const media = emitted.vendorHelpers["media.ts"];
    expect(media).toContain('import { css } from "styled-components";');
    expect(media).toContain('"@media (min-width: 768px)"');
    expect(media).not.toMatch(/from\s+["'](?!styled-components["'])/);
  });

  it("emit: split peels recipes into recipes.ts + the globals GlobalStyle into global.ts", () => {
    const theme = buildReactSc();
    const emitted = boundFor(theme, { prefix: "app" }).emit({ type: "split" });

    // reactSc defines globals → split also peels a global.ts alongside recipes.ts.
    expect(Object.keys(emitted.files).sort()).toEqual(["global.ts", "recipes.ts", "theme.d.ts", "theme.ts"]);
    expect(emitted.files["theme.ts"]).toContain("export const theme = {");
    expect(emitted.files["theme.ts"]).not.toContain("css`");
    expect(emitted.files["recipes.ts"]).toContain("export const colorsSolidPrimary = css`");
    expect(emitted.files["recipes.ts"]).toContain("export const recipes = {");
    expect(emitted.files["global.ts"]).toContain("createGlobalStyle`");
  });

  it("emit: globals → a nested GlobalStyle reading tokens off the theme (base + &.subtle)", () => {
    const theme = buildReactSc();
    const src = boundFor(theme, { prefix: "app" }).emit().files["theme.ts"];

    // The themed `a` element: bare selector block, its own declarations read from the theme…
    expect(src).toContain("export const GlobalStyle = createGlobalStyle`");
    expect(src).toContain("a {");
    expect(src).toContain("color: ${({ theme }) => theme.colors.primary};");
    expect(src).toContain("text-decoration: underline;");
    // …a nested `&:hover` state, a responsive `theme.media` block, and the delta-only `&.subtle` variant.
    expect(src).toContain("&:hover {");
    expect(src).toContain("&.subtle {");
    expect(src).toContain("color: ${({ theme }) => theme.colors.neutral};");
    expect(src).not.toContain("var(");
  });

  it("language: js emits .js modules and no theme.d.ts", () => {
    const theme = buildReactSc();
    const emitted = boundFor(theme, { prefix: "app", language: "js" }).emit();
    expect(Object.keys(emitted.files)).toEqual(["theme.js"]);
    expect(Object.keys(emitted.vendorHelpers)).toEqual(["media.js"]);
  });

  it("rejects the CSS-only emit modes (subsystem / components)", () => {
    const theme = buildReactSc();
    expect(() => boundFor(theme).emit({ type: "subsystem" } as any)).toThrow(/not supported/);
    expect(() => boundFor(theme).emit({ type: "components" } as any)).toThrow(/not supported/);
  });

  it("helpers: [color-math] wires the import and surfaces the fns on the theme object", () => {
    const theme = buildReactSc();
    const src = boundFor(theme, { prefix: "app", helpers: ["color-math"] }).emit().files["theme.ts"];
    expect(src).toContain('import { lighten, darken, alpha } from "./color-math";');
    expect(src).toContain("lighten,");
    expect(src).toContain("darken,");
    expect(src).toContain("alpha,");
  });
});

describe("styled-components adapter — public surface (STAT-1)", () => {
  it("folds every variant shape into a camelCase theme key (alpha, scale-step, hyphen)", () => {
    const theme = buildReactSc();
    // Alpha variants: colors.shadow.a10 → shadowA10.
    expect(theme.theme.colors.shadowA10).toBeTruthy();
    // Border radius variants: borders.radius.sm → radiusSm.
    expect(theme.theme.borders.radiusSm).toBe("4px");
    expect(theme.theme.borders.radiusLg).toBe("12px");
    // A hyphenated variant name camelCases too.
    const t = createTheme(
      { colors: { brand: { base: "#4dabf7", variants: { "on-dark": "#ffffff" } } } },
      { adapter: createStyledComponentsAdapter() },
    ) as any;
    expect(t.theme.colors.brandOnDark).toBe("rgb(255, 255, 255)");
  });

  it("surfaces effects + borders leaves on the object (structured shadow deferred to its 'none' variant)", () => {
    const theme = buildReactSc();
    expect(theme.theme.effects.shadowNone).toBe("none");
    expect(theme.theme.borders.radius).toBe("6px");
    expect(theme.theme.borders.radiusFull).toBe("9999px");
    expect(JSON.stringify(theme.theme)).not.toContain("var(");
  });

  it("recipe const identifiers are prefix-free camelCase — the `prefix` option never leaks into them", () => {
    // buildReactSc builds with prefix "app"; the SC surface is prefix-free (identifiers, not class names).
    const src = boundFor(buildReactSc(), { prefix: "app" }).emit().files["theme.ts"];
    expect(src).toContain("export const colorsSolidPrimary = css`");
    expect(src).not.toContain("appColorsSolidPrimary");
    expect(src).not.toMatch(/\bapp[A-Z]/); // no identifier carries the prefix
  });

  it("override() re-derives the theme object — a new base flows to its derived variants", () => {
    const base = buildReactSc();
    const originalPrimaryDark = base.theme.colors.primaryDark;
    const child = base.override({ colors: { primary: { base: "#e8590c" } } }) as any;
    expect(child.theme.colors.primary).toBe("rgb(232, 89, 12)");
    // primaryDark is a stored derived ref, so it re-derives off the new base (≠ the original).
    expect(child.theme.colors.primaryDark).not.toBe(originalPrimaryDark);
    // The parent theme is untouched.
    expect(base.theme.colors.primary).toBe("rgb(77, 171, 247)");
  });

  it("a responsive recipe entry emits a theme.media block", () => {
    const theme = createTheme(
      {
        breakpoints: { lg: 1024 },
        colors: {
          primary: { base: "#4dabf7", text: "#fff", variants: { dark: "#1c7ed6" } },
          recipes: { solid: { primary: { background: "primary", responsive: [{ breakpoint: "lg", background: "primary.dark" }] } } },
        },
      },
      { adapter: createStyledComponentsAdapter() },
    ) as any;
    const src = boundFor(theme).emit().files["theme.ts"];
    expect(src).toContain("theme.media.lg");
  });

  it("theme.d.ts augments the styled-components DefaultTheme module", () => {
    const dts = boundFor(buildReactSc(), { prefix: "app" }).emit().files["theme.d.ts"];
    expect(dts).toContain('declare module "styled-components"');
    expect(dts).toContain("export interface DefaultTheme extends Readonly<typeof theme>");
  });

  it("media exposes min AND max tagged templates for every declared breakpoint", () => {
    const media = buildReactSc().theme.media as Record<string, { min: { query: string }; max: { query: string } }>;
    expect(media.md.min.query).toBe("@media (min-width: 768px)");
    expect(media.md.max.query).toContain("max-width");
    // Every breakpoint the model declares is present on the wrapped descriptor.
    for (const bp of Object.keys(buildReactSc().model.breakpoints)) {
      expect(media[bp]).toBeTruthy();
    }
  });

  it("a modes-free theme carries no `modes` key and emits no scheme helper", () => {
    const theme = createTheme(
      { colors: { surface: { base: "#fff", text: "#111" }, recipes: { solid: { surface: { background: "surface" } } } } },
      { adapter: createStyledComponentsAdapter({ scheme: "media" }) },
    ) as any;
    const emitted = boundFor(theme, { scheme: "media" }).emit();
    expect(emitted.files["theme.ts"]).not.toContain("modes: {");
    expect(Object.keys(emitted.vendorHelpers)).not.toContain("scheme.ts");
  });

  it("a minimal colours-only theme emits a valid object + recipes and no GlobalStyle", () => {
    const theme = createTheme(
      { colors: { brand: { base: "#4dabf7", text: "#fff" }, recipes: { solid: { brand: { background: "brand", color: "brand.text" } } } } },
      { adapter: createStyledComponentsAdapter() },
    ) as any;
    expect(theme.theme.colors.brand).toBe("rgb(77, 171, 247)");
    expect(theme.GlobalStyle).toBeUndefined();
    const src = boundFor(theme).emit().files["theme.ts"];
    expect(src).toContain("export const theme = {");
    expect(src).toContain("export const colorsSolidBrand = css`");
    expect(src).not.toContain("createGlobalStyle");
  });

  it("the emitted recipes barrel groups the flat consts by subsystem → group → variant", () => {
    const theme = buildReactSc();
    // Runtime barrel mirrors the emitted one.
    expect(theme.recipes.colors.solid.primary).toBeTruthy();
    expect(theme.recipes.components.buttons.primary).toBeTruthy();
    const src = boundFor(theme, { prefix: "app" }).emit().files["theme.ts"];
    expect(src).toContain("export const recipes = {");
    expect(src).toContain("solid: {");
  });

  it("surfaces typography leaves — families, sizes (incl. numeric-prefixed), unit-less weights/line-heights", () => {
    const t = buildReactSc().theme.typography;
    expect(t.fontFamily).toBe("system-ui, -apple-system, sans-serif");
    expect(t.fontSizeXl).toBe("24px");
    expect(t.fontSize2xl).toBe("32px"); // variant "2xl" folds to a valid key
    expect(t.fontWeightBold).toBe(700); // unit-less number stays a number
    expect(t.lineHeightTight).toBe(1.2); // unit-less
  });

  it("keeps unit-less layout leaves numeric and gives lengths their unit", () => {
    const layout = buildReactSc().theme.layout;
    expect(layout.spacingXl).toBe("24px");
    expect(layout.containerInset).toBe(8); // unit-less number, not "8px"
  });

  it("emits a css const for a non-colours recipe (typography)", () => {
    const src = boundFor(buildReactSc(), { prefix: "app" }).emit().files["theme.ts"];
    expect(src).toContain("export const typographyButtonLarge = css`");
    expect(src).toContain("font-size: ${({ theme }) => theme.typography");
  });

  it("language: js still emits the recipe css consts + the barrel (only the .d.ts is dropped)", () => {
    const emitted = boundFor(buildReactSc(), { prefix: "app", language: "js" }).emit();
    const src = emitted.files["theme.js"];
    expect(src).toContain("export const colorsSolidPrimary = css`");
    expect(src).toContain("export const recipes = {");
    expect(src).not.toContain("interface DefaultTheme");
  });

  it("helpers default (none): no color-math import is wired", () => {
    const src = boundFor(buildReactSc(), { prefix: "app" }).emit().files["theme.ts"];
    expect(src).not.toContain('from "./color-math"');
  });
});

describe("styled-components adapter — appearance modes (§10.3)", () => {
  const modeRaw = {
    colors: {
      surface: { base: "#ffffff", text: "#111111", modes: [{ mode: "dark", base: "#0d1117", text: "#e6edf3" }] },
      primary: { base: "#1c7ed6", text: "#fff", modes: [{ mode: "dark", base: "#4dabf7" }] },
      recipes: { solid: { primary: { background: "primary", color: "primary.text" } } },
    },
  };
  const emitWith = (scheme: any) => {
    const theme = createTheme(modeRaw, { adapter: createStyledComponentsAdapter({ scheme }) }) as any;
    return boundFor(theme, { scheme }).emit();
  };

  it("scheme: media (default) — a theme.scheme.dark block + vendored scheme.ts; modes on the object", () => {
    const emitted = emitWith("media");
    expect(Object.keys(emitted.vendorHelpers).sort()).toEqual(["media.ts", "scheme.ts"]);
    const src = emitted.files["theme.ts"];
    expect(src).toContain("modes: {");
    expect(src).toContain('surface: "rgb(13, 17, 23)",');
    expect(src).toContain("${({ theme }) => theme.scheme.dark`");
    expect(src).toContain("background: ${theme.modes.dark.colors.primary};");
    expect(emitted.vendorHelpers["scheme.ts"]).toContain('"@media (prefers-color-scheme: dark)"');
  });

  it("scheme: attribute — a [data-theme] block, no scheme.ts", () => {
    const emitted = emitWith("attribute");
    expect(Object.keys(emitted.vendorHelpers)).toEqual(["media.ts"]);
    const src = emitted.files["theme.ts"];
    expect(src).toContain('[data-theme="dark"] & {');
    expect(src).toContain("background: ${({ theme }) => theme.modes.dark.colors.primary};");
    expect(src).not.toContain("theme.scheme.dark");
  });

  it("scheme: both emits both realizations", () => {
    const src = emitWith("both").files["theme.ts"];
    expect(src).toContain("theme.scheme.dark`");
    expect(src).toContain('[data-theme="dark"] & {');
  });
});
