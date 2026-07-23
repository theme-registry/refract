/**
 * OKLCH colour-synthesis perceptual guarantees (§20.1–20.3, §20.8) — distinct from the EXACT
 * build↔runtime parity in `color-math.test.ts`. These assert the *properties* the perceptual model
 * promises: a hex round-trip survives OKLCH within ±1 quantization; the absolute-L ladder places the
 * same lightness across every hue; `lighten`/`darken` move lightness (not hue); the gamut rule holds
 * L + h and only sheds chroma, so a synthesized value is always a valid in-range `rgb()` (the 0–255
 * channel clamp never has to fire); and the harmony helpers rotate hue while holding lightness.
 */
import { describe, it, expect } from "vitest";
import {
  lighten,
  darken,
  setL,
  rotateHue,
  complement,
  adjust,
  rgbToOklch,
  oklchToRgb,
  convertHexToRGB,
  parseColor,
} from "../src/subsystems/colors/utils";

/** OKLCH lightness (0–100) of a resolved `rgb()`/hex string. */
const L = (value: string): number => rgbToOklch(parseColor(value).rgb).L;
/** OKLCH hue (degrees) of a resolved `rgb()`/hex string. */
const H = (value: string): number => rgbToOklch(parseColor(value).rgb).h;

const HEXES = ["#4dabf7", "#e03131", "#2f9e44", "#f08c00", "#7048e8", "#1971c2", "#f1f3f5", "#343a40"];

describe("hex → OKLCH → hex round-trip (±1 quantize)", () => {
  it("survives the OKLab round-trip within one 8-bit step per channel", () => {
    for (const hex of [...HEXES, "#000000", "#ffffff", "#123456", "#abcdef"]) {
      const [r, g, b] = convertHexToRGB(hex);
      const back = oklchToRgb(rgbToOklch([r, g, b])).map(Math.round);
      expect(Math.abs(back[0] - r)).toBeLessThanOrEqual(1);
      expect(Math.abs(back[1] - g)).toBeLessThanOrEqual(1);
      expect(Math.abs(back[2] - b)).toBeLessThanOrEqual(1);
    }
  });
});

describe("absolute-L ladder — cross-hue consistency", () => {
  it("the same target lightness reads the same across hues (setL is absolute)", () => {
    for (const target of [20, 35, 50, 65, 80]) {
      const ls = HEXES.map(hex => L(setL(hex, target)));
      // every hue lands on the requested lightness (quantization is the only drift)
      for (const got of ls) expect(Math.abs(got - target)).toBeLessThan(1.5);
      // …and therefore consistent with one another
      expect(Math.max(...ls) - Math.min(...ls)).toBeLessThan(1.5);
    }
  });
});

describe("lighten / darken — ΔL verbs that hold hue", () => {
  it("lighten raises OKLCH L, darken lowers it, hue held", () => {
    for (const hex of ["#1971c2", "#e03131", "#2f9e44"]) {
      const base = L(hex);
      expect(L(lighten(hex, 12))).toBeGreaterThan(base);
      expect(L(darken(hex, 12))).toBeLessThan(base);
      // hue barely moves (a couple degrees of quantization slack, gamut permitting)
      expect(Math.abs(H(lighten(hex, 12)) - H(hex))).toBeLessThan(3);
      expect(Math.abs(H(darken(hex, 12)) - H(hex))).toBeLessThan(3);
    }
  });

  it("ΔL 0 is a no-op within quantization", () => {
    for (const hex of HEXES) {
      const [r, g, b] = convertHexToRGB(hex);
      const same = parseColor(lighten(hex, 0)).rgb;
      expect(Math.abs(same[0] - r)).toBeLessThanOrEqual(1);
      expect(Math.abs(same[1] - g)).toBeLessThanOrEqual(1);
      expect(Math.abs(same[2] - b)).toBeLessThanOrEqual(1);
    }
  });
});

describe("gamut rule — hold L + h, reduce C (channel clamp never fires)", () => {
  it("every synthesized value is a valid in-range rgb() across the ladder", () => {
    for (const hex of ["#e03131", "#1971c2", "#2f9e44", "#f08c00", "#7048e8"]) {
      for (const target of [5, 10, 25, 50, 75, 90, 98]) {
        const [r, g, b] = parseColor(setL(hex, target)).rgb;
        for (const c of [r, g, b]) {
          expect(c).toBeGreaterThanOrEqual(0);
          expect(c).toBeLessThanOrEqual(255);
        }
        // lightness is preserved even when chroma had to give way at the gamut boundary
        expect(Math.abs(L(setL(hex, target)) - target)).toBeLessThan(1.5);
      }
    }
  });
});

describe("harmony helpers — rotateHue / complement", () => {
  it("rotateHue turns the hue by the requested angle and holds lightness", () => {
    const hex = "#1971c2";
    for (const deg of [30, 90, 150, 210]) {
      const rotated = rotateHue(hex, deg);
      expect(Math.abs(L(rotated) - L(hex))).toBeLessThan(1.5);
      const dh = (((H(rotated) - H(hex)) % 360) + 360) % 360;
      expect(Math.abs(dh - deg)).toBeLessThan(2);
    }
  });

  it("complement is a 180° rotation at the same lightness", () => {
    const hex = "#1971c2";
    const c = complement(hex);
    expect(Math.abs(L(c) - L(hex))).toBeLessThan(1.5);
    const dh = (((H(c) - H(hex)) % 360) + 360) % 360;
    expect(Math.abs(dh - 180)).toBeLessThan(2);
  });

  it("a full high-chroma tetradic set stays in sRGB gamut, holds L±1, never trips the clamp", () => {
    // §20.11 Issue 3 — saturated bases where the rotated hue may not support the base's chroma.
    for (const base of ["#ff0000", "#0000ff", "#e03131", "#1971c2"]) {
      const baseL = L(base);
      for (const deg of [90, 180, 270]) {
        const out = rotateHue(base, deg);
        const [r, g, b] = parseColor(out).rgb;
        // in gamut: a valid 0–255 rgb (never had to clip a channel to land there)
        for (const c of [r, g, b]) {
          expect(c).toBeGreaterThanOrEqual(0);
          expect(c).toBeLessThanOrEqual(255);
        }
        // lightness held — if the channel clamp had fired it would have shifted L
        expect(Math.abs(L(out) - baseL)).toBeLessThan(1);
      }
    }
  });
});

describe("adjust — one-shot OKLCH placement", () => {
  it("sets absolute L, scales chroma, and rotates hue, each dial independent + omittable", () => {
    const base = "#4dabf7";
    const b = rgbToOklch(parseColor(base).rgb);

    // absolute lightness
    expect(L(adjust(base, { l: 40 }))).toBeCloseTo(40, 0);
    // chroma multiplier: 0 → grey, 0.5 → about half (gamut permitting)
    expect(rgbToOklch(parseColor(adjust(base, { c: 0 })).rgb).C).toBeLessThan(0.01);
    expect(rgbToOklch(parseColor(adjust(base, { c: 0.5 })).rgb).C).toBeLessThan(b.C);
    // signed hue rotation, holding lightness
    const rot = adjust(base, { h: 40 });
    expect(((H(rot) - b.h + 360) % 360)).toBeCloseTo(40, 0);
    expect(Math.abs(L(rot) - b.L)).toBeLessThan(1.5);
    // empty dials = identity (within quantization)
    const same = parseColor(adjust(base, {})).rgb;
    const orig = parseColor(base).rgb;
    for (let i = 0; i < 3; i++) expect(Math.abs(same[i] - orig[i])).toBeLessThanOrEqual(1);
  });
});
