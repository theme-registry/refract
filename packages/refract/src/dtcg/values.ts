/**
 * DTCG canonical value → raw-theme value converters, shared by the default importer and the profile
 * reader. A canonical dimension / duration is `{ value, unit }` (see the token graph).
 */
import { colorObjectRgb, colorObjectToString } from "./color";

export type Dim = { value: number; unit: string };
export const isDim = (v: unknown): v is Dim =>
  typeof v === "object" && v !== null && typeof (v as Dim).value === "number" && typeof (v as Dim).unit === "string";

/** A canonical dimension as refract takes it: a px number, or a CSS length string for other units. */
export const toLength = (v: unknown): number | string | undefined =>
  isDim(v) ? (v.unit === "px" ? v.value : `${v.value}${v.unit}`) : typeof v === "number" ? v : undefined;

export const toMs = (v: unknown): number | undefined =>
  isDim(v) ? (v.unit === "s" ? v.value * 1000 : v.value) : typeof v === "number" ? v : undefined;

export const toBezier = (v: unknown): string | undefined =>
  Array.isArray(v) && v.length === 4 ? `cubic-bezier(${v.join(", ")})` : undefined;

export const toFontFamily = (v: unknown): string | undefined =>
  Array.isArray(v) ? v.join(", ") : typeof v === "string" ? v : undefined;


/**
 * A DTCG 2025.10 `$value` → CSS text, for display (the preview specimen): a colour object → its CSS
 * colour, `{ value, unit }` → `16px`, a bezier → `cubic-bezier(…)`, a shadow / transition → its CSS
 * shorthand. A string or number passes through.
 */
export const dtcgValueToCss = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 4 && value.every(n => typeof n === "number")) return `cubic-bezier(${value.join(", ")})`;
    return value.map(dtcgValueToCss).join(", ");
  }
  const v = value as Record<string, unknown>;
  if (typeof v.colorSpace === "string") {
    const rgb = colorObjectRgb(v as never);
    return rgb ? colorObjectToString(v as never, rgb) : String(v.hex ?? "");
  }
  if (isDim(v)) return `${v.value}${v.unit}`;
  if ("offsetX" in v || "offsetY" in v) {
    return [v.inset ? "inset" : "", ...["offsetX", "offsetY", "blur", "spread"].map(k => dtcgValueToCss(v[k])), dtcgValueToCss(v.color)]
      .filter(Boolean)
      .join(" ");
  }
  if ("duration" in v) return [dtcgValueToCss(v.duration), dtcgValueToCss(v.timingFunction), dtcgValueToCss(v.delay)].filter(Boolean).join(" ");
  return JSON.stringify(v);
};
