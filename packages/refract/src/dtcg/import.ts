import type { DTCGDocument, DTCGShadowLayerValue, DTCGTypographyValue, DTCGBorderValue, DTCGTransitionValue, ResolvedDTCGToken } from "./types";
import { REFRACT_DTCG_EXTENSION, REFRACT_DTCG_EXTENSION_VERSION } from "./types";
import type { RefractDTCGExtension } from "./export";
import { parseDTCGDocument } from "./parse";
import { createTheme, RefractError } from "../core";
import type { Theme, ThemeAdapter } from "../core";

type RawThemeInput = Record<string, unknown>;

export type FromDTCGOptions = {
  /**
   * How to map DTCG groups to refract subsystems.
   * Default: auto-detect from $type and group name.
   */
  groupMapping?: Record<string, "colors" | "typography" | "effects" | "borders" | "layout" | "ignore">;

  /**
   * Breakpoints as { name: pixelValue } — DTCG has no breakpoint type,
   * so these must be provided separately or mapped from dimension tokens.
   */
  breakpoints?: Record<string, number>;

  /**
   * DTCG group path to use as breakpoints source (e.g. "breakpoint").
   * Dimension values are parsed to pixels.
   */
  breakpointGroup?: string;
};

/**
 * Convert a DTCG token document into a `createTheme` raw input.
 *
 * Returns a plain object — modify it freely before passing to `createTheme`.
 */
export const fromDTCG = (doc: DTCGDocument, options?: FromDTCGOptions): RawThemeInput => {
  const tokens = parseDTCGDocument(doc);
  const groupMapping = options?.groupMapping ?? {};

  const colors: Record<string, unknown> = {};
  const typography: Record<string, unknown> = {};
  const effects: Record<string, unknown> = {};
  const borders: Record<string, unknown> = {};
  const layout: Record<string, unknown> = {};
  let breakpoints: Record<string, number> = options?.breakpoints ?? {};

  // Group tokens by their top-level path segment
  const grouped = new Map<string, ResolvedDTCGToken[]>();
  for (const token of tokens) {
    const topGroup = token.path[0];
    if (!grouped.has(topGroup)) grouped.set(topGroup, []);
    grouped.get(topGroup)!.push(token);
  }

  // Extract breakpoints if a breakpoint group is specified
  const bpGroup = options?.breakpointGroup;
  if (bpGroup && grouped.has(bpGroup)) {
    breakpoints = {};
    for (const token of grouped.get(bpGroup)!) {
      const name = token.path[token.path.length - 1];
      breakpoints[name] = parseDimension(token.value as string);
    }
    grouped.delete(bpGroup);
  }

  for (const [groupName, groupTokens] of grouped) {
    const mapping = groupMapping[groupName] ?? detectSubsystem(groupName, groupTokens);
    if (mapping === "ignore") continue;

    switch (mapping) {
      case "colors":
        mapColorTokens(groupTokens, groupName, colors);
        break;
      case "typography":
        mapTypographyTokens(groupTokens, groupName, typography);
        break;
      case "effects":
        mapEffectsTokens(groupTokens, groupName, effects);
        break;
      case "borders":
        mapBordersTokens(groupTokens, groupName, borders);
        break;
      case "layout":
        mapLayoutTokens(groupTokens, groupName, layout);
        break;
    }
  }

  const result: RawThemeInput = {};
  if (Object.keys(breakpoints).length) result.breakpoints = breakpoints;
  if (Object.keys(colors).length) result.colors = colors;
  if (Object.keys(typography).length) result.typography = typography;
  if (Object.keys(effects).length) result.effects = effects;
  if (Object.keys(borders).length) result.borders = borders;
  if (Object.keys(layout).length) result.layout = layout;

  return result;
};

// --- Auto-detection ---

const detectSubsystem = (
  groupName: string,
  tokens: ResolvedDTCGToken[],
): "colors" | "typography" | "effects" | "borders" | "layout" | "ignore" => {
  const firstType = tokens[0]?.type;

  // By type
  if (firstType === "color") return "colors";
  if (firstType === "typography") return "typography";
  if (firstType === "shadow") return "effects";
  if (firstType === "border") return "borders"; // §14 — border geometry lives in `borders` now
  if (firstType === "strokeStyle") return "borders";
  if (firstType === "transition") return "effects";

  // By name convention
  const lower = groupName.toLowerCase();
  if (lower.includes("color") || lower.includes("palette")) return "colors";
  if (lower.includes("font") || lower.includes("typo") || lower.includes("text")) return "typography";
  if (lower.includes("spacing") || lower.includes("space") || lower.includes("gutter")) return "layout";
  // Borders keywords take precedence over effects (radius/border/outline moved out of effects).
  if (lower.includes("radius") || lower.includes("border") || lower.includes("outline")) return "borders";
  if (lower.includes("shadow") || lower.includes("blur") || lower.includes("opacity") ||
      lower.includes("z-index") || lower.includes("zindex") || lower.includes("transition") ||
      lower.includes("effect")) return "effects";

  // Dimension tokens: check naming
  if (firstType === "dimension") {
    if (lower.includes("spacing") || lower.includes("gap")) return "layout";
    if (lower.includes("radius") || lower.includes("border")) return "borders";
    if (lower.includes("font") || lower.includes("size")) return "typography";
  }

  return "ignore";
};

// --- External aliases (dec.6 / §12 Phase 2) ---

/** A DTCG value left as `"{group.token}"` after parse — an alias whose target is ABSENT from the
 *  document (`parseDTCGDocument` leaves an unresolvable reference verbatim). */
const UNRESOLVED_ALIAS = /^\{([^}]+)\}$/;

/**
 * Map a genuinely-external DTCG alias (target absent from the doc) to a refract `external` token path
 * — the refract analog of "this references a token another (parent) theme owns." The DTCG `color`
 * group renames to the `colors` subsystem; other groups pass through best-effort. Returns `undefined`
 * for a non-alias / resolved value (which stays a normal literal). A resolvable same-doc alias never
 * reaches here — `parseDTCGDocument` already flattened it to its literal.
 */
const aliasToExternalPath = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const match = value.match(UNRESOLVED_ALIAS);
  if (!match) return undefined;
  const inner = match[1];
  const dot = inner.indexOf(".");
  const group = dot < 0 ? inner : inner.slice(0, dot);
  const rest = dot < 0 ? "" : inner.slice(dot + 1);
  const subsystem = group === "color" ? "colors" : group;
  return rest ? `${subsystem}.${rest}` : subsystem;
};

// --- Color mapping ---

const mapColorTokens = (tokens: ResolvedDTCGToken[], groupName: string, colors: Record<string, unknown>) => {
  // Group by second path segment (e.g. color.brand.primary → "brand")
  const subgroups = new Map<string, ResolvedDTCGToken[]>();
  const topLevel: ResolvedDTCGToken[] = [];

  for (const token of tokens) {
    if (token.path.length <= 2) {
      topLevel.push(token);
    } else {
      const sub = token.path[1];
      if (!subgroups.has(sub)) subgroups.set(sub, []);
      subgroups.get(sub)!.push(token);
    }
  }

  // Top-level color tokens → flat colors with base. A genuinely-external alias (absent target) →
  // a refract `external` passthrough (dec.6) rather than a literal `{ base }` (which would reject `{…}`).
  for (const token of topLevel) {
    const name = token.path[token.path.length - 1];
    if (!colors[name]) {
      const external = aliasToExternalPath(token.value);
      colors[name] = external ? { external } : { base: String(token.value) };
    }
  }

  // Subgroups → colors with variants
  for (const [subName, subTokens] of subgroups) {
    if (subTokens.length === 1) {
      const token = subTokens[0];
      const name = token.path[token.path.length - 1];
      if (name === subName) {
        colors[subName] = { base: String(token.value) };
      } else {
        if (!colors[subName]) colors[subName] = { base: String(subTokens[0].value) };
        (colors[subName] as Record<string, unknown>).variants = {
          [name]: String(token.value),
        };
      }
    } else {
      // Multiple tokens in subgroup → first or "base"/"default"/"500" is base, rest are variants
      const baseToken = subTokens.find(t => {
        const last = t.path[t.path.length - 1];
        return last === "base" || last === "default" || last === "500";
      }) ?? subTokens[0];

      const variants: Record<string, string> = {};
      for (const t of subTokens) {
        if (t === baseToken) continue;
        const variantName = t.path.slice(2).join("-");
        variants[variantName] = String(t.value);
      }

      colors[subName] = {
        base: String(baseToken.value),
        ...(Object.keys(variants).length ? { variants } : {}),
      };
    }
  }
};

// --- Typography mapping ---

const TYPO_PROPERTY_MAP: Record<string, string> = {
  fontfamily: "fontFamily",
  fontsize: "fontSize",
  fontweight: "fontWeight",
  lineheight: "lineHeight",
  letterspacing: "letterSpacing",
  fontstyle: "fontStyle",
  texttransform: "textTransform",
  textdecoration: "textDecoration",
  textalign: "textAlign",
};

const mapTypographyTokens = (tokens: ResolvedDTCGToken[], groupName: string, typography: Record<string, unknown>) => {
  for (const token of tokens) {
    if (token.type === "typography") {
      // Composite typography token → decompose into individual properties
      const value = token.value as DTCGTypographyValue;
      const variantName = token.path.slice(1).join("-") || token.path[token.path.length - 1];

      if (value.fontFamily) {
        addTypographyVariant(typography, "fontFamily",
          Array.isArray(value.fontFamily) ? value.fontFamily.join(", ") : value.fontFamily, variantName);
      }
      if (value.fontSize) {
        addTypographyVariant(typography, "fontSize", parseDimensionOrKeep(value.fontSize), variantName);
      }
      if (value.fontWeight !== undefined) {
        addTypographyVariant(typography, "fontWeight", value.fontWeight, variantName);
      }
      if (value.lineHeight !== undefined) {
        addTypographyVariant(typography, "lineHeight", value.lineHeight, variantName);
      }
      if (value.letterSpacing) {
        addTypographyVariant(typography, "letterSpacing", value.letterSpacing, variantName);
      }
    } else {
      // Individual token (fontFamily, fontSize, fontWeight, dimension)
      const propertyKey = detectTypoProperty(token, groupName);
      if (!propertyKey) continue;
      const variantName = token.path[token.path.length - 1];
      const value = token.type === "fontFamily" && Array.isArray(token.value)
        ? (token.value as string[]).join(", ")
        : token.type === "dimension"
          ? parseDimensionOrKeep(token.value as string)
          : token.value;
      addTypographyVariant(typography, propertyKey, value as string | number, variantName);
    }
  }
};

const addTypographyVariant = (
  typography: Record<string, unknown>,
  property: string,
  value: string | number,
  variantName: string,
) => {
  if (!typography[property]) {
    typography[property] = { base: value, variants: {} };
    return;
  }
  const prop = typography[property] as { base: unknown; variants: Record<string, unknown> };
  if (variantName === "base" || variantName === "default" || variantName === "md") {
    prop.base = value;
  } else {
    prop.variants[variantName] = value;
  }
};

const detectTypoProperty = (token: ResolvedDTCGToken, groupName: string): string | null => {
  // Check token type
  if (token.type === "fontFamily") return "fontFamily";
  if (token.type === "fontWeight") return "fontWeight";

  // Check group or parent path naming
  const fullPath = token.path.join(".").toLowerCase();
  for (const [key, prop] of Object.entries(TYPO_PROPERTY_MAP)) {
    if (fullPath.includes(key)) return prop;
  }

  // Check group name
  const lower = groupName.toLowerCase();
  for (const [key, prop] of Object.entries(TYPO_PROPERTY_MAP)) {
    if (lower.includes(key)) return prop;
  }

  return null;
};

// --- Effects mapping ---

const mapEffectsTokens = (tokens: ResolvedDTCGToken[], groupName: string, effects: Record<string, unknown>) => {
  for (const token of tokens) {
    const variantName = token.path[token.path.length - 1];

    switch (token.type) {
      case "shadow": {
        const shadowStr = formatShadowValue(token.value);
        addEffectsVariant(effects, "shadow", shadowStr, variantName);
        break;
      }
      case "transition": {
        const transition = token.value as DTCGTransitionValue;
        const bezier = transition.timingFunction
          ? `cubic-bezier(${transition.timingFunction.join(", ")})`
          : "ease";
        const transStr = `all ${transition.duration} ${bezier}`;
        addEffectsVariant(effects, "transitions", transStr, variantName);
        break;
      }
      case "dimension": {
        const lower = token.path.join(".").toLowerCase();
        if (lower.includes("blur")) {
          addEffectsVariant(effects, "blur", parseDimensionOrKeep(token.value as string), variantName);
        }
        break;
      }
      case "number": {
        const lower = token.path.join(".").toLowerCase();
        if (lower.includes("opacity")) {
          addEffectsVariant(effects, "opacity", token.value as number, variantName);
        } else if (lower.includes("z-index") || lower.includes("zindex")) {
          addEffectsVariant(effects, "zIndex", token.value as number, variantName);
        }
        break;
      }
    }
  }
};

const addEffectsVariant = (
  effects: Record<string, unknown>,
  property: string,
  value: string | number,
  variantName: string,
) => {
  if (!effects[property]) {
    effects[property] = { base: value, variants: {} };
    return;
  }
  const prop = effects[property] as { base: unknown; variants: Record<string, unknown> };
  if (variantName === "base" || variantName === "default" || variantName === "md") {
    prop.base = value;
  } else {
    prop.variants[variantName] = value;
  }
};

// --- Borders mapping (§14) ---

const mapBordersTokens = (tokens: ResolvedDTCGToken[], groupName: string, borders: Record<string, unknown>) => {
  for (const token of tokens) {
    const variantName = token.path[token.path.length - 1];

    switch (token.type) {
      case "border": {
        // The DTCG `border` composite carries width + style + color; only the geometry maps to
        // borders tokens (§14.4 — color is never a borders token, so it is dropped on import).
        const border = token.value as DTCGBorderValue;
        addBordersVariant(borders, "width", parseDimensionOrKeep(border.width), variantName);
        if (border.style) addBordersVariant(borders, "style", border.style, variantName);
        break;
      }
      case "strokeStyle": {
        addBordersVariant(borders, "style", String(token.value), variantName);
        break;
      }
      case "dimension": {
        const lower = token.path.join(".").toLowerCase();
        if (lower.includes("radius")) {
          addBordersVariant(borders, "radius", parseDimensionOrKeep(token.value as string), variantName);
        } else if (lower.includes("offset")) {
          addBordersVariant(borders, "offset", parseDimensionOrKeep(token.value as string), variantName);
        } else if (lower.includes("width")) {
          addBordersVariant(borders, "width", parseDimensionOrKeep(token.value as string), variantName);
        }
        break;
      }
    }
  }
};

const addBordersVariant = (
  borders: Record<string, unknown>,
  property: string,
  value: string | number,
  variantName: string,
) => {
  if (!borders[property]) {
    borders[property] = { base: value, variants: {} };
    return;
  }
  const prop = borders[property] as { base: unknown; variants: Record<string, unknown> };
  if (variantName === "base" || variantName === "default" || variantName === "md") {
    prop.base = value;
  } else {
    prop.variants[variantName] = value;
  }
};

// --- Layout mapping ---

const mapLayoutTokens = (tokens: ResolvedDTCGToken[], groupName: string, layout: Record<string, unknown>) => {
  for (const token of tokens) {
    if (token.type !== "dimension") continue;
    const variantName = token.path[token.path.length - 1];
    const value = parseDimension(token.value as string);

    if (!layout.spacing) {
      layout.spacing = { base: value, variants: {} };
    }

    const spacing = layout.spacing as { base: number; variants: Record<string, number> };
    if (variantName === "base" || variantName === "default" || variantName === "4") {
      spacing.base = value;
    } else {
      spacing.variants[variantName] = value;
    }
  }
};

// --- Helpers ---

const formatShadowValue = (value: unknown): string => {
  if (Array.isArray(value)) {
    return value.map(layer => formatSingleShadow(layer as DTCGShadowLayerValue)).join(", ");
  }
  return formatSingleShadow(value as DTCGShadowLayerValue);
};

const formatSingleShadow = (layer: DTCGShadowLayerValue): string => {
  const parts: string[] = [];
  if (layer.inset) parts.push("inset");
  parts.push(layer.offsetX, layer.offsetY, layer.blur, layer.spread, layer.color);
  return parts.join(" ");
};

const parseDimension = (value: string | number): number => {
  if (typeof value === "number") return value;
  const num = parseFloat(value);
  if (isNaN(num)) return 0;
  // Convert rem to px (assume 16px base)
  if (value.endsWith("rem")) return Math.round(num * 16);
  return num;
};

const parseDimensionOrKeep = (value: string | number): string | number => {
  if (typeof value === "number") return value;
  const num = parseFloat(value);
  if (isNaN(num)) return value;
  if (value.endsWith("px")) return num;
  return value;
};

// --- refract round-trip (recipes via the com.theme-registry.refract extension) ---

/**
 * Read the refract round-trip payload from a DTCG document's top-level `$extensions`, or `undefined`
 * when it carries none. `parseDTCGDocument` intentionally drops top-level `$extensions`, so this reads
 * `doc.$extensions` directly. Throws on a payload from a newer, unreadable schema version.
 */
export const readRefractExtension = (doc: DTCGDocument): RefractDTCGExtension | undefined => {
  const ext = doc.$extensions?.[REFRACT_DTCG_EXTENSION] as RefractDTCGExtension | undefined;
  if (!ext) return undefined;
  if (ext.version !== REFRACT_DTCG_EXTENSION_VERSION) {
    throw new RefractError(
      "REFRACT_E_DTCG_VERSION",
      `Unsupported refract DTCG extension version ${ext.version} (this build reads version ` +
        `${REFRACT_DTCG_EXTENSION_VERSION}). Upgrade @theme-registry/refract to import this document's recipes.`,
    );
  }
  return ext;
};

/**
 * Lossless `DTCG → refract` round-trip entry: {@link fromDTCG} for the property tokens, plus the
 * recipes / keyframes / containers the document stashed under `com.theme-registry.refract` reinjected
 * through createTheme's overlay. A plain DTCG document (no refract extension) round-trips to a
 * recipe-less theme — identical to `createTheme(fromDTCG(doc), { adapter })`.
 */
export const fromDTCGTheme = (
  doc: DTCGDocument,
  options: FromDTCGOptions & { adapter: ThemeAdapter },
): Theme => {
  const raw = fromDTCG(doc, options);
  const ext = readRefractExtension(doc);
  return createTheme(raw, {
    adapter: options.adapter,
    propertiesOverlay: ext?.properties,
    ruleSetsOverlay: ext?.ruleSets,
    keyframesOverlay: ext?.keyframes,
    containersOverlay: ext?.containers,
  });
};
