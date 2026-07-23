/**
 * §22 — the `layout.sizes` scale + sizing recipe verbs. One length scale (unit-aware via §21); the CSS
 * property is chosen at the verb (`maxWidth` → `max-width`), resolving against `layout.sizes` rather than
 * `layout.spacing`. Unknown verbs throw (D5). Container width resolution (D4) is a separate follow-up.
 */
import { describe, it, expect } from "vitest";
import { createTheme } from "@theme-registry/refract";
import { createCssAdapter } from "../src";

const raw = {
  breakpoints: { md: 768 },
  layout: {
    spacing: { base: 8, variants: { md: 12, xl: 24 } },
    sizes: {
      base: 320,
      variants: { sm: 240, md: 480, prose: 640, wide: 1200, full: "100%" },
    },
    recipes: {
      box: {
        card: { paddingX: "xl", maxWidth: "prose" },
        panel: { width: "full", minHeight: "md" },
      },
    },
  },
};

const build = (opts: Record<string, unknown> = {}) =>
  createTheme(raw as never, { adapter: createCssAdapter({ prefix: "app" }), ...opts } as never) as unknown as {
    css: string;
    tokens: Record<string, { value?: unknown; unit?: string; ref?: string }>;
  };

describe("§22 sizes scale — property tokens", () => {
  const { css, tokens } = build();

  it("emits the scale as :root vars (px default, pinned % kept)", () => {
    expect(css).toContain("--app-layout-sizes: 320px;");
    expect(css).toContain("--app-layout-sizes-prose: 640px;");
    expect(css).toContain("--app-layout-sizes-wide: 1200px;");
    expect(css).toContain("--app-layout-sizes-full: 100%;");
  });

  it("is a §21 length token — carries a resolved unit on the flat token map", () => {
    expect(tokens["layout.sizes.prose"]).toEqual({ value: 640, unit: "px" });
    expect(tokens["layout.sizes.full"]).toEqual({ value: 100, unit: "%" });
  });

  it("converts under a rem role; pinned % stays", () => {
    const css = build({ units: { layout: "rem" } }).css;
    expect(css).toContain("--app-layout-sizes-prose: 40rem;"); // 640 ÷ 16
    expect(css).toContain("--app-layout-sizes-full: 100%;");
  });
});

describe("§22 sizing verbs — recipe routing", () => {
  const { css } = build();

  it("each verb routes to its CSS longhand, referencing layout.sizes (not spacing)", () => {
    expect(css).toContain(".app-layout-box-card");
    expect(css).toMatch(/\.app-layout-box-card\s*{[^}]*max-width:\s*var\(--app-layout-sizes-prose\)/);
  });

  it("width + min-height on the panel variant", () => {
    expect(css).toMatch(/\.app-layout-box-panel\s*{[^}]*width:\s*var\(--app-layout-sizes-full\)/);
    expect(css).toMatch(/\.app-layout-box-panel\s*{[^}]*min-height:\s*var\(--app-layout-sizes-md\)/);
  });

  it("spacing verbs still route to layout.spacing (regression)", () => {
    expect(css).toMatch(/\.app-layout-box-card\s*{[^}]*padding-left:\s*var\(--app-layout-spacing-xl\)/);
  });
});

describe("§22 D4 — fluid container max-width resolves against sizes", () => {
  const containerTheme = {
    breakpoints: { md: 768 },
    layout: {
      sizes: { base: 320, variants: { wide: 1200 } },
      container: {
        variants: {
          wide: { base: "fluid", maxWidth: "wide" }, // names a size → unit-aware ref
          capped: { base: "fluid", maxWidth: 800 }, // bare number → px literal escape
        },
      },
    },
  };
  const css = (opts: Record<string, unknown> = {}) =>
    (createTheme(containerTheme as never, {
      adapter: createCssAdapter({ prefix: "app" }),
      ...opts,
    } as never) as unknown as { css: string }).css;

  it("a size-named cap becomes a layout.sizes ref (not a hardcoded px)", () => {
    expect(css()).toMatch(/max-width:\s*var\(--app-layout-sizes-wide\)/);
  });
  it("a bare-number cap stays a px literal (intentional escape)", () => {
    expect(css()).toMatch(/max-width:\s*800px/);
  });
  it("the size-named cap is unit-aware — a rem role converts it (fixes §16.4)", () => {
    expect(css({ units: { layout: "rem" } })).toContain("--app-layout-sizes-wide: 75rem;");
  });
});

describe("§22 D4 — fixed container widths track the media unit (not §21 units)", () => {
  it("breakpoint-derived fixed widths format in the mediaConfig unit (em)", () => {
    const css = (
      createTheme(
        { breakpoints: { sm: 640, md: 768 }, layout: { container: { base: "fixed" } } } as never,
        { adapter: createCssAdapter({ prefix: "app" }), media: { unit: "em", baseFontSize: 16 } } as never,
      ) as unknown as { css: string }
    ).css;
    expect(css).toContain("max-width: 40em;"); // 640 ÷ 16
    expect(css).toContain("max-width: 48em;"); // 768 ÷ 16
    expect(css).not.toContain("max-width: 640px;");
  });
});

describe("§22 D5 — unknown verb throws", () => {
  it("rejects an unknown layout recipe property with a helpful message", () => {
    const bad = {
      breakpoints: { md: 768 },
      layout: { recipes: { box: { card: { pading: "xl" } } } }, // typo
    };
    expect(() =>
      createTheme(bad as never, { adapter: createCssAdapter({ prefix: "app" }) } as never),
    ).toThrow(/Unknown layout recipe property "pading" in layout\.recipes\.box\.card/);
  });
});
