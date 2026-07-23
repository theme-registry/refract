/**
 * refract → Figma — the PURE transform (no `figma.*`, fully unit-testable). Maps one or more DTCG
 * documents (each a resolved refract theme = one "mode") into a format-neutral {@link VariablePlan}
 * of Figma Variable operations. `code.ts` executes the plan against the Figma plugin API.
 *
 * **Modes are the point.** refract emits ONE resolved theme per DTCG document, so pass the base theme
 * plus each `theme.override(…)` variant (dark, a brand) as named modes — they become the modes of a
 * single Figma variable collection, which is what makes the bridge feel native rather than a flat dump.
 */
import type { DTCGDocument } from "@theme-registry/refract/dtcg";

export type FigmaVariableType = "COLOR" | "FLOAT" | "STRING";
export interface FigmaRGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}
export type FigmaValue = FigmaRGBA | number | string;

export interface PlannedVariable {
  /** Slash-delimited name — `"color/brand/base"`. Slashes nest into folders in Figma's variables UI. */
  name: string;
  type: FigmaVariableType;
  /** `modeName → value`. A variable may be absent from a mode (then it carries no value there). */
  valuesByMode: Record<string, FigmaValue>;
}

export interface VariablePlan {
  collection: string;
  /** Ordered, de-duplicated mode names (the first becomes the collection's default mode). */
  modes: string[];
  variables: PlannedVariable[];
  /** Non-fatal notes — tokens skipped, type conflicts — surfaced in the plugin UI. */
  warnings: string[];
}

export interface ModeInput {
  name: string;
  doc: DTCGDocument;
}

/**
 * DTCG `$type` → Figma variable type. Composite types (shadow / typography / border / transition /
 * gradient) have no Figma-variable equivalent and are skipped with a warning — Figma variables hold
 * only colour / number / string / boolean.
 */
const TYPE_MAP: Record<string, FigmaVariableType | undefined> = {
  color: "COLOR",
  dimension: "FLOAT",
  number: "FLOAT",
  duration: "FLOAT",
  fontWeight: "FLOAT",
  fontFamily: "STRING",
  cubicBezier: "STRING",
  strokeStyle: "STRING",
};

/** `#rgb` / `#rrggbb` / `#rrggbbaa` → Figma `{ r, g, b, a }` (0–1), or `undefined` if not a hex colour. */
export const hexToRgba = (hex: string): FigmaRGBA | undefined => {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if ((h.length !== 6 && h.length !== 8) || !/^[0-9a-f]+$/i.test(h)) return undefined;
  const chan = (i: number): number => parseInt(h.slice(i, i + 2), 16) / 255;
  return { r: chan(0), g: chan(2), b: chan(4), a: h.length === 8 ? chan(6) : 1 };
};

const toNumber = (v: unknown): number | undefined => {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseFloat(v); // strips a trailing unit ("8px" → 8; Figma FLOATs are unitless)
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
};

const convert = (type: FigmaVariableType, value: unknown): FigmaValue | undefined => {
  if (type === "COLOR") return typeof value === "string" ? hexToRgba(value) : undefined;
  if (type === "FLOAT") return toNumber(value);
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.join(", ");
  return undefined;
};

/** Walk a DTCG document, invoking `emit` for each leaf token with its path, resolved `$type`, and value. */
const walkTokens = (
  doc: DTCGDocument,
  emit: (path: string[], type: string | undefined, value: unknown) => void,
): void => {
  const recur = (node: unknown, path: string[], inheritedType: string | undefined): void => {
    if (node === null || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    const type = (typeof obj.$type === "string" ? obj.$type : undefined) ?? inheritedType;
    if ("$value" in obj) {
      emit(path, type, obj.$value);
      return;
    }
    for (const [key, child] of Object.entries(obj)) {
      if (key.startsWith("$")) continue;
      recur(child, [...path, key], type);
    }
  };
  for (const [key, child] of Object.entries(doc as Record<string, unknown>)) {
    if (key.startsWith("$")) continue;
    recur(child, [key], undefined);
  }
};

/**
 * Build the variable plan from named modes. Variables are keyed by their slash-path and carry a value
 * per mode; a token whose DTCG type has no Figma equivalent (or whose value can't be converted, or
 * whose type conflicts across modes) is skipped with a warning rather than failing the whole plan.
 */
export const buildVariablePlan = (collection: string, modes: ModeInput[]): VariablePlan => {
  const warnings: string[] = [];
  const byName = new Map<string, PlannedVariable>();
  const seenModes: string[] = [];

  for (const mode of modes) {
    if (seenModes.includes(mode.name)) {
      warnings.push(`duplicate mode "${mode.name}" skipped`);
      continue;
    }
    seenModes.push(mode.name);
    walkTokens(mode.doc, (path, dtcgType, rawValue) => {
      const name = path.join("/");
      const figmaType = dtcgType ? TYPE_MAP[dtcgType] : undefined;
      if (!figmaType) {
        warnings.push(`skipped ${name}: DTCG type "${dtcgType ?? "unknown"}" has no Figma variable equivalent`);
        return;
      }
      const value = convert(figmaType, rawValue);
      if (value === undefined) {
        warnings.push(`skipped ${name}: could not convert value ${JSON.stringify(rawValue)}`);
        return;
      }
      let variable = byName.get(name);
      if (!variable) {
        variable = { name, type: figmaType, valuesByMode: {} };
        byName.set(name, variable);
      } else if (variable.type !== figmaType) {
        warnings.push(`skipped ${name} in mode "${mode.name}": type ${figmaType} conflicts with ${variable.type}`);
        return;
      }
      variable.valuesByMode[mode.name] = value;
    });
  }

  return {
    collection,
    modes: seenModes,
    variables: [...byName.values()],
    warnings: [...new Set(warnings)],
  };
};
