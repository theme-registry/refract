/**
 * W3C Design Tokens Community Group (DTCG) format types.
 *
 * Reads DTCG **2025.10** (the first stable release, 28 October 2025: Format + Color modules) and the
 * older Second Editors' Draft (2024), whose string values (`"#hex"`, `"16px"`, `"200ms"`) are still
 * accepted on import. Both shapes parse into the same canonical token graph (`parseDTCGGraph`).
 */

// --- Primitive token value types ---

/** The colour spaces the DTCG 2025.10 Color module defines. */
export type DTCGColorSpace =
  | "srgb"
  | "srgb-linear"
  | "hsl"
  | "hwb"
  | "lab"
  | "lch"
  | "oklab"
  | "oklch"
  | "display-p3"
  | "a98-rgb"
  | "prophoto-rgb"
  | "rec2020"
  | "xyz-d65"
  | "xyz-d50";

/** A DTCG 2025.10 colour: three components in `colorSpace` (`"none"` = a missing component). */
export type DTCGColorObject = {
  colorSpace: DTCGColorSpace;
  components: [number | "none", number | "none", number | "none"];
  alpha?: number;
  /** Optional 6-digit hex fallback for tools that can't read the colour space. */
  hex?: string;
};

/** A DTCG 2025.10 dimension. The spec allows `px` and `rem` only. */
export type DTCGDimensionObject = { value: number; unit: "px" | "rem" };

/** A DTCG 2025.10 duration. */
export type DTCGDurationObject = { value: number; unit: "ms" | "s" };

export type DTCGColorValue = string | DTCGColorObject;

export type DTCGDimensionValue = string | DTCGDimensionObject; // "16px" (2024) or { value: 16, unit: "px" }

export type DTCGFontFamilyValue = string | string[];

export type DTCGFontWeightValue = number | string; // 400 or "bold"

export type DTCGDurationValue = string | DTCGDurationObject; // "200ms" (2024) or { value: 200, unit: "ms" }

export type DTCGCubicBezierValue = [number, number, number, number];

export type DTCGNumberValue = number;

// --- Composite token value types ---

export type DTCGTypographyValue = {
  fontFamily: string | string[];
  fontSize: string;
  fontWeight: number | string;
  lineHeight: number | string;
  letterSpacing?: string;
};

export type DTCGShadowLayerValue = {
  offsetX: string;
  offsetY: string;
  blur: string;
  spread: string;
  color: string;
  inset?: boolean;
};

export type DTCGShadowValue = DTCGShadowLayerValue | DTCGShadowLayerValue[];

export type DTCGBorderValue = {
  color: string;
  width: string;
  style: string;
};

export type DTCGTransitionValue = {
  duration: string;
  delay?: string;
  timingFunction: DTCGCubicBezierValue;
};

// --- Token types enum ---

export type DTCGTokenType =
  | "color"
  | "dimension"
  | "fontFamily"
  | "fontWeight"
  | "duration"
  | "cubicBezier"
  | "number"
  | "typography"
  | "shadow"
  | "border"
  | "transition"
  | "strokeStyle"
  | "gradient";

// --- Token node ---

export type DTCGToken = {
  $value: unknown;
  $type?: DTCGTokenType;
  $description?: string;
  $extensions?: Record<string, unknown>;
  /** 2025.10: `true`, or a reason string, marks the token deprecated. */
  $deprecated?: boolean | string;
};

export type DTCGGroup = {
  $type?: DTCGTokenType;
  $description?: string;
  $extensions?: Record<string, unknown>;
  $deprecated?: boolean | string;
  /** 2025.10: inherit another group's tokens (`"{path.to.group}"` or a `#/json/pointer`), deep-merged. */
  $extends?: string;
  /** 2025.10: the group's own base token, referenced as `{group.$root}`. */
  $root?: DTCGToken;
  [key: string]: DTCGToken | DTCGGroup | DTCGTokenType | string | boolean | Record<string, unknown> | undefined;
};

export type DTCGDocument = DTCGGroup & {
  $name?: string;
};

// --- Resolved token (after reference resolution) ---

/**
 * The flat, string-valued view `parseDTCGDocument` returns (the shape `fromDTCG` maps from). Values
 * are in the 2024 string form: 2025.10 colour/dimension/duration objects are serialized (`"#24348f"`,
 * `"16px"`), and a `$root` token's path segment reads `"base"`. The full typed form is the token graph.
 */
export type ResolvedDTCGToken = {
  path: string[];
  type: DTCGTokenType;
  value: unknown;
  description?: string;
  extensions?: Record<string, unknown>;
};

// --- refract round-trip extension ---

/**
 * The reverse-DNS `$extensions` key under which `toDTCG(theme, { includeRecipes: true })` stashes the
 * built rule-set / keyframe / container IR so a document round-trips `refract → DTCG → refract` without
 * loss. Standard DTCG tools ignore unknown extensions, so the payload is **refract-specific and not
 * portable** — property tokens are the interoperable surface; recipes ride here.
 */
export const REFRACT_DTCG_EXTENSION = "com.theme-registry.refract";

/** The payload schema version under {@link REFRACT_DTCG_EXTENSION}; bumped on a breaking shape change. */
export const REFRACT_DTCG_EXTENSION_VERSION = 1;
