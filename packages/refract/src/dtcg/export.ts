import type { Theme } from "../core";
import type { Literal, ShadowDimension, ShadowLayer, TransitionPart } from "../core";
import type { ThemeModel, RuleSetGroup, Keyframe, ContainerModel, PropertyModel } from "../core";
import type { DTCGDocument, DTCGTokenType } from "./types";
import { REFRACT_DTCG_EXTENSION, REFRACT_DTCG_EXTENSION_VERSION } from "./types";
import { toHexColor } from "../subsystems/colors/utils";

/** The refract round-trip payload stashed under {@link REFRACT_DTCG_EXTENSION}. Built IR, verbatim. */
export type RefractDTCGExtension = {
  version: number;
  /**
   * Per-subsystem property Model verbatim (§12 Phase 2) — the lossless channel for what the portable
   * DTCG token surface can't carry: appearance `modes` (a `PropertyOverride[]` list), `responsive`
   * overrides, derivation metadata (`{ ref, modifiers }`), and `external` passthroughs. Reinjected on
   * import via createTheme's `propertiesOverlay`. The standard resolved-literal tokens still emit
   * alongside for portability; this is refract-only (other tools ignore the extension).
   */
  properties?: Record<string, Record<string, PropertyModel>>;
  ruleSets?: Record<string, Record<string, RuleSetGroup>>;
  keyframes?: Record<string, Record<string, Keyframe>>;
  containers?: Record<string, ContainerModel>;
};

/**
 * Collect a theme's built property / rule-set / keyframe / container IR into the round-trip payload, or
 * `undefined` when the theme has none (so `includeRecipes` on an empty theme still emits no
 * `$extensions`, keeping standard output byte-identical). The Model is "serializable as-is", a plain walk.
 */
const buildRefractExtension = (model: ThemeModel): RefractDTCGExtension | undefined => {
  const properties: Record<string, Record<string, PropertyModel>> = {};
  const ruleSets: Record<string, Record<string, RuleSetGroup>> = {};
  const keyframes: Record<string, Record<string, Keyframe>> = {};
  for (const [sub, subModel] of Object.entries(model.subsystems)) {
    if (subModel.properties && Object.keys(subModel.properties).length) properties[sub] = subModel.properties;
    if (subModel.ruleSets && Object.keys(subModel.ruleSets).length) ruleSets[sub] = subModel.ruleSets;
    if (subModel.keyframes && Object.keys(subModel.keyframes).length) keyframes[sub] = subModel.keyframes;
  }
  const hasProperties = Object.keys(properties).length > 0;
  const hasRuleSets = Object.keys(ruleSets).length > 0;
  const hasKeyframes = Object.keys(keyframes).length > 0;
  const hasContainers = !!model.containers && Object.keys(model.containers).length > 0;
  if (!hasProperties && !hasRuleSets && !hasKeyframes && !hasContainers) return undefined;
  return {
    version: REFRACT_DTCG_EXTENSION_VERSION,
    ...(hasProperties ? { properties } : {}),
    ...(hasRuleSets ? { ruleSets } : {}),
    ...(hasKeyframes ? { keyframes } : {}),
    ...(hasContainers ? { containers: model.containers } : {}),
  };
};

export type ToDTCGOptions = {
  /** Name for the DTCG document. */
  name?: string;

  /** Whether to include breakpoints as dimension tokens. Default: true. */
  includeBreakpoints?: boolean;

  /**
   * Stash the theme's built Model IR — **property tokens (incl. modes / responsive / derivation refs /
   * external), rule-sets, keyframes, containers** — under the reverse-DNS `com.theme-registry.refract`
   * `$extensions` key, so the document round-trips `refract → DTCG → refract` **losslessly** via
   * {@link fromDTCGTheme} (§12 Phase 2 widened this from recipes-only to the whole Model). **Not
   * portable** — other DTCG tools ignore the extension and see the resolved property tokens only.
   * Default `false` (standard output stays byte-identical).
   */
  includeRecipes?: boolean;
};

/**
 * Convert a built theme's tokens into a DTCG-compliant JSON document.
 *
 * **Model-first re-port:** this walks the flat, format-neutral `theme.tokens` map
 * (`"<subsystem>.<property>[.<variant>]" -> Ref`) — the single source of truth that
 * replaced the retired per-subsystem `theme.<sub>.tokens` shape. Each token path is
 * resolved to a concrete literal via `theme.resolveToken` (following aliases and
 * running `lighten` / `darken` derivations), then re-grouped into DTCG groups.
 *
 * DTCG carries **property tokens only** — recipes / composition are out of scope, and
 * layout structural-config knobs (property names containing `--`) are skipped.
 *
 * Returns a plain object — modify it freely before writing to a file.
 */
export const toDTCG = (theme: Theme, options?: ToDTCGOptions): DTCGDocument => {
  const doc: DTCGDocument = {};

  if (options?.name) {
    doc.$name = options.name;
  }

  // Breakpoints — read from the Model, emitted as dimension tokens.
  const breakpoints = theme.model.breakpoints;
  if (options?.includeBreakpoints !== false && breakpoints && Object.keys(breakpoints).length) {
    const bp: Record<string, unknown> = { $type: "dimension" as DTCGTokenType };
    for (const [name, value] of Object.entries(breakpoints)) {
      bp[name] = { $value: `${value}px` };
    }
    doc.breakpoint = bp;
  }

  // Group the flat token map by subsystem → property, resolving each path to a literal.
  const grouped = groupTokens(theme);

  // Resolve a `colors.*` (or any) token path to its literal for embedding in a composed shadow
  // string; falls back to the raw path if unresolvable (defensive).
  const resolveColor = (path: string): string => {
    try {
      return String(theme.resolveToken(path));
    } catch {
      return path;
    }
  };

  // Colors — { $type: color, <name>: { base, text?, <variant> } }
  const colors = grouped.get("colors");
  if (colors) {
    const group: Record<string, unknown> = { $type: "color" as DTCGTokenType };
    for (const [name, prop] of colors) {
      const node: Record<string, unknown> = {};
      if (prop.base !== undefined) {
        node.base = { $value: toHexColor(String(prop.base)) };
      }
      for (const [member, value] of Object.entries(prop.members)) {
        node[member] = { $value: toHexColor(String(value)) };
      }
      group[name] = node;
    }
    doc.color = group;
  }

  // Typography — nested under `doc.typography`, one group per property.
  const typography = grouped.get("typography");
  if (typography) {
    const typo: Record<string, unknown> = {};
    for (const [propName, prop] of typography) {
      const type = getTypographyTokenType(propName);
      const group: Record<string, unknown> = { $type: type };
      if (prop.base !== undefined) {
        group.base = { $value: formatTypoValue(prop.base, prop.baseUnit) };
      }
      for (const [variant, value] of Object.entries(prop.members)) {
        group[variant] = { $value: formatTypoValue(value, prop.memberUnits[variant]) };
      }
      typo[propName] = group;
    }
    doc.typography = typo;
  }

  // Effects — one top-level group per property, named/typed by getEffectsGroupInfo.
  const effects = grouped.get("effects");
  if (effects) {
    for (const [propName, prop] of effects) {
      const { groupName, type } = getEffectsGroupInfo(propName);
      if (!doc[groupName]) {
        doc[groupName] = { $type: type };
      }
      const group = doc[groupName] as Record<string, unknown>;
      // §15: a structured shadow/transition token composes to a CSS string at the DTCG boundary
      // (its `colors.*` color ref resolved to a literal) — consistent with how a string-authored
      // shadow already exports. A fully-structured DTCG composite round-trip is a future enhancement.
      if (prop.base !== undefined) {
        group.base = { $value: formatEffectsValue(propName, prop.base, resolveColor, prop.baseUnit) };
      }
      for (const [variant, value] of Object.entries(prop.members)) {
        group[variant] = { $value: formatEffectsValue(propName, value, resolveColor, prop.memberUnits[variant]) };
      }
    }
  }

  // Borders (§14) — one top-level group per property (radius/width/offset → dimension px,
  // style → strokeStyle). Border geometry moved out of effects; color is never a borders token.
  const borders = grouped.get("borders");
  if (borders) {
    for (const [propName, prop] of borders) {
      const { groupName, type } = getBordersGroupInfo(propName);
      if (!doc[groupName]) {
        doc[groupName] = { $type: type };
      }
      const group = doc[groupName] as Record<string, unknown>;
      if (prop.base !== undefined) {
        group.base = { $value: formatBordersValue(prop.base, prop.baseUnit) };
      }
      for (const [variant, value] of Object.entries(prop.members)) {
        group[variant] = { $value: formatBordersValue(value, prop.memberUnits[variant]) };
      }
    }
  }

  // Layout (spacing / gutters / aspectRatio) — dimension tokens. Structural-config
  // knobs (`columns--*` / `container--*`) are internal, not interchange tokens.
  const layout = grouped.get("layout");
  if (layout) {
    for (const [propName, prop] of layout) {
      if (propName.includes("--")) continue;
      const groupName = propName;
      if (!doc[groupName]) {
        doc[groupName] = { $type: "dimension" as DTCGTokenType };
      }
      const group = doc[groupName] as Record<string, unknown>;
      if (prop.base !== undefined) {
        group.base = { $value: formatDimensionValue(prop.base, prop.baseUnit) };
      }
      for (const [variant, value] of Object.entries(prop.members)) {
        group[variant] = { $value: formatDimensionValue(value, prop.memberUnits[variant]) };
      }
    }
  }

  // §DTCG round-trip — opt-in: stash the built rule-set/keyframe/container IR under the refract
  // extension key. Only touched when `includeRecipes` is set AND the theme actually has recipes, so
  // the standard property-token document stays byte-identical by default.
  if (options?.includeRecipes) {
    const ext = buildRefractExtension(theme.model);
    if (ext) doc.$extensions = { ...(doc.$extensions ?? {}), [REFRACT_DTCG_EXTENSION]: ext };
  }

  return doc;
};

// --- Flat-token grouping ---

type PropTokens = {
  /** the `<sub>.<prop>` base token, if present. */
  base?: Literal;
  /** the `<sub>.<prop>.<member>` variants / extras (e.g. colors' `text`). */
  members: Record<string, Literal>;
  /** §21 resolved length unit for `base` (absent = unit-less / non-length / raw string). */
  baseUnit?: string;
  /** §21 resolved length unit per member. */
  memberUnits: Record<string, string>;
};

/** A resolved dimension → DTCG text: append the §21 unit baked on the Model leaf; a unit-less value
 *  (lineHeight, opacity, aspectRatio) or a raw string passes through untouched. */
const dimText = (value: Literal, unit?: string): string | number =>
  unit !== undefined ? `${value}${unit}` : value;

/**
 * Group the flat `theme.tokens` map into `subsystem -> property -> { base, members }`,
 * resolving each path to a concrete literal via `theme.resolveToken`. Unresolvable
 * paths are skipped (defensive — a well-formed Model resolves everything).
 */
const groupTokens = (theme: Theme): Map<string, Map<string, PropTokens>> => {
  const out = new Map<string, Map<string, PropTokens>>();
  for (const path of Object.keys(theme.tokens)) {
    const dot = path.indexOf(".");
    if (dot < 0) continue;
    const subsystem = path.slice(0, dot);
    const rest = path.slice(dot + 1);
    const dot2 = rest.indexOf(".");
    const property = dot2 < 0 ? rest : rest.slice(0, dot2);
    const member = dot2 < 0 ? undefined : rest.slice(dot2 + 1);

    // §W6b / §12 Phase 2: an EXTERNAL token is a passthrough to a parent-owned var (`var(--…)`); it
    // has no value this document owns. Skip it from the portable token surface — emitting it as a
    // `var(--…)` colour would break re-import (colours reject `var()`). The lossless refract extension
    // carries it verbatim (its `PropertyModel.base` keeps `external`), so the round-trip restores it.
    const ref = theme.tokens[path];
    if (ref?.external !== undefined) continue;
    let value: Literal;
    if (ref?.struct !== undefined) {
      value = ref.struct as unknown as Literal;
    } else {
      try {
        value = theme.resolveToken(path);
      } catch {
        continue;
      }
    }
    const unit = ref?.unit; // §21 resolved length unit (absent for unit-less / raw / struct tokens)

    let subMap = out.get(subsystem);
    if (!subMap) {
      subMap = new Map<string, PropTokens>();
      out.set(subsystem, subMap);
    }
    let prop = subMap.get(property);
    if (!prop) {
      prop = { members: {}, memberUnits: {} };
      subMap.set(property, prop);
    }
    if (member === undefined) {
      prop.base = value;
      if (unit !== undefined) prop.baseUnit = unit;
    } else {
      prop.members[member] = value;
      if (unit !== undefined) prop.memberUnits[member] = unit;
    }
  }
  return out;
};

// --- Value formatting (per subsystem/property) ---

const getTypographyTokenType = (propName: string): DTCGTokenType => {
  switch (propName) {
    case "fontFamily": return "fontFamily";
    case "fontWeight": return "fontWeight";
    case "fontSize":
    case "letterSpacing": return "dimension";
    default: return "number";
  }
};

/** Typography value → DTCG. Length props (fontSize, letterSpacing) carry a resolved unit; the rest
 *  (fontFamily string, fontWeight/lineHeight numbers) are unit-less → pass through. */
const formatTypoValue = (value: Literal, unit?: string): string | number => dimText(value, unit);

const getEffectsGroupInfo = (propName: string): { groupName: string; type: DTCGTokenType } => {
  switch (propName) {
    case "shadow": return { groupName: "shadow", type: "shadow" };
    case "transitions": return { groupName: "transition", type: "transition" };
    case "blur": return { groupName: propName, type: "dimension" };
    case "opacity":
    case "zIndex": return { groupName: propName, type: "number" };
    default: return { groupName: propName, type: "dimension" };
  }
};

/** A resolved shadow geometry field (§21 `{value,unit}`, or a bare number) → CSS text. */
const dtcgShadowDim = (dim: ShadowDimension): string =>
  typeof dim === "number" ? `${dim}px` : `${dim.value}${dim.unit}`;

/** The layer's shared length unit — from the first resolved geometry field; `px` if none resolved. */
const dtcgLayerUnit = (layer: ShadowLayer): string => {
  for (const field of [layer.offsetX, layer.offsetY, layer.blur, layer.spread]) {
    if (field !== undefined && typeof field !== "number") return field.unit;
  }
  return "px";
};

/** Compose a structured shadow value (§15) → a CSS `box-shadow` string with color refs resolved
 * (translucency is carried by the referenced colour — an `alpha` colour variant, §13.3). Geometry
 * fields carry a resolved unit (§21); an absent (required) offset defaults to `0` in the layer's unit. */
const composeDtcgShadow = (layers: ShadowLayer[], resolveColor: (path: string) => string): string =>
  layers
    .map(layer => {
      const zero = `0${dtcgLayerUnit(layer)}`;
      const len = (dim: ShadowDimension | undefined): string => (dim === undefined ? zero : dtcgShadowDim(dim));
      const parts: string[] = [];
      if (layer.inset) parts.push("inset");
      parts.push(len(layer.offsetX), len(layer.offsetY));
      if (layer.spread != null) parts.push(len(layer.blur), len(layer.spread));
      else if (layer.blur != null) parts.push(len(layer.blur));
      if (layer.color) parts.push(resolveColor(layer.color));
      return parts.join(" ");
    })
    .join(", ");

/** Compose a structured transition value (§15) → a CSS `transition` string. */
const composeDtcgTransition = (parts: TransitionPart[]): string =>
  parts
    .map(part => {
      const segs: string[] = [part.property];
      if (part.duration != null || part.delay != null) segs.push(`${part.duration ?? 0}ms`);
      if (part.timingFunction) segs.push(part.timingFunction);
      if (part.delay != null) segs.push(`${part.delay}ms`);
      return segs.join(" ");
    })
    .join(", ");

const formatEffectsValue = (
  propName: string,
  value: Literal,
  resolveColor: (path: string) => string,
  unit?: string,
): string | number => {
  // §15: shadow/transitions arrive as a structured array (cast to `Literal` in groupTokens).
  if (Array.isArray(value)) {
    return propName === "transitions"
      ? composeDtcgTransition(value as TransitionPart[])
      : composeDtcgShadow(value as ShadowLayer[], resolveColor);
  }
  // `blur` carries a resolved length unit (§21); `opacity`/`zIndex` are unit-less → pass through.
  return dimText(value, unit);
};

const getBordersGroupInfo = (propName: string): { groupName: string; type: DTCGTokenType } => {
  switch (propName) {
    case "radius": return { groupName: "radius", type: "dimension" };
    case "width": return { groupName: "borderWidth", type: "dimension" };
    case "offset": return { groupName: "outlineOffset", type: "dimension" };
    case "style": return { groupName: "borderStyle", type: "strokeStyle" };
    default: return { groupName: propName, type: "dimension" };
  }
};

/** Borders geometry: radius/width/offset carry a resolved length unit (§21); `style` is a raw
 *  strokeStyle string (no unit → passes through). */
const formatBordersValue = (value: Literal, unit?: string): string | number => dimText(value, unit);

/** Layout dimension: spacing/gutters/sizes carry a resolved unit (§21); aspectRatio is unit-less. */
const formatDimensionValue = (value: Literal, unit?: string): string | number => dimText(value, unit);
