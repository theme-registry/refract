/**
 * dec.5 — property responsive `ref` (READ source, was the swap-only `variant`) + `target` (WRITE
 * destination) COMPOSE. `ref` swaps a destination var to a variant's var; `target` picks which var
 * (omit → the base var). The old model made `variant` + `target` mutually exclusive (a throw); the
 * new one lets them stack (read from `ref`, write into `target`). A plain literal override under a
 * `target` stays byte-identical (covered by the golden fixtures + scale-synthesis).
 */
import { describe, it, expect } from "vitest";
import { createTheme } from "@theme-registry/refract";
import { darken } from "@theme-registry/refract/color-math";
import { createCssAdapter } from "../src";

const build = (raw: Record<string, unknown>) =>
  createTheme(raw as any, { adapter: createCssAdapter({ prefix: "dt" }) }) as any;

// `loud` / `dark` are literal variants of a colour; `ref`/`target` reference them by name.
const theme = (responsive: unknown) =>
  build({
    breakpoints: { lg: 1024 },
    colors: { brand: { base: "#4dabf7", variants: { loud: "#1c7ed6", dark: "#155" }, responsive } },
  });

describe("dec.5 — property responsive ref + target compose", () => {
  it("ref alone swaps the BASE var to the ref variant's var (replaces old `variant`)", () => {
    const css = theme([{ breakpoint: "lg", query: "min", ref: "loud" }]).css as string;
    expect(css).toContain("@media (min-width: 1024px)");
    expect(css).toContain("--dt-colors-brand: var(--dt-colors-brand-loud);");
  });

  it("ref + target COMPOSE: read from ref, write into the target var (old model threw here)", () => {
    const css = theme([{ breakpoint: "lg", query: "min", ref: "loud", target: "dark" }]).css as string;
    expect(css).toContain("--dt-colors-brand-dark: var(--dt-colors-brand-loud);");
    // the base var is NOT rewritten — the swap landed on the target.
    expect(css.includes("--dt-colors-brand: var(--dt-colors-brand-loud);")).toBe(false);
  });

  it("dec.5 — ref + modifiers BAKES a swap-and-transform (a literal, not a var swap)", () => {
    const t = build({
      breakpoints: { lg: 1024 },
      colors: { brand: { base: "#4dabf7", variants: { loud: "#3b5bdb" }, responsive: [{ breakpoint: "lg", query: "min", ref: "loud", modifiers: [{ darken: 10 }] }] } },
    });
    const baked = darken(t.resolveToken("colors.brand.loud"), 10);
    const css = t.css as string;
    expect(css).toContain(`--dt-colors-brand: ${baked};`);
    // it's baked, not swapped — no var reference to the loud variable.
    expect(css.includes("--dt-colors-brand: var(--dt-colors-brand-loud);")).toBe(false);
  });

  it("target + literal override lands on the target var, coerced to rgb()", () => {
    const css = theme([{ breakpoint: "lg", query: "min", target: "dark", base: "#000000" }]).css as string;
    // coercion fix — a colours responsive base now goes through the colour input gate, like every other base.
    expect(css).toContain("--dt-colors-brand-dark: rgb(0, 0, 0);");
  });

  it("a PLAIN responsive base (no target) coerces to rgb() on the base var", () => {
    // pre-existing gap, closed: property base/variants/modes were coerced but a bare responsive base
    // passed through verbatim; it now goes through the same colour input gate (hex → canonical rgb).
    const css = theme([{ breakpoint: "lg", query: "min", base: "#abcdef" }]).css as string;
    expect(css).toContain("@media (min-width: 1024px)");
    expect(css).toContain("--dt-colors-brand: rgb(171, 205, 239);");
  });
});

describe("dec.9 — property responsive `mode` condition", () => {
  const buildMode = (responsive: unknown, modes?: string[]) =>
    build({
      ...(modes ? { modes } : {}),
      breakpoints: { lg: 1024 },
      colors: { brand: { base: "#4dabf7", responsive } },
    });

  it("a dark-mode responsive override emits BOTH a [data-theme] block and an OS-combined block", () => {
    const css = buildMode([{ breakpoint: "lg", query: "min", mode: "dark", base: "#000000" }]).css as string;
    // manual-toggle path — nested under the breakpoint media.
    expect(css).toMatch(/@media \(min-width: 1024px\) \{\s*:root\[data-theme="dark"\] \{/);
    // OS-preference path — the two media conditions combined.
    expect(css).toContain("@media (min-width: 1024px) and (prefers-color-scheme: dark) {");
  });

  it("a custom (declared) mode emits ONLY the [data-theme] block (no OS signal)", () => {
    const css = buildMode([{ breakpoint: "lg", query: "min", mode: "hc", base: "#000000" }], ["dark", "light", "hc"]).css as string;
    expect(css).toContain(':root[data-theme="hc"] {');
    expect(css.includes("prefers-color-scheme: hc")).toBe(false);
  });

  it("an undeclared responsive mode throws (reuses the dec.1 registry)", () => {
    expect(() => buildMode([{ breakpoint: "lg", query: "min", mode: "drak", base: "#000000" }])).toThrow(
      /unknown appearance mode 'drak'/,
    );
  });
});
