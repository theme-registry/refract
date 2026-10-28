import type { DTCGDocument, DTCGTokenType } from "./types";
import { REFRACT_DTCG_EXTENSION, REFRACT_DTCG_EXTENSION_VERSION } from "./types";
import type { RefractDTCGExtension } from "./export";
import { buildDTCGGraph } from "./graph";
import type { DTCGDiagnostic, DTCGGraphToken } from "./graph";
import { createTheme, RefractError } from "../core";
import type { Theme, ThemeAdapter } from "../core";

type RawThemeInput = Record<string, unknown>;

/** The subsystems a DTCG token can be imported into. */
export type DTCGImportSubsystem = "colors" | "typography" | "effects" | "borders" | "layout" | "animation";

export type FromDTCGOptions = {
  /**
   * Send every token under a top-level group to one subsystem, or `"ignore"` it. Overrides the
   * default placement (by `$type`, then path keywords) for that group's tokens.
   */
  groupMapping?: Record<string, DTCGImportSubsystem | "ignore">;

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

/** What an import did with each token, so nothing is dropped, renamed or guessed silently. */
export type DTCGImportReport = {
  /** Tokens in the document. */
  readonly tokens: number;
  /** Tokens that landed in the raw theme. */
  readonly mapped: number;
  /** Token id → where it landed: a refract token path (`colors.panel-main.hover`) or a recipe. */
  readonly placements: Readonly<Record<string, string>>;
  /** Tokens left out, and why. */
  readonly unmapped: readonly { readonly path: string; readonly reason: string }[];
  /** Properties whose base had to be chosen (no `$root` or `base` member): the member it came from. */
  readonly bases: readonly { readonly property: string; readonly from: string }[];
  /** Members renamed to stay unique (`hover` → `hover-2`). Spaces and punctuation in names always become `-`. */
  readonly renamed: readonly { readonly path: string; readonly from: string; readonly to: string }[];
  /** Anything else worth knowing about a token that did land (a part refract has nowhere to keep). */
  readonly notes: readonly { readonly path: string; readonly message: string }[];
  /** The token graph's parse diagnostics. */
  readonly diagnostics: readonly DTCGDiagnostic[];
};

export type DTCGImportResult = { readonly raw: RawThemeInput; readonly report: DTCGImportReport };

// --- naming ---

/** A path segment as an identifier: spaces and other punctuation become `-` (`Slate Blue 4` → `Slate-Blue-4`). */
const sanitize = (segment: string): string =>
  segment.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "_";

const joinName = (segments: readonly string[]): string => segments.map(sanitize).join("-");

const COLOR_GROUP_WORDS = new Set(["color", "colors", "colour", "colours"]);

/**
 * A colour token's refract address: its group path is the property (minus a leading `color` group),
 * its name the variant, `$root` the base. A token with no group left is a property of its own.
 */
const colorAddress = (path: readonly string[]): { property: string; member: string } => {
  const groups = path.slice(0, -1);
  const name = path[path.length - 1];
  const own = groups.length && COLOR_GROUP_WORDS.has(groups[0].toLowerCase()) ? groups.slice(1) : groups;
  return own.length ? { property: joinName(own), member: name } : { property: joinName([name]), member: "$root" };
};

/** Lower-cased path for keyword tests. */
const lowerPath = (path: readonly string[]): string => path.join(".").toLowerCase();

type Placement = { sub: DTCGImportSubsystem; prop: string; strip: readonly (readonly string[])[] };

const place = (sub: DTCGImportSubsystem, prop: string, ...strip: string[][]): Placement => ({ sub, prop, strip });

/** Dimension tokens, placed by the first keyword their path contains. Order matters (`font.size` before `size`). */
const DIMENSION_RULES: readonly [RegExp, Placement][] = [
  [/radi(us|i)|corner/, place("borders", "radius", ["radius"], ["radii"])],
  [/outline-?offset/, place("borders", "offset", ["outline-offset"], ["outlineoffset"])],
  [/border-?width|stroke|outline-?width/, place("borders", "width", ["border-width"], ["borderwidth"], ["stroke"])],
  [/font-?size|font\.size|text-?size/, place("typography", "fontSize", ["font", "size"], ["fontsize"], ["font-size"])],
  [/line-?height/, place("typography", "lineHeight", ["font", "lineheight"], ["font", "line-height"], ["lineheight"], ["line-height"])],
  [/letter-?spacing|tracking/, place("typography", "letterSpacing", ["font", "letterspacing"], ["letterspacing"], ["letter-spacing"])],
  [/blur/, place("effects", "blur", ["blur"])],
  [/gutter/, place("layout", "gutters", ["gutters"], ["gutter"])],
  [/padding|gap|spacing|space|inset|margin/, place("layout", "spacing", ["spacing"], ["space"])],
  [/size|width|height/, place("layout", "sizes", ["sizes"], ["size"])],
];

const NUMBER_RULES: readonly [RegExp, Placement][] = [
  [/opacity/, place("effects", "opacity", ["opacity"])],
  [/z-?index/, place("effects", "zIndex", ["z-index"], ["zindex"])],
  [/line-?height/, place("typography", "lineHeight", ["font", "lineheight"], ["lineheight"], ["line-height"])],
  [/weight/, place("typography", "fontWeight", ["font", "weight"], ["fontweight"], ["font-weight"])],
];

const TYPE_PLACEMENTS: Partial<Record<DTCGTokenType, Placement>> = {
  fontFamily: place("typography", "fontFamily", ["font", "family"], ["fontfamily"], ["font-family"], ["family"]),
  fontWeight: place("typography", "fontWeight", ["font", "weight"], ["fontweight"], ["font-weight"], ["weight"]),
  duration: place("animation", "duration", ["motion", "duration"], ["duration"], ["durations"]),
  cubicBezier: place("animation", "easing", ["motion", "easing"], ["motion", "ease"], ["easing"], ["ease"]),
  strokeStyle: place("borders", "style", ["border-style"], ["stroke-style"], ["style"]),
  shadow: place("effects", "shadow", ["shadow"], ["shadows"], ["box-shadow"]),
  transition: place("effects", "transitions", ["transition"], ["transitions"]),
  border: place("borders", "width", ["border"], ["borders"]),
};

/** When `groupMapping` forces a subsystem, the property a dimension token takes there. */
const FORCED_DIMENSION: Partial<Record<DTCGImportSubsystem, Placement>> = {
  layout: place("layout", "spacing"),
  borders: place("borders", "radius"),
  typography: place("typography", "fontSize"),
  effects: place("effects", "blur"),
};

/** The member name left once a placement's leading words are stripped; `$root` when nothing is left. */
const memberName = (path: readonly string[], placement: Placement): string => {
  const lower = path.map(s => s.toLowerCase());
  for (const prefix of placement.strip) {
    if (prefix.length <= lower.length && prefix.every((p, i) => lower[i] === p)) {
      const rest = path.slice(prefix.length);
      return rest.length ? joinName(rest) : "$root";
    }
  }
  return path[path.length - 1] === "$root" ? "$root" : joinName(path.filter(s => s !== "$root"));
};

// --- value conversion ---

type Dim = { value: number; unit: string };
const isDim = (v: unknown): v is Dim =>
  typeof v === "object" && v !== null && typeof (v as Dim).value === "number" && typeof (v as Dim).unit === "string";

/** A canonical dimension as refract takes it: a px number, or a CSS length string for other units. */
const toLength = (v: unknown): number | string | undefined =>
  isDim(v) ? (v.unit === "px" ? v.value : `${v.value}${v.unit}`) : typeof v === "number" ? v : undefined;

const toMs = (v: unknown): number | undefined =>
  isDim(v) ? (v.unit === "s" ? v.value * 1000 : v.value) : typeof v === "number" ? v : undefined;

const toBezier = (v: unknown): string | undefined =>
  Array.isArray(v) && v.length === 4 ? `cubic-bezier(${v.join(", ")})` : undefined;

const toFontFamily = (v: unknown): string | undefined =>
  Array.isArray(v) ? v.join(", ") : typeof v === "string" ? v : undefined;

const naturalOrder = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });

// --- the importer ---

type Member = { value: unknown; id?: string };
type Bucket = {
  sub: DTCGImportSubsystem;
  prop: string;
  root?: Member;
  variants: Map<string, Member>;
  external?: string;
  /** Effects shadow/transition properties default their base to `"none"` instead of choosing one. */
  noneBase?: boolean;
};

const CURLY_REF = /^\{([^{}]+)\}$/;
const refTarget = (raw: unknown): string | undefined =>
  typeof raw === "string" ? raw.match(CURLY_REF)?.[1] : undefined;

/**
 * Convert a DTCG document into a `createTheme` raw input, with a report of what happened to every
 * token. Reads DTCG 2025.10 and the 2024 draft through the token graph, then places each token on its
 * own (by `$type`, then path keywords):
 *
 *  - **colours** keep their grouping: the group path is the property, the token name the variant,
 *    `$root` the base; imported colours set `tones: false`, so no tones are invented;
 *  - **dimensions** go by keyword (`radius` → `borders.radius`, `padding`/`gap` → `layout.spacing`, …);
 *  - **shadows** become structured layers whose colour is the imported colour they alias;
 *  - **text styles** (`typography` tokens) become typography recipes, one class per style.
 *
 * A property with no `$root` or `base` member takes its `default` member as base, else its first in
 * name order; the report lists it. Values are resolved literals: aliases aren't kept in the raw theme.
 */
export const importDTCG = (doc: DTCGDocument, options?: FromDTCGOptions): DTCGImportResult => {
  const { graph, legacy } = buildDTCGGraph(doc);
  const groupMapping = options?.groupMapping ?? {};
  const bpGroup = options?.breakpointGroup;

  const placements: Record<string, string> = {};
  const unmapped: { path: string; reason: string }[] = [];
  const bases: { property: string; from: string }[] = [];
  const renamed: { path: string; from: string; to: string }[] = [];
  const notes: { path: string; message: string }[] = [];

  const buckets = new Map<string, Bucket>();
  const bucket = (sub: DTCGImportSubsystem, prop: string): Bucket => {
    const key = `${sub}.${prop}`;
    let b = buckets.get(key);
    if (!b) {
      b = { sub, prop, variants: new Map() };
      buckets.set(key, b);
    }
    return b;
  };

  /** Add a member; returns the name it was stored under (renamed when taken). */
  const addMember = (b: Bucket, name: string, value: unknown, id?: string): string => {
    // Placements are provisional until finalize (a `base` member is absorbed into the property).
    if (name === "$root" && !b.root) {
      b.root = { value, id };
      if (id) placements[id] = `${b.sub}.${b.prop}`;
      return "$root";
    }
    let final = name === "$root" ? "base" : name;
    if (b.variants.has(final) || (final === "base" && b.root)) {
      let n = 2;
      while (b.variants.has(`${final}-${n}`)) n++;
      const to = `${final}-${n}`;
      renamed.push({ path: id ?? `${b.sub}.${b.prop}`, from: final, to });
      final = to;
    }
    b.variants.set(final, { value, id });
    if (id) placements[id] = `${b.sub}.${b.prop}.${final}`;
    return final;
  };

  const placementOf = (t: DTCGGraphToken): Placement | string => {
    const mapped = groupMapping[t.path[0]];
    const forced = mapped === "ignore" ? undefined : mapped;
    const p = lowerPath(t.path);
    let rule: Placement | undefined;
    if (t.type === "dimension") rule = DIMENSION_RULES.find(([re]) => re.test(p))?.[1];
    else if (t.type === "number") rule = NUMBER_RULES.find(([re]) => re.test(p))?.[1];
    else rule = TYPE_PLACEMENTS[t.type as DTCGTokenType];

    if (forced && rule?.sub !== forced) {
      const alt = t.type === "dimension" ? FORCED_DIMENSION[forced] : undefined;
      if (alt) return alt;
      return `groupMapping sends "${t.path[0]}" to ${forced}, which has no property for a ${t.type} token`;
    }
    if (rule) return rule;
    if (t.type === "dimension" || t.type === "number") {
      return `no placement for a ${t.type} at this path (radius, padding, gap, size, font size, blur… place one)`;
    }
    if (t.type === "gradient") return "gradients have no refract equivalent";
    return `no refract property for a ${t.type} token`;
  };

  // A breakpoint group in the document replaces the `breakpoints` option, as it always has.
  const hasBpGroup = !!bpGroup && graph.tokens.some(t => t.path[0] === bpGroup);
  const breakpoints: Record<string, number> = hasBpGroup ? {} : { ...(options?.breakpoints ?? {}) };

  const shadows: DTCGGraphToken[] = [];
  const textStyles: DTCGGraphToken[] = [];

  // Pass 1: everything but shadows and text styles, which reference what lands here.
  for (const t of graph.tokens) {
    if (hasBpGroup && t.path[0] === bpGroup) {
      const v = t.value;
      if (isDim(v)) {
        const name = memberName(t.path.slice(1), place("layout", "breakpoints"));
        breakpoints[name === "$root" ? "base" : name] = v.unit === "rem" ? Math.round(v.value * 16) : v.value;
        placements[t.id] = `breakpoints.${name}`;
      } else {
        unmapped.push({ path: t.id, reason: "breakpoint isn't a dimension" });
      }
      continue;
    }
    if (groupMapping[t.path[0]] === "ignore") {
      unmapped.push({ path: t.id, reason: `ignored by groupMapping` });
      continue;
    }
    if (t.type === "unknown") {
      unmapped.push({ path: t.id, reason: "no $type on the token, its groups, or an alias target" });
      continue;
    }

    if (t.type === "color") {
      if (groupMapping[t.path[0]] && groupMapping[t.path[0]] !== "colors") {
        unmapped.push({ path: t.id, reason: `groupMapping sends "${t.path[0]}" to ${groupMapping[t.path[0]]}, which takes no colours` });
        continue;
      }
      const { property, member } = colorAddress(t.path);
      if (t.external) {
        // An alias to another document's token: its own property, borrowed from the parent theme.
        const own = member === "$root" ? property : `${property}-${sanitize(member)}`;
        const target = colorAddress(t.external.split("."));
        const ext = target.member === "$root" ? `colors.${target.property}` : `colors.${target.property}.${sanitize(target.member)}`;
        const b = bucket("colors", own);
        b.external = ext;
        placements[t.id] = `colors.${own}`;
        continue;
      }
      const value = legacy.get(t.id);
      if (typeof value !== "string") {
        unmapped.push({ path: t.id, reason: "colour value can't be read (see diagnostics)" });
        continue;
      }
      addMember(bucket("colors", property), member === "$root" ? "$root" : sanitize(member), value, t.id);
      continue;
    }

    if (t.type === "shadow") { shadows.push(t); continue; }
    if (t.type === "typography") { textStyles.push(t); continue; }
    if (t.external) {
      unmapped.push({ path: t.id, reason: `alias to ${t.external}, which isn't in this document` });
      continue;
    }

    const where = placementOf(t);
    if (typeof where === "string") {
      unmapped.push({ path: t.id, reason: where });
      continue;
    }
    const name = memberName(t.path, where);
    const b = bucket(where.sub, where.prop);

    let value: unknown;
    switch (t.type) {
      case "dimension": value = toLength(t.value); break;
      case "duration": value = toMs(t.value); break;
      case "cubicBezier": value = toBezier(t.value); break;
      case "fontFamily": value = toFontFamily(t.value); break;
      case "fontWeight":
      case "number": value = typeof t.value === "number" ? t.value : undefined; break;
      case "strokeStyle": value = typeof t.value === "string" ? t.value : undefined; break;
      case "transition": {
        const v = t.value as Record<string, unknown> | undefined;
        value = v && [{
          property: "all",
          duration: toMs(v.duration),
          timingFunction: toBezier(v.timingFunction) ?? "ease",
          ...(v.delay !== undefined ? { delay: toMs(v.delay) } : {}),
        }];
        b.noneBase = true;
        break;
      }
      case "border": {
        const v = t.value as Record<string, unknown> | undefined;
        value = v ? toLength(v.width) : undefined;
        if (v && typeof v.style === "string") addMember(bucket("borders", "style"), name, v.style, t.id);
        notes.push({ path: t.id, message: "border colour not imported: a borders token carries no colour" });
        break;
      }
    }
    if (value === undefined) {
      unmapped.push({ path: t.id, reason: `${t.type} value can't be read (see diagnostics)` });
      continue;
    }
    addMember(b, name, value, t.id);
  }

  // Finalize a bucket into a raw property, recording placements and any chosen base.
  const finalized = new Map<string, Record<string, unknown>>();
  const finalize = (b: Bucket): Record<string, unknown> => {
    const key = `${b.sub}.${b.prop}`;
    const prop = `${b.sub}.${b.prop}`;
    if (b.external && !b.root && !b.variants.size) return { external: b.external };

    let base: unknown;
    if (b.root) {
      base = b.root.value;
      if (b.root.id) placements[b.root.id] = prop;
    } else if (b.variants.has("base")) {
      const m = b.variants.get("base")!;
      base = m.value;
      b.variants.delete("base");
      if (m.id) placements[m.id] = prop;
    } else if (b.noneBase) {
      base = "none";
    } else {
      const from = b.variants.has("default") ? "default" : [...b.variants.keys()].sort(naturalOrder)[0];
      base = b.variants.get(from)!.value;
      bases.push({ property: prop, from });
    }

    const variants: Record<string, unknown> = {};
    for (const name of [...b.variants.keys()].sort(naturalOrder)) {
      const m = b.variants.get(name)!;
      variants[name] = m.value;
      if (m.id) placements[m.id] = `${prop}.${name}`;
    }
    const out: Record<string, unknown> = {
      base,
      ...(b.sub === "colors" ? { tones: false } : {}),
      ...(Object.keys(variants).length ? { variants } : {}),
    };
    finalized.set(key, out);
    return out;
  };

  // Colours are final before shadows read their paths.
  for (const b of buckets.values()) if (b.sub === "colors") finalize(b);

  // Pass 2: shadows — structured layers whose colour is the imported colour they alias.
  for (const t of shadows) {
    const where = placementOf(t);
    if (typeof where === "string") { unmapped.push({ path: t.id, reason: where }); continue; }
    const name = memberName(t.path, where);
    const rawLayers = Array.isArray(t.raw) ? t.raw : [t.raw];
    const layers = Array.isArray(t.value) ? t.value : [t.value];
    const legacyLayers = (Array.isArray(legacy.get(t.id)) ? legacy.get(t.id) : [legacy.get(t.id)]) as unknown[];
    const out: Record<string, unknown>[] = [];
    let ok = true;
    layers.forEach((layer, i) => {
      const l = layer as Record<string, unknown> | undefined;
      if (!l) { ok = false; return; }
      const rawColor = (rawLayers[i] as Record<string, unknown> | undefined)?.color;
      const target = refTarget(rawColor);
      let color = target ? placements[target] : undefined;
      if (!color || !color.startsWith("colors.")) {
        // A literal (or unplaced) colour: give it a colour property of its own.
        const literal = (legacyLayers[i] as Record<string, unknown> | undefined)?.color;
        if (typeof literal !== "string") { ok = false; return; }
        const own = `shadow-${name === "$root" ? "base" : name}${layers.length > 1 ? `-${i + 1}` : ""}`;
        const cb = bucket("colors", own);
        if (!cb.root) cb.root = { value: literal };
        finalize(cb);
        color = `colors.${own}`;
      }
      out.push({
        offsetX: toLength(l.offsetX) ?? 0,
        offsetY: toLength(l.offsetY) ?? 0,
        blur: toLength(l.blur) ?? 0,
        spread: toLength(l.spread) ?? 0,
        color,
        ...(l.inset === true ? { inset: true } : {}),
      });
    });
    if (!ok) { unmapped.push({ path: t.id, reason: "shadow value can't be read (see diagnostics)" }); continue; }
    const b = bucket(where.sub, where.prop);
    b.noneBase = true;
    addMember(b, name === "$root" ? "base" : name, out, t.id);
  }

  // Pass 3: text styles — one typography recipe each, its fields pointing at typography variants.
  const recipes: Record<string, Record<string, Record<string, string>>> = {};
  const STYLE_FIELDS: Record<string, (v: unknown) => unknown> = {
    fontFamily: toFontFamily,
    fontSize: toLength,
    fontWeight: v => (typeof v === "number" ? v : undefined),
    lineHeight: v => (typeof v === "number" ? v : toLength(v)),
    letterSpacing: toLength,
  };
  for (const t of textStyles) {
    if (groupMapping[t.path[0]] && groupMapping[t.path[0]] !== "typography") {
      unmapped.push({ path: t.id, reason: `groupMapping sends "${t.path[0]}" to ${groupMapping[t.path[0]]}, which takes no text styles` });
      continue;
    }
    const v = t.value as Record<string, unknown> | undefined;
    if (!v) { unmapped.push({ path: t.id, reason: "typography value can't be read (see diagnostics)" }); continue; }
    const segs = t.path.filter(s => s !== "$root");
    const group = segs.length > 1 ? sanitize(segs[0]) : "text";
    const name = segs.length > 1 ? joinName(segs.slice(1)) : joinName(segs);
    const recipe: Record<string, string> = {};
    for (const [field, convert] of Object.entries(STYLE_FIELDS)) {
      if (v[field] === undefined) continue;
      const target = refTarget((t.raw as Record<string, unknown> | undefined)?.[field]);
      const placed = target ? placements[target] : undefined;
      if (placed && placed.startsWith(`typography.${field}`)) {
        // The style aliases an imported token: reference it rather than copy its value.
        recipe[field] = placed === `typography.${field}` ? "base" : placed.slice(`typography.${field}.`.length);
        continue;
      }
      const value = convert(v[field]);
      if (value === undefined) continue;
      const stored = addMember(bucket("typography", field), name, value, undefined);
      recipe[field] = stored === "$root" ? "base" : stored;
    }
    const block = (recipes[group] ??= {});
    let final = name;
    if (block[final]) {
      let n = 2;
      while (block[`${name}-${n}`]) n++;
      final = `${name}-${n}`;
      renamed.push({ path: t.id, from: name, to: final });
    }
    block[final] = recipe;
    placements[t.id] = `typography.recipes.${group}.${final}`;
  }

  // Assemble the raw theme.
  const raw: RawThemeInput = {};
  if (Object.keys(breakpoints).length) raw.breakpoints = breakpoints;
  const ORDER: DTCGImportSubsystem[] = ["colors", "typography", "effects", "borders", "layout", "animation"];
  for (const sub of ORDER) {
    const props: Record<string, unknown> = {};
    for (const b of [...buckets.values()].filter(x => x.sub === sub).sort((a, c) => naturalOrder(a.prop, c.prop))) {
      props[b.prop] = finalized.get(`${b.sub}.${b.prop}`) ?? finalize(b);
    }
    if (sub === "typography" && Object.keys(recipes).length) props.recipes = recipes;
    if (Object.keys(props).length) raw[sub] = props;
  }

  // A part of a placed composite (a shadow's offset, say) is carried by that composite.
  const usedBy = new Map<string, string>();
  for (const t of graph.tokens) {
    if (!placements[t.id]) continue;
    for (const r of t.references) if (!usedBy.has(r)) usedBy.set(r, t.id);
  }
  const unmappedOut = unmapped.map(u =>
    usedBy.has(u.path) && u.reason.startsWith("no placement")
      ? { path: u.path, reason: `used by ${usedBy.get(u.path)}, which carries its value` }
      : u,
  );

  return {
    raw,
    report: {
      tokens: graph.tokens.length,
      mapped: Object.keys(placements).length,
      placements,
      unmapped: unmappedOut,
      bases,
      renamed,
      notes,
      diagnostics: graph.diagnostics,
    },
  };
};

/**
 * Convert a DTCG token document into a `createTheme` raw input — {@link importDTCG} without the report.
 *
 * Returns a plain object — modify it freely before passing to `createTheme`.
 */
export const fromDTCG = (doc: DTCGDocument, options?: FromDTCGOptions): RawThemeInput =>
  importDTCG(doc, options).raw;

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
