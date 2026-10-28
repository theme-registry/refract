import type { DTCGColorObject, DTCGColorSpace } from "./types";
import { convertHexToRGB, convertRgbToHex, isHexColor, oklchToRgb, parseColor, serializeColor } from "../subsystems/colors/utils";
import type { RGBTuple } from "../subsystems/colors/utils";

/** Every colour space the DTCG 2025.10 Color module defines. */
export const DTCG_COLOR_SPACES: ReadonlySet<DTCGColorSpace> = new Set<DTCGColorSpace>([
  "srgb", "srgb-linear", "hsl", "hwb", "lab", "lch", "oklab", "oklch",
  "display-p3", "a98-rgb", "prophoto-rgb", "rec2020", "xyz-d65", "xyz-d50",
]);

/**
 * The spaces refract converts natively. Refract's colour maths works in sRGB, so a colour in any other
 * space (display-p3, lab, rec2020…) is read through its `hex` fallback, or rejected when it has none.
 */
export const NATIVE_COLOR_SPACES: ReadonlySet<DTCGColorSpace> = new Set<DTCGColorSpace>([
  "srgb", "srgb-linear", "hsl", "hwb", "oklab", "oklch",
]);

const linearToSrgb = (c: number): number =>
  c >= 0.0031308 ? 1.055 * Math.pow(c, 1 / 2.4) - 0.055 : 12.92 * c;

/** HSL (h in degrees, s/l 0–100) → sRGB 0–1. */
const hslToSrgb = (h: number, s: number, l: number): [number, number, number] => {
  const S = s / 100;
  const L = l / 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const a = S * Math.min(L, 1 - L);
    return L - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
};

/** HWB (h in degrees, w/b 0–100) → sRGB 0–1. */
const hwbToSrgb = (h: number, w: number, b: number): [number, number, number] => {
  const W = w / 100;
  const B = b / 100;
  if (W + B >= 1) {
    const grey = W / (W + B);
    return [grey, grey, grey];
  }
  return hslToSrgb(h, 100, 50).map(c => c * (1 - W - B) + W) as [number, number, number];
};

/**
 * Convert a DTCG colour object in a {@link NATIVE_COLOR_SPACES native space} to an sRGB `[r, g, b]`
 * (0–255). Returns `undefined` for any other space. A `"none"` component reads as `0`. OKLab/OKLCH
 * colours outside sRGB are gamut-mapped by reducing chroma (the same rule refract's derivations use).
 */
export const colorObjectToRgb = (color: DTCGColorObject): RGBTuple | undefined => {
  const [c0, c1, c2] = color.components.map(c => (c === "none" ? 0 : c));
  const to255 = (rgb: [number, number, number]): RGBTuple =>
    rgb.map(c => Math.min(1, Math.max(0, c)) * 255) as unknown as RGBTuple;
  switch (color.colorSpace) {
    case "srgb":
      return to255([c0, c1, c2]);
    case "srgb-linear":
      return to255([linearToSrgb(c0), linearToSrgb(c1), linearToSrgb(c2)]);
    case "hsl":
      return to255(hslToSrgb(c0, c1, c2));
    case "hwb":
      return to255(hwbToSrgb(c0, c1, c2));
    case "oklch":
      return oklchToRgb({ L: c0 * 100, C: c1, h: c2 });
    case "oklab": {
      let h = (Math.atan2(c2, c1) * 180) / Math.PI;
      if (h < 0) h += 360;
      return oklchToRgb({ L: c0 * 100, C: Math.sqrt(c1 * c1 + c2 * c2), h });
    }
    default:
      return undefined;
  }
};

/** A 2024-draft colour string (`#hex` / `rgb()` / `rgba()`) → a 2025.10 sRGB colour object, or `undefined`
 *  for any other CSS colour syntax (kept as a string; refract's colour input reads those itself). */
export const colorStringToObject = (value: string): DTCGColorObject | undefined => {
  let parsed: { rgb: RGBTuple; a: number };
  try {
    parsed = parseColor(value);
  } catch {
    return undefined;
  }
  const [r, g, b] = parsed.rgb;
  const round = (c: number) => Math.round((c / 255) * 10000) / 10000;
  return {
    colorSpace: "srgb",
    components: [round(r), round(g), round(b)],
    ...(parsed.a < 1 ? { alpha: parsed.a } : {}),
    hex: convertRgbToHex(parsed.rgb),
  };
};

/** The sRGB value refract reads for a colour object: its native conversion, else its `hex` fallback. */
export const colorObjectRgb = (color: DTCGColorObject): RGBTuple | undefined =>
  colorObjectToRgb(color) ?? (typeof color.hex === "string" && isHexColor(color.hex) ? convertHexToRGB(color.hex) : undefined);

/** A colour object as the colour string refract's raw theme takes: `#hex` when opaque, `rgba()` when not. */
export const colorObjectToString = (color: DTCGColorObject, rgb: RGBTuple): string => {
  const a = color.alpha ?? 1;
  if (a < 1) return serializeColor(rgb, a);
  return color.colorSpace === "srgb" && typeof color.hex === "string" && isHexColor(color.hex)
    ? color.hex
    : convertRgbToHex(rgb);
};
