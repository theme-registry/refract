/**
 * `diffThemes` (§5 agent-native) — the blast radius of a candidate edit against a base, exercised with
 * the real CSS adapter so the class axis is populated. Tokens + contrast are adapter-independent; classes
 * need a class-emitting adapter (empty otherwise).
 */
import { describe, it, expect } from "vitest";
import { createTheme, createNoopAdapter } from "@theme-registry/refract";
import { diffThemes } from "@theme-registry/refract/build";
import { createCssAdapter } from "../src";

const build = (raw: unknown) => createTheme(raw as never, { adapter: createCssAdapter() });

const baseRaw = {
  colors: {
    brand: { base: "#4c6ef5", text: "#fff" },
    recipes: { solid: { brand: { background: "brand", color: "brand.text" } } },
  },
};

describe("diffThemes", () => {
  it("reports the re-derived token blast radius of a changed base colour", () => {
    const base = build(baseRaw);
    const candidate = build({ ...baseRaw, colors: { ...baseRaw.colors, brand: { base: "#e8590c", text: "#fff" } } });
    const diff = diffThemes(base, candidate);

    const brand = diff.tokens.find((t) => t.path === "colors.brand");
    expect(brand).toEqual({ path: "colors.brand", before: "rgb(76, 110, 245)", after: "rgb(232, 89, 12)", kind: "changed" });
    // The stored derivation graph means the whole ramp re-derives — that's the point of the diff.
    expect(diff.tokens.some((t) => t.path === "colors.brand.dark" && t.kind === "changed")).toBe(true);
    expect(diff.summary.tokensChanged).toBeGreaterThan(1);
  });

  it("reports an added / removed / changed recipe class", () => {
    const base = build(baseRaw);
    const added = build({
      colors: { ...baseRaw.colors, recipes: { solid: { brand: { background: "brand", color: "brand.text" } }, outline: { brand: { color: "brand" } } } },
    });
    expect(diffThemes(base, added).classes).toContainEqual({ name: "dt-colors-outline-brand", kind: "added" });
    expect(diffThemes(added, base).classes).toContainEqual({ name: "dt-colors-outline-brand", kind: "removed" });

    const changed = build({
      colors: { ...baseRaw.colors, recipes: { solid: { brand: { background: "brand", color: "brand.text", cursor: "pointer" } } } },
    });
    expect(diffThemes(base, changed).classes).toContainEqual({ name: "dt-colors-solid-brand", kind: "changed" });
  });

  it("flags a contrast pairing that crosses its pass threshold", () => {
    // Base: dark text on light surface (passes AA). Candidate: light-grey text (fails).
    const good = build({ colors: { surface: { base: "#ffffff", text: "#111111" }, recipes: { solid: { surface: { background: "surface", color: "surface.text" } } } } });
    const bad = build({ colors: { surface: { base: "#ffffff", text: "#cccccc" }, recipes: { solid: { surface: { background: "surface", color: "surface.text" } } } } });
    const crossed = diffThemes(good, bad).contrast.find((c) => c.label === "colors.surface");
    expect(crossed?.before?.pass).toBe(true);
    expect(crossed?.after?.pass).toBe(false);
    expect(crossed?.crossed).toBe(true);
    expect(diffThemes(good, bad).summary.pairingsCrossed).toBeGreaterThan(0);
  });

  it("leaves the class axis empty when neither theme emits classes (noop adapter)", () => {
    const base = createTheme(baseRaw as never, { adapter: createNoopAdapter() });
    const candidate = createTheme({ ...baseRaw, colors: { ...baseRaw.colors, brand: { base: "#e8590c", text: "#fff" } } } as never, { adapter: createNoopAdapter() });
    const diff = diffThemes(base, candidate);
    expect(diff.classes).toEqual([]);
    // …but tokens + contrast still diff (adapter-independent).
    expect(diff.summary.tokensChanged).toBeGreaterThan(0);
  });

  it("an identical candidate is a no-op diff", () => {
    const base = build(baseRaw);
    const same = build(baseRaw);
    const diff = diffThemes(base, same);
    expect(diff.tokens).toEqual([]);
    expect(diff.classes).toEqual([]);
    expect(diff.contrast).toEqual([]);
  });
});
