/**
 * DTCG canonical value → raw-theme value converters, shared by the default importer and the profile
 * reader. A canonical dimension / duration is `{ value, unit }` (see the token graph).
 */

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

