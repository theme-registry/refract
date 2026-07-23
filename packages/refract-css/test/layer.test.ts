/**
 * §W9 — the `layer` option wraps all emitted CSS in a named cascade `@layer`, giving refract's rules
 * deterministic precedence below unlayered app CSS. Off by default (byte-identical), single-file only.
 */
import { describe, it, expect } from "vitest";
import { createTheme, buildMediaDescriptor, mediaQueryString, resolveMediaConfig } from "@theme-registry/refract";
import { createCssAdapter } from "../src";

const RAW = { colors: { brand: "#4c6ef5", recipes: { solid: { b: { background: "brand" } } } } };
const build = (opts: Record<string, unknown>) =>
  createTheme(RAW as any, { adapter: createCssAdapter({ prefix: "app", ...opts }) }) as any;

describe("css @layer output", () => {
  it("emits no @layer by default (byte-identical)", () => {
    expect(build({}).css).not.toContain("@layer");
  });

  it("layer:true wraps everything in @layer refract { … }", () => {
    const css = build({ layer: true }).css as string;
    expect(css.startsWith("@layer refract {\n")).toBe(true);
    expect(css.trimEnd().endsWith("}")).toBe(true);
    // The whole document (vars + recipes) is inside the layer, indented.
    expect(css).toContain("  :root {");
    expect(css).toContain("  .app-colors-solid-b {");
  });

  it("accepts a custom (sub)layer name", () => {
    expect((build({ layer: "refract.recipes" }).css as string).startsWith("@layer refract.recipes {")).toBe(true);
  });

  it("the layered body equals the unlayered output (only the wrapper is added)", () => {
    const plain = build({}).css.trimEnd();
    const layered = build({ layer: true }).css as string;
    const inner = layered
      .replace(/^@layer refract \{\n/, "")
      .replace(/\n\}\n?$/, "")
      .split("\n")
      .map(l => l.replace(/^ {2}/, ""))
      .join("\n");
    expect(inner).toBe(plain);
  });

  it("throws when combined with a multi-file emit mode", () => {
    const adapter = createCssAdapter({ prefix: "app", layer: true });
    const built = createTheme(RAW as any, { adapter }) as any;
    const media = buildMediaDescriptor(built.model.breakpoints, o => mediaQueryString(o, resolveMediaConfig(undefined)));
    const bound = adapter.bind(built.model, { media, resolve: built.resolveToken } as any) as any;
    expect(() => bound.emit({ type: "split" })).toThrow(/layer.*single-file/);
  });
});

describe("css prefers-reduced-motion output", () => {
  it("off by default; reducedMotion appends the reduce block", () => {
    expect(build({}).css).not.toContain("prefers-reduced-motion");
    const css = build({ reducedMotion: true }).css as string;
    expect(css).toContain("@media (prefers-reduced-motion: reduce) {");
    expect(css).toContain("transition-duration: 0.01ms !important;");
  });

  it("sits outside the @layer wrap when both are on", () => {
    const css = build({ layer: true, reducedMotion: true }).css as string;
    expect(css.startsWith("@layer refract {")).toBe(true);
    // the reduce block comes after the closing brace of the layer, not inside it.
    const reduceAt = css.indexOf("@media (prefers-reduced-motion");
    const layerClose = css.indexOf("\n}\n", css.indexOf("@layer refract {"));
    expect(reduceAt).toBeGreaterThan(layerClose);
  });
});
