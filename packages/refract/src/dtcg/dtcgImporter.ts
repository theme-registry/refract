import type { DTCGTokenType } from "./types";
import { buildDTCGGraph } from "./graph";
import type { DTCGGraphToken } from "./graph";
import { IMPORTER_CONTRACT_VERSION, withLegacyView } from "./importer";
import type { DTCGImportSubsystem, FromDTCGOptions, ImportContext, Importer, ImportPlacement, ImportSkip } from "./importer";

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

/** The placement rule for a non-colour token, or why it has none. */
const placementOf = (t: DTCGGraphToken, groupMapping: NonNullable<FromDTCGOptions["groupMapping"]>): Placement | string => {
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

const CURLY_REF = /^\{([^{}]+)\}$/;
const refTarget = (raw: unknown): string | undefined =>
  typeof raw === "string" ? raw.match(CURLY_REF)?.[1] : undefined;

const unreadable = (what: string): ImportSkip => ({ skip: `${what} value can't be read (see diagnostics)` });

/** Shadow layers as structured layers whose colour is the imported colour they alias. */
const shadowValue = (t: DTCGGraphToken, where: ImportPlacement & { kind: "token" }, ctx: ImportContext): unknown => {
  const member = where.member;
  const rawLayers = Array.isArray(t.raw) ? t.raw : [t.raw];
  const layers = Array.isArray(t.value) ? t.value : [t.value];
  const css = ctx.cssValue(t.id);
  const cssLayers = (Array.isArray(css) ? css : [css]) as unknown[];
  const out: Record<string, unknown>[] = [];
  for (const [i, layer] of layers.entries()) {
    const l = layer as Record<string, unknown> | undefined;
    if (!l) return unreadable("shadow");
    const target = refTarget((rawLayers[i] as Record<string, unknown> | undefined)?.color);
    let color = target ? ctx.placed(target) : undefined;
    if (!color || !color.startsWith("colors.")) {
      // A literal (or unplaced) colour: give it a colour property of its own.
      const literal = (cssLayers[i] as Record<string, unknown> | undefined)?.color;
      if (typeof literal !== "string") return unreadable("shadow");
      const own = `shadow-${member}${layers.length > 1 ? `-${i + 1}` : ""}`;
      ctx.add("colors", own, "$root", literal);
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
  }
  ctx.baseFallback(where.subsystem, where.property, "none");
  return out;
};

const STYLE_FIELDS: Record<string, (v: unknown) => unknown> = {
  fontFamily: toFontFamily,
  fontSize: toLength,
  fontWeight: v => (typeof v === "number" ? v : undefined),
  lineHeight: v => (typeof v === "number" ? v : toLength(v)),
  letterSpacing: toLength,
};

/** A text style's recipe fields, each pointing at a typography variant (the aliased one, else a new one). */
const textStyleValue = (t: DTCGGraphToken, name: string, ctx: ImportContext): unknown => {
  const v = t.value as Record<string, unknown> | undefined;
  if (!v) return unreadable("typography");
  const recipe: Record<string, string> = {};
  for (const [field, convert] of Object.entries(STYLE_FIELDS)) {
    if (v[field] === undefined) continue;
    const target = refTarget((t.raw as Record<string, unknown> | undefined)?.[field]);
    const placed = target ? ctx.placed(target) : undefined;
    if (placed && placed.startsWith(`typography.${field}`)) {
      // The style aliases an imported token: reference it rather than copy its value.
      recipe[field] = placed === `typography.${field}` ? "base" : placed.slice(`typography.${field}.`.length);
      continue;
    }
    const value = convert(v[field]);
    if (value === undefined) continue;
    const stored = ctx.add("typography", field, name, value);
    recipe[field] = stored === "$root" ? "base" : stored;
  }
  return recipe;
};

/**
 * The default importer. Reads DTCG 2025.10 and the 2024 draft through the token graph, then places
 * each token on its own (by `$type`, then path keywords):
 *
 *  - **colours** keep their grouping: the group path is the property, the token name the variant,
 *    `$root` the base; imported colours set `tones: false`, so no tones are invented;
 *  - **dimensions** go by keyword (`radius` → `borders.radius`, `padding`/`gap` → `layout.spacing`, …);
 *  - **shadows** become structured layers whose colour is the imported colour they alias;
 *  - **text styles** (`typography` tokens) become typography recipes, one class per style.
 *
 * Its options are {@link FromDTCGOptions}: `groupMapping`, `breakpointGroup`, `breakpoints`.
 */
export const dtcgImporter: Importer = {
  name: "dtcg",
  version: IMPORTER_CONTRACT_VERSION,

  parse(doc) {
    const { graph, legacy } = buildDTCGGraph(doc);
    return withLegacyView(graph, legacy);
  },

  place(t, ctx): ImportPlacement | ImportSkip {
    const groupMapping = ctx.options.groupMapping ?? {};
    const mapped = groupMapping[t.path[0]];
    if (ctx.options.breakpointGroup && t.path[0] === ctx.options.breakpointGroup) {
      const name = memberName(t.path.slice(1), place("layout", "breakpoints"));
      return { kind: "breakpoint", name: name === "$root" ? "base" : name };
    }
    if (mapped === "ignore") return { skip: "ignored by groupMapping" };
    if (t.type === "unknown") return { skip: "no $type on the token, its groups, or an alias target" };

    if (t.type === "color") {
      if (mapped && mapped !== "colors") {
        return { skip: `groupMapping sends "${t.path[0]}" to ${mapped}, which takes no colours` };
      }
      const { property, member } = colorAddress(t.path);
      if (t.external) {
        // An alias to another document's token: its own property, borrowed from the parent theme.
        const own = member === "$root" ? property : `${property}-${sanitize(member)}`;
        const target = colorAddress(t.external.split("."));
        const ext = target.member === "$root" ? `colors.${target.property}` : `colors.${target.property}.${sanitize(target.member)}`;
        return { kind: "external", property: own, target: ext };
      }
      return { kind: "token", subsystem: "colors", property, member: member === "$root" ? "$root" : sanitize(member) };
    }

    if (t.type === "typography") {
      if (mapped && mapped !== "typography") {
        return { skip: `groupMapping sends "${t.path[0]}" to ${mapped}, which takes no text styles` };
      }
      const segs = t.path.filter(s => s !== "$root");
      return segs.length > 1
        ? { kind: "recipe", group: sanitize(segs[0]), name: joinName(segs.slice(1)) }
        : { kind: "recipe", group: "text", name: joinName(segs) };
    }

    if (t.external) return { skip: `alias to ${t.external}, which isn't in this document` };
    const where = placementOf(t, groupMapping);
    if (typeof where === "string") return { skip: where };
    const member = memberName(t.path, where);
    // A shadow's own base is a member named `base`, so its literal colour gets a name.
    return { kind: "token", subsystem: where.sub, property: where.prop, member: t.type === "shadow" && member === "$root" ? "base" : member };
  },

  value(t, where, ctx) {
    if (where.kind === "breakpoint") {
      const v = t.value;
      return isDim(v) ? (v.unit === "rem" ? Math.round(v.value * 16) : v.value) : { skip: "breakpoint isn't a dimension" };
    }
    if (where.kind === "recipe") return textStyleValue(t, where.name, ctx);
    if (where.kind !== "token") return undefined;

    switch (t.type) {
      case "color": {
        const v = ctx.cssValue(t.id);
        return typeof v === "string" ? v : unreadable("colour");
      }
      case "shadow": return shadowValue(t, where, ctx);
      case "dimension": return toLength(t.value);
      case "duration": return toMs(t.value);
      case "cubicBezier": return toBezier(t.value);
      case "fontFamily": return toFontFamily(t.value);
      case "fontWeight":
      case "number": return typeof t.value === "number" ? t.value : undefined;
      case "strokeStyle": return typeof t.value === "string" ? t.value : undefined;
      case "transition": {
        const v = t.value as Record<string, unknown> | undefined;
        ctx.baseFallback(where.subsystem, where.property, "none");
        return v && [{
          property: "all",
          duration: toMs(v.duration),
          timingFunction: toBezier(v.timingFunction) ?? "ease",
          ...(v.delay !== undefined ? { delay: toMs(v.delay) } : {}),
        }];
      }
      case "border": {
        const v = t.value as Record<string, unknown> | undefined;
        if (v && typeof v.style === "string") ctx.add("borders", "style", where.member, v.style);
        ctx.note("border colour not imported: a borders token carries no colour");
        return v ? toLength(v.width) : undefined;
      }
    }
    return undefined;
  },

  finalize: result => result,
};
