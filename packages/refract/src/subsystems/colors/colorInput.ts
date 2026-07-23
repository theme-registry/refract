/**
 * Build-time colour **input** parsing.
 *
 * Kept out of `utils.ts` on purpose: `utils.ts` is vendored to consumers (see `build/vendor.ts`) and
 * must stay import-free, but input parsing needs the CSS-keyword table. `coerceColorInput` normalizes
 * any authored colour — hex, `[r, g, b]`, `oklch()`, `hsl()/hsla()`, `rgb()/rgba()`, or a CSS named
 * keyword — to the subsystem's canonical `rgb()` / `rgba()` form (derivation still runs in OKLCH). A
 * `var(--…)` (and `currentColor` / `transparent`) is rejected — none can be tonally derived at build.
 */
import { convertHexToRGB, oklchToRgb, parseColor, serializeColor, type RGBTuple } from "./utils";
import { CSS_COLOR_KEYWORDS } from "./keywords";
import { RefractError } from "../../core/errors";

const roundAlpha = (a: number): number => Math.round(Math.min(1, Math.max(0, a)) * 1000) / 1000;

/** Convert HSL (`h` in degrees, `s` and `l` on `0–1`) to an sRGB `[r, g, b]` triple (0–255). */
const hslToRgb = (h: number, s: number, l: number): RGBTuple => {
  const hue = (((h % 360) + 360) % 360) / 60;
  const c = (1 - Math.abs(2 * Math.min(1, Math.max(0, l)) - 1)) * Math.min(1, Math.max(0, s));
  const x = c * (1 - Math.abs((hue % 2) - 1));
  const m = Math.min(1, Math.max(0, l)) - c / 2;
  const [r, g, b] =
    hue < 1 ? [c, x, 0] :
    hue < 2 ? [x, c, 0] :
    hue < 3 ? [0, c, x] :
    hue < 4 ? [0, x, c] :
    hue < 5 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255] as RGBTuple;
};

const OKLCH_STR = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/\s*([\d.]+)(%?)\s*)?\)$/i;
const HSL_STR = /^hsla?\(\s*([\d.]+)(?:deg)?\s*[, ]\s*([\d.]+)%\s*[, ]\s*([\d.]+)%\s*(?:[,/]\s*([\d.]+)(%?)\s*)?\)$/i;

/**
 * Parse an authored colour string into `{ rgb, a }`, or `null` if it isn't a colour this subsystem can
 * derive from. Tries `oklch()`, `hsl()/hsla()`, and CSS keywords, then falls back to {@link parseColor}
 * for hex / `rgb()/rgba()`. `oklch`/`hsl`/`rgba` alpha is preserved.
 */
const parseColorInput = (raw: string): { rgb: RGBTuple; a: number } | null => {
  const value = raw.trim();

  const ok = OKLCH_STR.exec(value);
  if (ok) {
    const L = ok[2] === "%" ? Number(ok[1]) : Number(ok[1]) * 100;
    const a = ok[5] === undefined ? 1 : roundAlpha(ok[6] === "%" ? Number(ok[5]) / 100 : Number(ok[5]));
    return { rgb: oklchToRgb({ L, C: Number(ok[3]), h: Number(ok[4]) }), a };
  }

  const hs = HSL_STR.exec(value);
  if (hs) {
    const a = hs[4] === undefined ? 1 : roundAlpha(hs[5] === "%" ? Number(hs[4]) / 100 : Number(hs[4]));
    return { rgb: hslToRgb(Number(hs[1]), Number(hs[2]) / 100, Number(hs[3]) / 100), a };
  }

  const keyword = CSS_COLOR_KEYWORDS[value.toLowerCase()];
  if (keyword) return { rgb: convertHexToRGB(keyword), a: 1 };

  // hex / rgb() / rgba() — parseColor throws on anything else, so a non-colour returns null.
  try {
    return parseColor(value);
  } catch {
    return null;
  }
};

/**
 * Coerce an authored colour value to the canonical `rgb(r, g, b)` / `rgba(…)` string. A colour may be a
 * hex string (`"#4dabf7"` / `"#4af"`), an `[r, g, b]` tuple (0–255), or any CSS colour — `oklch()`,
 * `hsl()/hsla()`, `rgb()/rgba()`, or a named keyword (`"rebeccapurple"`). Only a `var(--…)` (and
 * `currentColor` / `transparent`) is rejected. Applies to base + `text` + literal variants/modes.
 */
export const coerceColorInput = (value: string | RGBTuple): string => {
  if (typeof value === "string") {
    const parsed = parseColorInput(value);
    if (!parsed) {
      throw new RefractError(
        "REFRACT_E_COLOR_INPUT",
        `Invalid colour "${value}". Author a colour as a hex string ("#4dabf7"), an [r, g, b] tuple, ` +
          `or a CSS colour — oklch(), hsl()/hsla(), rgb()/rgba(), or a named keyword (e.g. "rebeccapurple"). ` +
          `A var(--…) can't be tonally derived at build time.`,
      );
    }
    return serializeColor(parsed.rgb, parsed.a);
  }

  if (!Array.isArray(value) || value.length !== 3 || value.some(n => typeof n !== "number")) {
    throw new RefractError(
      "REFRACT_E_COLOR_TUPLE",
      `Invalid colour tuple ${JSON.stringify(value)}. Use an [r, g, b] tuple with 0–255 channels (alpha comes from an \`alpha\` variant, not the base).`,
    );
  }

  const [r, g, b] = value;
  return serializeColor([r, g, b] as RGBTuple);
};
