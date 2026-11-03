/**
 * Refract DTCG profile reader — token layer.
 *
 * Reads a DTCG 2025.10 token file written to the Refract profile (see `schema/dtcg-profile/v1.json` and
 * the producer guide) into a raw theme. Placement needs no rules: top-level groups are subsystems, a
 * property group's `$root` is its base and every other token a variant, so a DTCG path IS the refract
 * token path. Refract-only data lives under the `com.theme-registry.refract.profile` `$extensions` key
 * on the document, a property group or a token.
 *
 * This stage reads tokens, aliases, generator settings, generated tokens (the rule wins; drift is
 * reported), derivations, responsive values, externals, extension-only values, breakpoints, containers
 * and `extends`. Recipes, globals, keyframes and the layout structure are the next stage; a file that
 * uses them is rejected rather than half-read. Values are converted through the token graph, so a
 * malformed DTCG value is a diagnostic, never a guess.
 */
import type { DTCGDocument, DTCGTokenType } from "./types";
import { buildDTCGGraph } from "./graph";
import type { DTCGGraphToken } from "./graph";
import { toBezier, toFontFamily, toLength, toMs } from "./values";
import { createTheme, createNoopAdapter, RefractError } from "../core";
import type { RawTheme } from "../core";
import { toHexColor } from "../subsystems/colors/utils";

/** The `$extensions` key Refract profile data lives under. */
export const PROFILE_EXTENSION = "com.theme-registry.refract.profile";
/** The profile version this reader reads. */
export const PROFILE_VERSION = 1;

const SUBSYSTEMS = ["colors", "typography", "layout", "effects", "borders", "animation"] as const;
type Subsystem = (typeof SUBSYSTEMS)[number];
const LAYOUT_PROPERTIES = new Set(["spacing", "gutters", "sizes", "aspectRatio"]);
/** Document-level keys this stage doesn't read yet. */
const NOT_YET = ["recipes", "globals", "keyframes", "layout"] as const;

export type ProfileDiagnostic = {
  readonly severity: "error" | "warning";
  /** `generated-value-drift` · `generated-not-produced` · a token-graph code (`invalid-value`, …). */
  readonly code: string;
  readonly path: string;
  readonly message: string;
};

export type ProfileReport = {
  /** Tokens read from the file (generated ones included). */
  readonly tokens: number;
  /** Tokens marked `generated`: regenerated from their group's settings rather than read. */
  readonly generated: readonly string[];
  /** Values that live only in the extension (no DTCG type), so other DTCG tools don't see them. */
  readonly extensionOnly: readonly string[];
  readonly diagnostics: readonly ProfileDiagnostic[];
};

export type ProfileReadResult = { readonly raw: RawTheme; readonly report: ProfileReport };

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const ext = (node: unknown): Json | undefined => {
  const e = isObject(node) ? node.$extensions : undefined;
  const own = isObject(e) ? e[PROFILE_EXTENSION] : undefined;
  return isObject(own) ? own : undefined;
};

const CURLY = /^\{([^{}]+)\}$/;
/** A DTCG id (`colors.brand.$root`) → its refract token path (`colors.brand`). */
const refractPath = (id: string): string => id.split(".").filter(s => s !== "$root").join(".");
/** A `{…}` alias string → the refract path it names, else undefined. */
const aliasPath = (v: unknown): string | undefined => {
  const m = typeof v === "string" ? v.match(CURLY) : null;
  return m ? refractPath(m[1]) : undefined;
};

const fail = (message: string): never => {
  throw new RefractError("REFRACT_E_PROFILE", message);
};

type Reader = {
  legacy: ReadonlyMap<string, unknown>;
  /** Every property group's DTCG path (`colors.brand`), to catch a `$value` alias that names a group. */
  groups: ReadonlySet<string>;
  report: { tokens: number; generated: string[]; extensionOnly: string[]; diagnostics: ProfileDiagnostic[] };
  /** Generated tokens and the value the file wrote, for the drift check. */
  generated: Array<{ path: string; value: unknown }>;
};

/** A DTCG canonical value of `type` → the raw-theme value. `id` gives colours their CSS string. */
const convert = (type: DTCGTokenType | "unknown", value: unknown, raw: unknown, where: string, cssColor?: unknown): unknown => {
  switch (type) {
    case "color":
      if (typeof cssColor === "string") return cssColor;
      return fail(`${where}: colour value can't be read`);
    case "dimension": return toLength(value) ?? fail(`${where}: dimension value can't be read`);
    case "duration": return toMs(value) ?? fail(`${where}: duration value can't be read`);
    case "cubicBezier": return toBezier(value) ?? fail(`${where}: cubicBezier value can't be read`);
    case "fontFamily": return toFontFamily(value) ?? fail(`${where}: fontFamily value can't be read`);
    case "fontWeight":
    case "number":
      return typeof value === "number" ? value : fail(`${where}: ${type} value can't be read`);
    case "strokeStyle":
      return typeof value === "string" ? value : fail(`${where}: strokeStyle value can't be read`);
    case "shadow": {
      const layers = Array.isArray(value) ? value : [value];
      const rawLayers = Array.isArray(raw) ? raw : [raw];
      return layers.map((layer, i) => {
        const l = layer as Json;
        const color = aliasPath((rawLayers[i] as Json | undefined)?.color);
        if (!color || !color.startsWith("colors.")) {
          return fail(`${where}: a shadow layer's colour must be an alias into colors (e.g. "{colors.shadow.a10}")`);
        }
        return {
          offsetX: toLength(l.offsetX) ?? 0,
          offsetY: toLength(l.offsetY) ?? 0,
          blur: toLength(l.blur) ?? 0,
          spread: toLength(l.spread) ?? 0,
          color,
          ...(l.inset === true ? { inset: true } : {}),
        };
      });
    }
    case "transition": {
      const parts = Array.isArray(value) ? value : [value];
      return parts.map(part => {
        const p = part as Json;
        return {
          property: "all",
          duration: toMs(p.duration),
          timingFunction: toBezier(p.timingFunction) ?? "ease",
          ...(p.delay !== undefined ? { delay: toMs(p.delay) } : {}),
        };
      });
    }
    default:
      return fail(`${where}: ${type} tokens have no refract property`);
  }
};

/**
 * A `$value` alias must name a token. DTCG resolves `{colors.brand.$root}` but not `{colors.brand}` (a
 * group), so other tools couldn't follow the shorthand; reject it rather than read it.
 */
const checkValueAlias = (v: unknown, where: string, r: Reader): void => {
  const m = typeof v === "string" ? v.match(CURLY) : null;
  if (m && r.groups.has(m[1])) {
    fail(`${where}: "{${m[1]}}" names a group; write "{${m[1]}.$root}" so other DTCG tools can resolve it`);
  }
};

/** A graph token → its raw value: an alias stays `{ ref }`, a literal is converted. */
const tokenValue = (t: DTCGGraphToken, r: Reader): unknown => {
  checkValueAlias(t.raw, t.id, r);
  if (Array.isArray(t.raw) || isObject(t.raw)) {
    for (const layer of Array.isArray(t.raw) ? t.raw : [t.raw]) {
      if (isObject(layer)) for (const [field, v] of Object.entries(layer)) checkValueAlias(v, `${t.id}.${field}`, r);
    }
  }
  if (t.alias !== undefined && aliasPath(t.raw) !== undefined) return { ref: refractPath(t.alias) };
  return convert(t.type, t.value, t.raw, t.id, r.legacy.get(t.id));
};

/**
 * A value written inside the extension (a responsive `$value`, a variant extra) → its raw value. It
 * isn't a graph token, so it's parsed through a one-token document of the owner's type.
 */
const extensionValue = (type: DTCGTokenType | "unknown", v: unknown, where: string): unknown => {
  const alias = aliasPath(v);
  if (alias !== undefined) return { ref: alias };
  const { graph, legacy } = buildDTCGGraph({ x: { $type: type, $value: v } } as unknown as DTCGDocument);
  const t = graph.byId.get("x");
  const problem = graph.diagnostics.find(d => d.severity === "error");
  if (!t || problem) return fail(`${where}: ${problem?.message ?? "value can't be read"}`);
  return convert(t.type, t.value, t.raw, where, legacy.get("x"));
};

const readResponsive = (
  entries: unknown,
  type: DTCGTokenType | "unknown",
  member: string | undefined,
  where: string,
): Json[] => {
  if (!Array.isArray(entries)) return fail(`${where}: responsive must be an array`);
  return entries.map((e, i) => {
    const entry = e as Json;
    const out: Json = { breakpoint: entry.breakpoint };
    if (entry.query !== undefined) out.query = entry.query;
    if (entry.orientation !== undefined) out.orientation = entry.orientation;
    if (member !== undefined) out.target = member;
    if (entry.variant !== undefined) {
      if (member !== undefined) fail(`${where}.responsive[${i}]: "variant" switches the base, so it only goes on $root`);
      out.ref = entry.variant;
    } else {
      out.base = extensionValue(type, entry.$value, `${where}.responsive[${i}]`);
    }
    return out;
  });
};

/** Group-level generator settings → the raw property's settings. */
const groupSettings = (sub: Subsystem, property: string, settings: Json, where: string): Json => {
  const out: Json = {};
  if (settings.tones === false) out.tones = false;
  else if (isObject(settings.tones)) Object.assign(out, settings.tones);
  if (settings.steps !== undefined) out.steps = settings.steps;
  if (settings.harmony !== undefined) out.harmony = settings.harmony;
  if (isObject(settings.scale)) {
    const ok = (sub === "typography" && property === "fontSize") || (sub === "layout" && property !== "aspectRatio");
    if (!ok) fail(`${where}: a scale only applies to typography.fontSize and layout spacing / gutters / sizes`);
    Object.assign(out, settings.scale);
  }
  if ((settings.tones !== undefined || settings.steps !== undefined || settings.harmony !== undefined) && sub !== "colors") {
    fail(`${where}: tones, steps and harmony only apply to colours`);
  }
  return out;
};

const readProperty = (sub: Subsystem, property: string, group: Json, graphOf: (id: string) => DTCGGraphToken | undefined, r: Reader): unknown => {
  const where = `${sub}.${property}`;
  const settings = ext(group) ?? {};
  const out: Json = groupSettings(sub, property, settings, where);
  const variants: Json = {};
  const responsive: Json[] = [];

  const members = Object.keys(group).filter(k => !k.startsWith("$") || k === "$root");
  for (const name of members) {
    const id = `${sub}.${property}.${name}`;
    const t = graphOf(id);
    if (!t) fail(`${id}: not a token (groups don't nest below a property)`);
    r.report.tokens++;
    const tokenExt = ext(group[name]) ?? {};
    const path = name === "$root" ? where : `${where}.${name}`;

    if (Array.isArray(tokenExt.responsive)) {
      responsive.push(...readResponsive(tokenExt.responsive, t!.type, name === "$root" ? undefined : name, id));
    }

    if (tokenExt.generated !== undefined) {
      r.report.generated.push(path);
      r.generated.push({ path, value: tokenValue(t!, r) });
      continue;
    }

    checkValueAlias(t!.raw, id, r);
    if (tokenExt.external !== undefined || t!.external !== undefined) {
      if (name !== "$root") fail(`${id}: an external token replaces the whole property, so it goes on $root`);
      return { external: tokenExt.external ?? refractPath(t!.external!) };
    }

    let value: unknown = tokenExt.derive !== undefined ? undefined : tokenValue(t!, r);
    if (isObject(tokenExt.derive)) {
      if (sub !== "colors") fail(`${id}: derive only applies to colours`);
      const ref = aliasPath(tokenExt.derive.ref) ?? fail(`${id}: derive.ref must be a {…} alias`);
      // A raw colour derivation names a same-property source by variant name, or omits ref for the base.
      const own = ref === where ? undefined : ref.startsWith(`${where}.`) ? ref.slice(where.length + 1) : ref;
      value = own === undefined ? { modifiers: tokenExt.derive.modifiers } : { ref: own, modifiers: tokenExt.derive.modifiers };
    }
    if (tokenExt.keyword !== undefined) value = tokenExt.keyword;

    if (name === "$root") {
      out.base = value;
    } else if (sub === "colors" && name === "text") {
      out.text = value;
    } else if (isObject(tokenExt.extras)) {
      const extras: Json = {};
      for (const [field, v] of Object.entries(tokenExt.extras)) extras[field] = extensionValue(t!.type, v, `${id}.extras.${field}`);
      variants[name] = { base: value, ...extras };
    } else {
      variants[name] = value;
    }
  }

  if (isObject(settings.values)) {
    for (const [name, v] of Object.entries(settings.values)) {
      const path = name === "$root" ? where : `${where}.${name}`;
      if (name === "$root") {
        if (out.base !== undefined) fail(`${where}: the base is both a $root token and an extension value`);
        out.base = v;
      } else {
        if (variants[name] !== undefined) fail(`${path}: both a token and an extension value`);
        variants[name] = v;
      }
      r.report.extensionOnly.push(path);
    }
  }

  if (out.base === undefined) fail(`${where}: no base — write a $root token (or a $root extension value)`);
  if (Object.keys(variants).length) out.variants = variants;
  if (responsive.length) out.responsive = responsive;
  return out;
};

/** Compare each generated token's written value with what the rule produced; the rule wins. */
const checkGenerated = (raw: RawTheme, r: Reader): void => {
  if (!r.generated.length) return;
  const theme = createTheme(raw, { adapter: createNoopAdapter() });
  const same = (a: unknown, b: unknown): boolean => {
    if (typeof a === "string" && typeof b === "string" && !/\d(px|rem|ms|s)$/.test(a)) {
      try {
        return toHexColor(a).toLowerCase() === toHexColor(b).toLowerCase();
      } catch {
        return a === b;
      }
    }
    return String(a) === String(b);
  };
  for (const { path, value } of r.generated) {
    if (!(path in theme.tokens)) {
      r.report.diagnostics.push({
        severity: "warning",
        code: "generated-not-produced",
        path,
        message: `${path} is marked generated, but its group's settings don't produce it; it was dropped`,
      });
      continue;
    }
    const produced = theme.resolveToken(path);
    if (isObject(value) || same(value, produced)) continue;
    r.report.diagnostics.push({
      severity: "warning",
      code: "generated-value-drift",
      path,
      message: `${path}: the file says ${JSON.stringify(value)}, the rule produces ${JSON.stringify(produced)}; using the rule`,
    });
  }
};

/**
 * Read a Refract DTCG profile token file into a raw theme, plus a report (generated tokens,
 * extension-only values, diagnostics). Throws `REFRACT_E_PROFILE` on a file that isn't a profile file,
 * names a version this reader doesn't know, or can't be read without guessing.
 */
export const readDTCGProfile = (doc: DTCGDocument): ProfileReadResult => {
  const docExt = ext(doc);
  if (!docExt) fail(`not a Refract profile file: no "${PROFILE_EXTENSION}" key in the top-level $extensions`);
  if (docExt!.version !== PROFILE_VERSION) {
    fail(`profile version ${JSON.stringify(docExt!.version)} isn't supported; this reader reads version ${PROFILE_VERSION}`);
  }
  const notYet = NOT_YET.filter(key => docExt![key] !== undefined);
  if (notYet.length) fail(`${notYet.join(", ")} in the document extension can't be read yet (coming with the next profile stage)`);

  for (const key of Object.keys(doc)) {
    if (!key.startsWith("$") && !(SUBSYSTEMS as readonly string[]).includes(key)) {
      fail(`"${key}" isn't a subsystem; top-level groups are ${SUBSYSTEMS.join(", ")}`);
    }
  }

  const { graph, legacy } = buildDTCGGraph(doc);
  const errors = graph.diagnostics.filter(d => d.severity === "error" && d.code !== "alias-unresolved");
  if (errors.length) {
    throw new RefractError(
      "REFRACT_E_PROFILE",
      `refract: ${errors.length} DTCG value error(s):\n${errors.map(e => `  - ${e.path}: ${e.message}`).join("\n")}`,
      errors.map(e => `${e.path}: ${e.message}`),
    );
  }

  const groups = new Set<string>();
  for (const sub of SUBSYSTEMS) {
    const g = (doc as Json)[sub];
    if (isObject(g)) for (const p of Object.keys(g)) if (!p.startsWith("$")) groups.add(`${sub}.${p}`);
  }
  const r: Reader = {
    legacy,
    groups,
    report: { tokens: 0, generated: [], extensionOnly: [], diagnostics: graph.diagnostics.map(d => ({ ...d })) },
    generated: [],
  };

  const raw: Json = {};
  if (isObject(docExt!.breakpoints)) raw.breakpoints = docExt!.breakpoints;
  if (isObject(docExt!.containers)) raw.containers = docExt!.containers;
  if (isObject(docExt!.extends)) raw.extends = docExt!.extends;

  for (const sub of SUBSYSTEMS) {
    const groups = (doc as Json)[sub];
    if (!isObject(groups)) continue;
    const slice: Json = {};
    for (const [property, group] of Object.entries(groups)) {
      if (property.startsWith("$")) continue;
      if (sub === "layout" && !LAYOUT_PROPERTIES.has(property)) {
        fail(`layout.${property}: layout takes ${[...LAYOUT_PROPERTIES].join(", ")}`);
      }
      if (!isObject(group)) fail(`${sub}.${property}: not a property group`);
      slice[property] = readProperty(sub, property, group as Json, id => graph.byId.get(id), r);
    }
    if (Object.keys(slice).length) raw[sub] = slice;
  }

  checkGenerated(raw as RawTheme, r);
  return { raw: raw as RawTheme, report: r.report };
};
