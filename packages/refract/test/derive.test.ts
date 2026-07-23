// Step 0e (clean-room): the derivation resolver — resolves a `path -> Ref` token map to concrete
// literals, running value derivations (`{ ref, fn, arg }`) with chaining + cycle safety. Pure unit
// test; no fixtures, no pipeline. Additive infra (not yet wired into `theme.tokens` — that's 0f).
import { describe, it, expect } from "vitest";
import type { Ref } from "../src/core/model";
import {
  buildDerivationRegistry,
  resolveToken,
  resolveTokenMap,
} from "../src/core/derive";

const registry = buildDerivationRegistry([
  { darken: (v, arg) => `${v}-darken${arg}`, lighten: (v, arg) => `${v}-lighten${arg}` },
  { scale: (v, arg: any) => (v as number) * (arg?.ratio ?? 1) ** (arg?.step ?? 0) },
]);

const map: Record<string, Ref> = {
  "colors.primary": { value: "#4dabf7" },
  "colors.primary.dark": { ref: "colors.primary", fn: "darken", arg: 10 },
  "colors.primary.darker": { ref: "colors.primary.dark", fn: "darken", arg: 10 }, // chains off dark
  "colors.accent": { ref: "colors.primary" }, // alias
  "type.fontSize.base": { value: 16 },
  "type.fontSize.lg": { ref: "type.fontSize.base", fn: "scale", arg: { ratio: 1.25, step: 2 } },
};

describe("resolveToken — derivation resolver (Step 0e)", () => {
  it("returns literals directly", () => {
    expect(resolveToken(map, registry, "colors.primary")).toBe("#4dabf7");
    expect(resolveToken(map, registry, "type.fontSize.base")).toBe(16);
  });

  it("runs a derivation off its source", () => {
    expect(resolveToken(map, registry, "colors.primary.dark")).toBe("#4dabf7-darken10");
    expect(resolveToken(map, registry, "type.fontSize.lg")).toBe(25); // 16 * 1.25^2
  });

  it("chains derivations", () => {
    // darker = darken(dark) = darken(darken(primary))
    expect(resolveToken(map, registry, "colors.primary.darker")).toBe("#4dabf7-darken10-darken10");
  });

  it("resolves a plain alias to its target's value", () => {
    expect(resolveToken(map, registry, "colors.accent")).toBe("#4dabf7");
  });

  it("resolveTokenMap resolves every entry", () => {
    const resolved = resolveTokenMap(map, registry);
    expect(resolved["colors.primary.dark"]).toBe("#4dabf7-darken10");
    expect(resolved["type.fontSize.lg"]).toBe(25);
    expect(Object.keys(resolved).length).toBe(Object.keys(map).length);
  });

  it("throws on an unknown path", () => {
    expect(() => resolveToken(map, registry, "nope.missing")).toThrow(/Unknown token path/);
  });

  it("throws on an unknown derivation fn", () => {
    const bad: Record<string, Ref> = { a: { value: 1 }, b: { ref: "a", fn: "nope" } };
    expect(() => resolveToken(bad, registry, "b")).toThrow(/Unknown derivation fn/);
  });

  it("throws on a cycle with the path chain", () => {
    const cyclic: Record<string, Ref> = {
      a: { ref: "b", fn: "darken" },
      b: { ref: "a", fn: "darken" },
    };
    expect(() => resolveToken(cyclic, registry, "a")).toThrow(/Cyclic token reference: a -> b -> a/);
  });

  it("buildDerivationRegistry throws on duplicate fn names", () => {
    expect(() => buildDerivationRegistry([{ darken: (v) => v }, { darken: (v) => v }])).toThrow(
      /Duplicate derivation fn/,
    );
  });
});
