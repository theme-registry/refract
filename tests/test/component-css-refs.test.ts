/**
 * Token refs inside a component `css` delta (literal-first).
 *
 * A component's own `css` delta is literal-first: a bare string / number is a raw CSS literal, and a
 * token **reference** uses the `ref("…")` helper (or the JSON-safe `{ ref: "…" }` object) → lowered to
 * `var(--…)` by the adapter against the global token union. Unknown refs fail loud in core
 * (`validateComponentCssRefs`) before any adapter runs; a bare literal is never validated.
 */
import { describe, expect, it } from "vitest";
import { createTheme, ref } from "@theme-registry/refract";
import { createCssAdapter } from "@theme-registry/refract-css";
import { createScssAdapter } from "@theme-registry/refract-scss";
import { createStyledComponentsAdapter } from "@theme-registry/refract-styled-components";
import { createJsonAdapter } from "@theme-registry/refract-json";
import { buildMediaDescriptor, mediaQueryString, resolveMediaConfig } from "@theme-registry/refract";

const RAW = {
  breakpoints: { md: 768 },
  colors: {
    recipes: { solid: { primary: { color: "primary" } } },
    primary: { base: "#4dabf7", text: "#ffffff" },
  },
  components: {
    recipes: {
      buttons: {
        primary: {
          colors: "solid.primary",
          // literal-first: `color` is a token ref via ref(); `cursor` is a bare-string literal.
          css: { color: ref("colors.primary.text"), cursor: "pointer" },
        },
      },
    },
  },
} as const;

describe("token refs inside a component css delta", () => {
  it("lowers a ref() css value to a var(--…) ref, and keeps a bare string literal", () => {
    const theme = createTheme(RAW, {
      adapter: createCssAdapter({ prefix: "app" }),
    }) as unknown as { css: string };
    const css = theme.css;

    // The ref `colors.primary.text` resolves to that token's CSS variable.
    expect(css).toMatch(/color:\s*var\(--app-[\w-]*text\)/);
    // The bare string is emitted verbatim — a literal, never a var.
    expect(css).toMatch(/cursor:\s*pointer/);
    expect(css).not.toMatch(/cursor:\s*var\(/);
  });

  it("lowers the same ref through every adapter with no adapter-specific change", () => {
    // SCSS → `$…` variable; SC → `var(--…)`; JSON → the format-neutral `{ ref, value }` leaf.
    const scss = createTheme(RAW, {
      adapter: createScssAdapter({ prefix: "app" }),
    }) as unknown as { scss: string };
    expect(scss.scss).toContain("color: $app-colors-primary-text;");
    expect(scss.scss).toContain("cursor: pointer;");

    // SC → a theme read (`${({theme})=>…}`), no var(); the bare string stays a literal.
    const scAdapter = createStyledComponentsAdapter({ prefix: "app" });
    const sc = createTheme(RAW, { adapter: scAdapter }) as any;
    const plainMedia = buildMediaDescriptor(sc.model.breakpoints, o => mediaQueryString(o, resolveMediaConfig(undefined)));
    const scSrc = scAdapter
      .bind(sc.model, { media: plainMedia, containers: {}, resolve: sc.resolveToken } as any)
      .emit().files["theme.ts"];
    expect(scSrc).toContain("color: ${({ theme }) => theme.colors.primaryText};");
    expect(scSrc).toContain("cursor: pointer;");
    expect(scSrc).not.toContain("var(");

    const json = createTheme(RAW, {
      adapter: createJsonAdapter(),
    }) as unknown as { json: { ruleSets: Record<string, { declarations: Record<string, unknown> }> } };
    const decls = json.json.ruleSets["components.buttons.primary"].declarations;
    expect(decls.color).toEqual({ ref: "colors.primary.text", value: "rgb(255, 255, 255)" });
    expect(decls.cursor).toEqual({ value: "pointer" });
  });

  it("treats a bare string as a literal (the footgun is gone), and still fails loud on an unknown ref", () => {
    // A bare string `display: "flex"` is a literal now — it just works, no token lookup, no throw.
    const ok = createTheme(
      {
        ...RAW,
        components: { recipes: { buttons: { primary: { colors: "solid.primary", css: { display: "flex" } } } } },
      } as unknown as typeof RAW,
      { adapter: createCssAdapter({ prefix: "app" }) },
    ) as unknown as { css: string };
    expect(ok.css).toMatch(/display:\s*flex/);

    // An explicit ref() at a missing token still fails loud, pointing at the token path.
    const bad = {
      ...RAW,
      components: { recipes: { buttons: { primary: { colors: "solid.primary", css: { color: ref("colors.nope") } } } } },
    };
    expect(() =>
      createTheme(bad as unknown as typeof RAW, { adapter: createCssAdapter({ prefix: "app" }) }),
    ).toThrow(/components\.buttons\.primary: css 'color' references unknown token 'colors\.nope'/);
  });
});
