/**
 * Pure colour math for palette step + variant synthesis.
 *
 * Lightness / hue / chroma work runs in **OKLCH** (a perceptual space) via Björn Ottosson's
 * public-domain matrices — parse → sRGB → linear → OKLab → OKLCH → apply → gamut-map → linear →
 * sRGB → quantize → serialize — so equal lightness steps look even and one lightness reads the same
 * across hues. hex / `rgba()` strings are only touched at the boundary (`parseColor` in,
 * `serializeColor` out). `lighten` / `darken` shift OKLCH lightness by ΔL points; `setL` places an
 * absolute lightness; `rotateHue` / `complement` turn the hue; `alpha` sets opacity. All are
 * string-in / string-out so the same fns run at normalize time (baking the cached value) and later
 * in the derivation registry — AND are vendored to consumers (see `build/vendor.ts`) so a value
 * computed live in the app matches the emitted CSS variable. Kept dependency-free for that vendoring.
 */

/** An `[r, g, b]` channel triple, each `0–255`. */
export type RGBTuple = readonly [number, number, number];

/** An `[r, g, b, a]` quad — channels `0–255`, alpha `0–1`. */
export type RGBATuple = readonly [number, number, number, number];

/** A colour authored/worked as a tuple — opaque `[r,g,b]` or translucent `[r,g,b,a]`. */
export type ColorTuple = RGBTuple | RGBATuple;

const HEX_LENGTHS = new Set([3, 6]);

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const clampChannel = (value: number): number => clamp(value, 0, 255);
const clampAlpha = (value: number): number => clamp(value, 0, 1);
const clampPercent = (percent: number): number => clamp(percent, 0, 100);

/** Round to `dp` decimal places (tidy CSS output — `71.8`, not `71.79999`). */
const roundTo = (value: number, dp: number): number => {
  const f = 10 ** dp;
  return Math.round(value * f) / f;
};

/** Round an alpha to 3 decimals so serialized `rgba()` stays tidy (`0.4`, not `0.4000001`). */
const roundAlpha = (a: number): number => Math.round(clampAlpha(a) * 1000) / 1000;

/** Parse a 3- or 6-digit hex string (with or without `#`) into an `[r, g, b]` tuple. */
export const convertHexToRGB = (hex: string): RGBTuple => {
  const sanitized = hex.replace(/^\s*#|\s*$/g, "");

  if (!HEX_LENGTHS.has(sanitized.length)) {
    // Plain Error on purpose: this module is vendored import-free (build/vendor.ts) so it can be
    // transpiled standalone into consumer bundles — it cannot import RefractError. Its parse errors are
    // re-thrown as REFRACT_E_COLOR_INPUT by colors/normalize.ts, which is the coded authoring surface.
    throw new Error(`Unsupported hex length: "${sanitized}". Use 3 or 6 digits.`);
  }

  const normalized = sanitized.length === 3 ? sanitized.replace(/(.)/g, "$1$1") : sanitized;

  return [
    parseInt(normalized.substring(0, 2), 16),
    parseInt(normalized.substring(2, 4), 16),
    parseInt(normalized.substring(4, 6), 16),
  ] as RGBTuple;
};

/** Serialize an `[r, g, b]` tuple back to a `#rrggbb` string, clamping each channel to `0–255`. */
export const convertRgbToHex = (rgb: RGBTuple): string => {
  if (rgb.length !== 3) {
    throw new Error(`Expected RGB tuple of length 3, received ${rgb.length}`);
  }

  const hex = rgb
    .map(value => {
      const next = clampChannel(Math.round(value)).toString(16);
      return next.length === 1 ? `0${next}` : next;
    })
    .join("");

  return `#${hex}`;
};

const RGB_FN = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i;

/**
 * Parse any canonical colour string this subsystem produces — a 3/6-digit hex **or** an
 * `rgb()` / `rgba()` string — into `{ rgb, a }` (alpha defaults to `1`). This is the boundary
 * gate; a value that isn't parseable rgb (e.g. a bare CSS keyword or `var(--…)`) throws, so
 * callers can surface a friendly "this colour can't be derived from" error.
 */
export const parseColor = (value: string): { rgb: RGBTuple; a: number } => {
  const trimmed = value.trim();

  const fn = RGB_FN.exec(trimmed);
  if (fn) {
    return {
      rgb: [Number(fn[1]), Number(fn[2]), Number(fn[3])] as RGBTuple,
      a: fn[4] === undefined ? 1 : roundAlpha(Number(fn[4])),
    };
  }

  return { rgb: convertHexToRGB(trimmed), a: 1 };
};

/**
 * Serialize `[r, g, b]` (+ optional alpha) to the canonical CSS string — always `rgb(r, g, b)`
 * when fully opaque, else `rgba(r, g, b, a)`. The single serialization point for the subsystem, so
 * the Model (and every adapter + `resolveToken`) always carries one canonical `rgb()/rgba()` form
 * per colour — never hex. (`convertRgbToHex` remains for the vendored consumer helper + input parsing.)
 */
export const serializeColor = (rgb: RGBTuple, a = 1): string => {
  const alpha = roundAlpha(a);
  const [r, g, b] = rgb;
  const R = clampChannel(Math.round(r));
  const G = clampChannel(Math.round(g));
  const B = clampChannel(Math.round(b));
  return alpha >= 1 ? `rgb(${R}, ${G}, ${B})` : `rgba(${R}, ${G}, ${B}, ${alpha})`;
};

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Whether a string is a 3- or 6-digit `#`-prefixed hex colour. */
export const isHexColor = (value: string): boolean => HEX_RE.test(value.trim());


// ─── OKLCH synthesis (Björn Ottosson public-domain matrices) ──────────────────────────────────
// Lightness / hue / chroma adjustments happen here, in a perceptual space, so equal ΔL steps look
// even and one lightness reads consistently across hues. `L` is carried on a 0–100 scale (matching
// the authoring dials); OKLab's native `L` is 0–1. sRGB channels are 0–255 only at the boundary.

/** An OKLCH colour — perceptual lightness `L` (0–100), chroma `C` (≥ 0), hue `h` (degrees, 0–360). */
export type OKLCH = { L: number; C: number; h: number };

const DEG = 180 / Math.PI;
const GAMUT_EPS = 1e-6;
const GAMUT_ITERATIONS = 24;

/** sRGB channel (0–1) → linear-light (0–1). */
const srgbToLinear = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

/** Linear-light channel (0–1) → sRGB (0–1). */
const linearToSrgb = (c: number): number =>
  c >= 0.0031308 ? 1.055 * Math.pow(c, 1 / 2.4) - 0.055 : 12.92 * c;

/** Linear-sRGB `[r, g, b]` (0–1) → OKLab `{ L: 0–1, a, b }`. */
const linearRgbToOklab = (
  lr: number,
  lg: number,
  lb: number,
): { L: number; a: number; b: number } => {
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  };
};

/** OKLab `{ L: 0–1, a, b }` → linear-sRGB `[r, g, b]` (may fall outside 0–1 when out of gamut). */
const oklabToLinearRgb = (L: number, a: number, b: number): [number, number, number] => {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
};

/** Convert an sRGB `[r, g, b]` (0–255) triple to OKLCH (`L` on a 0–100 scale). */
export const rgbToOklch = (rgb: RGBTuple): OKLCH => {
  const [r, g, b] = rgb;
  const lab = linearRgbToOklab(srgbToLinear(r / 255), srgbToLinear(g / 255), srgbToLinear(b / 255));
  const C = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
  let h = Math.atan2(lab.b, lab.a) * DEG;
  if (h < 0) h += 360;
  return { L: lab.L * 100, C, h };
};

/**
 * Convert OKLCH back to an sRGB `[r, g, b]` triple (**unquantized** 0–255 floats). Holds `L` and
 * `h`; when the requested chroma is outside sRGB it binary-searches `C` downward — fixed iterations,
 * no data-dependent early exit, so build- and runtime-computed values agree (§20.8) — until the
 * linear result is in `[0, 1]`. Lightness and hue are never adjusted, so a synthesized ramp keeps
 * its hue and even lightness spacing; only saturation gives way at the gamut boundary. The floats
 * are quantized exactly once, later, by `serializeColor`, so the 0–255 channel clamp never fires.
 */
export const oklchToRgb = (color: OKLCH): RGBTuple => {
  const L = clamp(color.L, 0, 100) / 100;
  const hr = color.h / DEG;
  const cosh = Math.cos(hr);
  const sinh = Math.sin(hr);

  const linearAt = (c: number): [number, number, number] => oklabToLinearRgb(L, c * cosh, c * sinh);
  const inGamut = (lin: [number, number, number]): boolean =>
    lin.every(v => v >= -GAMUT_EPS && v <= 1 + GAMUT_EPS);

  let lin = linearAt(color.C);
  if (!inGamut(lin)) {
    // `C = 0` (a neutral grey at this L) is always in gamut, so `lo` starts from a valid floor.
    let lo = 0;
    let hi = color.C;
    for (let i = 0; i < GAMUT_ITERATIONS; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(linearAt(mid))) lo = mid;
      else hi = mid;
    }
    lin = linearAt(lo);
  }

  return [
    linearToSrgb(clamp(lin[0], 0, 1)) * 255,
    linearToSrgb(clamp(lin[1], 0, 1)) * 255,
    linearToSrgb(clamp(lin[2], 0, 1)) * 255,
  ] as RGBTuple;
};

/** Run a colour string through OKLCH, apply `transform`, and re-serialize (alpha preserved). */
const withOklch = (value: string, transform: (lch: OKLCH) => OKLCH): string => {
  const { rgb, a } = parseColor(value);
  return serializeColor(oklchToRgb(transform(rgbToOklch(rgb))), a);
};

/** Lighten a colour by `delta` OKLCH lightness points (0–100 scale); hue, chroma, alpha preserved. */
export const lighten = (value: string, delta: number): string =>
  withOklch(value, lch => ({ ...lch, L: clamp(lch.L + delta, 0, 100) }));

/** Darken a colour by `delta` OKLCH lightness points (0–100 scale); hue, chroma, alpha preserved. */
export const darken = (value: string, delta: number): string =>
  withOklch(value, lch => ({ ...lch, L: clamp(lch.L - delta, 0, 100) }));

/** Set a colour's absolute OKLCH lightness to `L` (0–100); hue, chroma, alpha preserved. */
export const setL = (value: string, L: number): string =>
  withOklch(value, lch => ({ ...lch, L: clamp(L, 0, 100) }));

/** Rotate a colour's OKLCH hue by `deg` (signed) around the perceptual wheel; L, C, alpha preserved. */
export const rotateHue = (value: string, deg: number): string =>
  withOklch(value, lch => ({ ...lch, h: (((lch.h + deg) % 360) + 360) % 360 }));

/** The perceptual complement — a 180° hue rotation at the same lightness and chroma. */
export const complement = (value: string): string => rotateHue(value, 180);

/**
 * An `adjust` dial set — any subset. `l` = **absolute** OKLCH lightness target (0–100, raw L, the
 * opposite direction from a numeric-`steps` label); `c` = chroma **multiplier** (`1` keep, `0` grey,
 * `>1` more saturated where the gamut allows); `h` = **signed** hue rotation in degrees. Numbers
 * only — keeps the vendored math string-free.
 */
export type AdjustDials = { l?: number; c?: number; h?: number };

/**
 * One-shot OKLCH placement — set an absolute lightness, scale chroma, and/or rotate hue in a single
 * derivation (each dial optional; an omitted dial leaves that component untouched). Alpha preserved.
 */
export const adjust = (value: string, dials: AdjustDials): string =>
  withOklch(value, lch => ({
    L: dials.l === undefined ? lch.L : clamp(dials.l, 0, 100),
    C: dials.c === undefined ? lch.C : Math.max(0, lch.C * dials.c),
    h: dials.h === undefined ? lch.h : (((lch.h + dials.h) % 360) + 360) % 360,
  }));

/**
 * Convert any canonical colour string (the subsystem's `rgb()` / `rgba()` form, or a hex string)
 * to hex — 6-digit `#rrggbb` when opaque, 8-digit `#rrggbbaa` when translucent. Used by the DTCG
 * exporter, whose `color` token type is conventionally hex (every other output stays `rgb()`).
 */
export const toHexColor = (value: string): string => {
  const { rgb, a } = parseColor(value);
  const hex = convertRgbToHex(rgb);
  if (a >= 1) return hex;
  const aa = clampChannel(Math.round(a * 255)).toString(16).padStart(2, "0");
  return `${hex}${aa}`;
};

/**
 * Convert any canonical colour string (the subsystem's `rgb()` / `rgba()` form, or a hex string) to
 * a CSS Color 4 `oklch(L% C H)` string — `oklch(L% C H / a)` when translucent. `L` is a percentage
 * (0–100), `C` the absolute chroma, `H` in degrees, derived from the stored (quantized) rgb. Used by
 * the CSS adapter's `colorFormat: "oklch"` output; the colour is identical to the `rgb()` form.
 */
export const toOklchColor = (value: string): string => {
  const { rgb, a } = parseColor(value);
  const { L, C, h } = rgbToOklch(rgb);
  const body = `${roundTo(L, 2)}% ${roundTo(C, 4)} ${roundTo(h, 2)}`;
  return a >= 1 ? `oklch(${body})` : `oklch(${body} / ${roundAlpha(a)})`;
};

/**
 * Set a colour's opacity to `percent` (0–100) — an **absolute** alpha, not a relative fade
 * (`alpha(x, 40)` ⇒ 40% opaque). The rgb channels are untouched; only the alpha channel is
 * replaced. Result serializes to `rgba(…)` (or hex when `percent` is 100).
 */
export const alpha = (value: string, percent: number): string => {
  const { rgb } = parseColor(value);
  return serializeColor(rgb, clampPercent(percent) / 100);
};
