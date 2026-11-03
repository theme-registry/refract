/**
 * Refract DTCG profile writer: a raw theme → profile files (a resolver plus token files) that
 * `readDTCGProfileSet` reads back into the same theme.
 *
 * Intent comes from the raw theme: which tokens are authored and which generated, generator settings,
 * derivations, aliases, recipes. Values come from the built theme, so every token carries its
 * canonical value in DTCG 2025.10 shapes (colour objects, `{ value, unit }` dimensions and durations)
 * and generated tokens are written out with the values the rule produces.
 *
 * Throws `REFRACT_E_PROFILE` for the few raw features profile v1 can't express (a responsive entry
 * under a mode condition, a multi-part or non-`all` transition, a literal-form external).
 */
import type { DTCGDocument } from "./types";
import type { DTCGResolverDocument } from "./resolver";
import { PROFILE_EXTENSION, PROFILE_VERSION } from "./profile";
import { colorStringToObject } from "./color";
import { createTheme, createNoopAdapter, RefractError } from "../core";
import type { RawTheme, Ref, Theme } from "../core";

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const fail = (message: string): never => {
  throw new RefractError("REFRACT_E_PROFILE", message);
};

export type ProfileFiles = {
  readonly resolver: DTCGResolverDocument;
  /** File name → token document; `base.tokens.json` plus one file per mode. */
  readonly files: Readonly<Record<string, DTCGDocument>>;
};

const SUBSYSTEMS = ["colors", "typography", "layout", "effects", "borders", "animation"] as const;
const SETTINGS = new Set(["tones", "steps", "lightenBy", "darkenBy", "harmony", "ratio", "precision", "baseFontSize", "unit", "step"]);
const STRUCTURE = new Set(["columns", "grids", "stacks", "container"]);
const STROKE_STYLES = new Set(["solid", "dashed", "dotted", "double", "groove", "ridge", "outset", "inset"]);
const EASINGS: Record<string, number[]> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  "ease-in": [0.42, 0, 1, 1],
  "ease-out": [0, 0, 0.58, 1],
  "ease-in-out": [0.42, 0, 0.58, 1],
};
const ext = (data: Json): Json => ({ $extensions: { [PROFILE_EXTENSION]: data } });

/** A refract token path → the DTCG id of its token (`colors.brand` → `colors.brand.$root`). */
const tokenId = (path: string): string => (path.split(".").length === 2 ? `${path}.$root` : path);
/** `$value` alias (must name a token) and extension alias (shorthand allowed). */
const valueAlias = (path: string): string => `{${tokenId(path)}}`;
const extAlias = (path: string): string => `{${path}}`;

const dimension = (v: unknown): Json | undefined =>
  typeof v === "number" ? { value: v, unit: "px" } : isObject(v) && typeof v.value === "number" ? { value: v.value, unit: v.unit } : undefined;

const bezierOf = (s: string): number[] | undefined => {
  if (EASINGS[s]) return EASINGS[s];
  const m = s.match(/^cubic-bezier\(([^)]+)\)$/);
  const n = m?.[1].split(",").map(x => Number(x.trim()));
  return n && n.length === 4 && n.every(Number.isFinite) ? n : undefined;
};

type Written = { token?: Json; value?: string | number };

/**
 * A built token `Ref` → a DTCG token (`{ $type, $value }`, plus `keyword` for an easing keyword), or an
 * extension-only value when DTCG has no type for it.
 */
const writeValue = (sub: string, prop: string, ref: Ref, where: string): Written => {
  if (ref.ref !== undefined && ref.fn === undefined && !ref.modifiers?.length && ref.external === undefined) {
    return { token: { $value: valueAlias(ref.ref) } };
  }
  const v = ref.value;
  if (sub === "colors") {
    const color = typeof v === "string" ? colorStringToObject(v) : undefined;
    return color ? { token: { $type: "color", $value: color } } : fail(`${where}: colour ${JSON.stringify(v)} can't be written`);
  }
  if (ref.struct !== undefined) {
    if (sub === "effects" && prop === "shadow") {
      const layers = (ref.struct as Json[]).map(l => ({
        color: typeof l.color === "string" ? valueAlias(l.color) : fail(`${where}: a shadow layer needs a colour`),
        offsetX: dimension(l.offsetX ?? 0),
        offsetY: dimension(l.offsetY ?? 0),
        blur: dimension(l.blur ?? 0),
        spread: dimension(l.spread ?? 0),
        ...(l.inset ? { inset: true } : {}),
      }));
      return { token: { $type: "shadow", $value: layers.length === 1 ? layers[0] : layers } };
    }
    if (sub === "effects" && prop === "transitions") {
      const parts = ref.struct as Json[];
      const p = parts[0];
      if (parts.length !== 1 || (p.property !== undefined && p.property !== "all")) {
        fail(`${where}: profile v1 writes one transition on "all"; this one has ${parts.length} part(s) on "${p.property}"`);
      }
      const keyword = typeof p.timingFunction === "string" && EASINGS[p.timingFunction] ? p.timingFunction : undefined;
      const token: Json = {
        $type: "transition",
        $value: {
          duration: { value: Number(p.duration ?? 0), unit: "ms" },
          delay: { value: Number(p.delay ?? 0), unit: "ms" },
          timingFunction: bezierOf(String(p.timingFunction ?? "ease")) ?? fail(`${where}: timing function ${p.timingFunction} can't be written`),
        },
      };
      if (keyword) Object.assign(token, ext({ keyword }));
      return { token };
    }
    return fail(`${where}: structured value can't be written`);
  }
  if (sub === "animation" && prop === "easing" && typeof v === "string") {
    const bezier = bezierOf(v);
    if (!bezier) return { value: v };
    return { token: { $type: "cubicBezier", $value: bezier, ...(EASINGS[v] ? ext({ keyword: v }) : {}) } };
  }
  if (sub === "animation" && (prop === "duration" || prop === "delay") && typeof v === "number") {
    return { token: { $type: "duration", $value: { value: v, unit: ref.unit ?? "ms" } } };
  }
  if (sub === "typography" && prop === "fontFamily" && typeof v === "string") return { token: { $type: "fontFamily", $value: v } };
  if (sub === "typography" && prop === "fontWeight" && typeof v === "number") return { token: { $type: "fontWeight", $value: v } };
  if (sub === "borders" && prop === "style" && typeof v === "string" && STROKE_STYLES.has(v)) return { token: { $type: "strokeStyle", $value: v } };
  if (typeof v === "number" && (ref.unit === "px" || ref.unit === "rem")) return { token: { $type: "dimension", $value: { value: v, unit: ref.unit } } };
  if (typeof v === "number" && ref.unit === undefined) return { token: { $type: "number", $value: v } };
  if (typeof v === "number") return { value: `${v}${ref.unit}` };
  if (typeof v === "string") return { value: v };
  return fail(`${where}: value ${JSON.stringify(v)} can't be written`);
};

/** The variant names a raw property authors (everything else under it in `theme.tokens` is generated). */
const authoredOf = (rawProp: unknown): { variants: Json; text: boolean } => {
  if (!isObject(rawProp)) return { variants: {}, text: false };
  return { variants: isObject(rawProp.variants) ? rawProp.variants : {}, text: rawProp.text !== undefined };
};

const generatedKind = (sub: string, rawProp: Json): string =>
  sub !== "colors" ? "scale" : rawProp.steps ? "steps" : rawProp.harmony !== undefined ? "harmony" : "tones";

/** Group-level generator settings of a raw property. */
const groupSettings = (sub: string, rawProp: Json): Json | undefined => {
  const out: Json = {};
  if (sub === "colors") {
    if (rawProp.tones === false) out.tones = false;
    else if (rawProp.lightenBy !== undefined || rawProp.darkenBy !== undefined) {
      out.tones = { ...(rawProp.lightenBy !== undefined ? { lightenBy: rawProp.lightenBy } : {}), ...(rawProp.darkenBy !== undefined ? { darkenBy: rawProp.darkenBy } : {}) };
    }
    if (rawProp.steps !== undefined) out.steps = rawProp.steps;
    if (rawProp.harmony !== undefined) out.harmony = rawProp.harmony;
  } else if (rawProp.ratio !== undefined || rawProp.step !== undefined) {
    const scale: Json = {};
    for (const k of ["ratio", "precision", "baseFontSize", "step", "steps"]) if (rawProp[k] !== undefined) scale[k] = rawProp[k];
    out.scale = scale;
  }
  return Object.keys(out).length ? out : undefined;
};

type ModeDocs = Map<string, Json>;

/** Write one property group, plus its mode values into `modeDocs`. */
const writeProperty = (sub: string, prop: string, rawProp: unknown, theme: Theme, modeDocs: ModeDocs): Json => {
  const owner = `${sub}.${prop}`;
  const pm = theme.model.subsystems[sub]?.properties?.[prop];
  if (!pm) return fail(`${owner}: not in the built theme`);
  const raw = isObject(rawProp) && !("ref" in rawProp && !("modifiers" in rawProp)) ? rawProp : {};
  const group: Json = {};
  const values: Json = {};
  const settings = groupSettings(sub, raw);

  if (pm.base.external !== undefined) {
    const e = isObject(rawProp) ? String(rawProp.external) : "";
    if (e.startsWith("--")) fail(`${owner}: a literal-form external ("${e}") has no value to write; use the path form`);
    group.$root = { $value: valueAlias(e) };
    return group;
  }

  const authored = authoredOf(raw);
  const put = (name: string, path: string, ref: Ref, extra: Json = {}): void => {
    const w = writeValue(sub, prop, ref, path);
    if (w.value !== undefined) {
      values[name] = w.value;
      return;
    }
    const token = { ...w.token! };
    const tokenExt: Json = { ...(isObject(token.$extensions) ? ((token.$extensions as Json)[PROFILE_EXTENSION] as Json) : {}), ...extra };
    delete token.$extensions;
    group[name] = Object.keys(tokenExt).length ? { ...token, ...ext(tokenExt) } : token;
  };

  // Base and the colour `text` extra.
  put("$root", owner, theme.tokens[owner]);
  if (pm.extras?.text) put("text", `${owner}.text`, theme.tokens[`${owner}.text`]);

  // Variants: authored as written (derivations keep their rule), the rest generated.
  const kind = generatedKind(sub, raw);
  for (const [name, variant] of Object.entries(pm.variants ?? {})) {
    const path = `${owner}.${name}`;
    const rawVariant = authored.variants[name];
    const extra: Json = {};
    if (rawVariant === undefined) extra.generated = kind;
    else if (isObject(rawVariant) && Array.isArray(rawVariant.modifiers)) {
      const ref = typeof rawVariant.ref === "string" ? (rawVariant.ref.includes(".") ? rawVariant.ref : `${owner}.${rawVariant.ref}`) : owner;
      extra.derive = { ref: extAlias(ref), modifiers: rawVariant.modifiers };
    }
    if (variant.extras && Object.keys(variant.extras).length) {
      const extras: Json = {};
      for (const [field, r] of Object.entries(variant.extras)) extras[field] = writeValue(sub, prop, r, `${path}.${field}`).token?.$value;
      extra.extras = extras;
    }
    const tokenRef = extra.derive ? { ...theme.tokens[path], ref: undefined, fn: undefined, modifiers: undefined } : theme.tokens[path];
    put(name, path, tokenRef as Ref, extra);
  }

  // Responsive entries → on the token they write.
  for (const entry of pm.responsive ?? []) {
    if (entry.mode !== undefined) fail(`${owner}: a responsive entry under a mode ("${entry.mode}") can't be written in profile v1`);
    const name = entry.target ?? "$root";
    const out: Json = { breakpoint: entry.breakpoint };
    if (entry.query) out.query = entry.query;
    if (entry.orientation) out.orientation = entry.orientation;
    if (entry.ref !== undefined) out.variant = entry.ref;
    else {
      const base = entry.overrides?.base;
      if (!base) continue;
      const w = writeValue(sub, prop, base.fn ? { ...base, ref: undefined, fn: undefined, arg: undefined } : base, `${owner}.responsive`);
      if (w.token === undefined) fail(`${owner}: a responsive value with no DTCG type can't be written`);
      out.$value = w.token!.$value;
    }
    const node = group[name] as Json | undefined;
    if (!node) fail(`${owner}: responsive entry targets "${name}", which has no token`);
    const e = (((node!.$extensions as Json | undefined)?.[PROFILE_EXTENSION]) as Json | undefined) ?? {};
    group[name] = { ...node, ...ext({ ...e, responsive: [...((e.responsive as Json[]) ?? []), out] }) };
  }

  // Modes → the mode's own file, at the same token path.
  for (const entry of pm.modes ?? []) {
    if (!entry.mode) continue;
    const doc = modeDocs.get(entry.mode) ?? (modeDocs.set(entry.mode, {}), modeDocs.get(entry.mode)!);
    for (const [field, r] of Object.entries(entry.overrides ?? {})) {
      const name = field === "text" ? "text" : entry.target ?? "$root";
      const literal = r.fn || r.modifiers?.length ? { ...r, ref: undefined, fn: undefined, modifiers: undefined } : r;
      const w = writeValue(sub, prop, literal as Ref, `${owner}.modes.${entry.mode}`);
      if (w.token === undefined) fail(`${owner}: a mode value with no DTCG type can't be written`);
      (((doc[sub] as Json) ??= {}) as Json)[prop] ??= {};
      // A mode file's token replaces the base token whole, so it carries its own $type.
      (((doc[sub] as Json)[prop]) as Json)[name] = { $type: w.token!.$type, $value: w.token!.$value };
    }
  }

  const groupExt: Json = { ...(settings ?? {}), ...(Object.keys(values).length ? { values } : {}) };
  if (Object.keys(groupExt).length) Object.assign(group, ext(groupExt));
  return group;
};

// --- document level ---

const LAYOUT_SCALE: Record<string, string> = {
  paddingY: "spacing", paddingX: "spacing", marginY: "spacing", marginX: "spacing", gap: "spacing",
  width: "sizes", minWidth: "sizes", maxWidth: "sizes", height: "sizes", minHeight: "sizes", maxHeight: "sizes",
};
const EFFECTS_PROPERTY: Record<string, string> = { boxShadow: "shadow", opacity: "opacity", blur: "blur", transition: "transitions", zIndex: "zIndex" };
const ANIMATION_PROPERTY: Record<string, string> = { duration: "duration", easing: "easing", delay: "delay" };
const RESERVED = new Set(["breakpoint", "query", "state", "variant", "target", "orientation", "container", "size", "as", "side"]);
const COMPOSITION = new Set(["colors", "typography", "layout", "effects", "borders", "animation"]);

const scaleAlias = (property: string, name: unknown): unknown =>
  typeof name === "string" ? extAlias(name === "base" ? property : `${property}.${name}`) : name;

/** One raw recipe field → its profile form (a `{…}` alias for a token, else the literal). */
const recipeField = (sub: string, theme: Theme) => (key: string, value: unknown): unknown => {
  if (value === null || value === undefined) return value;
  switch (sub) {
    case "colors":
      return typeof value === "string" && `colors.${value}` in theme.tokens ? extAlias(`colors.${value}`) : value;
    case "typography":
      return scaleAlias(`typography.${key}`, value);
    case "layout":
      return LAYOUT_SCALE[key] ? scaleAlias(`layout.${LAYOUT_SCALE[key]}`, value) : value;
    case "effects":
      return EFFECTS_PROPERTY[key] ? scaleAlias(`effects.${EFFECTS_PROPERTY[key]}`, value) : value;
    case "borders":
      if (key === "color") return typeof value === "string" ? extAlias(value) : value;
      return ["width", "style", "offset", "radius"].includes(key) ? scaleAlias(`borders.${key}`, value) : value;
    case "animation":
      return ANIMATION_PROPERTY[key] ? scaleAlias(`animation.${ANIMATION_PROPERTY[key]}`, value) : value;
    default:
      return value;
  }
};

/** A literal-first value: `{ ref }` → a `{…}` alias. */
const cssValue = (v: unknown): unknown => (isObject(v) && typeof v.ref === "string" && Object.keys(v).length === 1 ? extAlias(v.ref) : v);
const cssBlock = (block: unknown): unknown => (isObject(block) ? Object.fromEntries(Object.entries(block).map(([k, v]) => [k, cssValue(v)])) : block);
const componentField = (key: string, value: unknown): unknown => (key === "css" ? cssBlock(value) : COMPOSITION.has(key) ? value : cssValue(value));

const writeRecipe = (recipe: unknown, field: (key: string, value: unknown) => unknown): unknown => {
  if (!isObject(recipe)) return recipe;
  const out: Json = {};
  for (const [key, value] of Object.entries(recipe)) {
    if (RESERVED.has(key)) out[key] = value;
    else if (key === "states") {
      out.states = Array.isArray(value)
        ? value.map(v => writeRecipe(v, field))
        : isObject(value) ? Object.fromEntries(Object.entries(value).map(([s, v]) => [s, writeRecipe(v, field)])) : value;
    } else if (key === "responsive") out.responsive = Array.isArray(value) ? value.map(v => writeRecipe(v, field)) : value;
    else if (key === "variants") out.variants = isObject(value) ? Object.fromEntries(Object.entries(value).map(([n, v]) => [n, writeRecipe(v, field)])) : value;
    else out[key] = field(key, value);
  }
  return out;
};

const writeDocumentLevel = (raw: Json, theme: Theme): Json => {
  const out: Json = { version: PROFILE_VERSION };
  out.breakpoints = isObject(raw.breakpoints) ? raw.breakpoints : theme.model.breakpoints;
  if (isObject(raw.containers)) out.containers = raw.containers;
  if (isObject(raw.extends)) out.extends = raw.extends;

  const recipes: Json = {};
  for (const sub of [...SUBSYSTEMS, "components"]) {
    const slice = raw[sub];
    if (!isObject(slice) || !isObject(slice.recipes)) continue;
    const field = sub === "components" ? componentField : recipeField(sub, theme);
    recipes[sub] = Object.fromEntries(
      Object.entries(slice.recipes).map(([group, members]) => [
        group,
        isObject(members) ? Object.fromEntries(Object.entries(members).map(([n, r]) => [n, writeRecipe(r, field)])) : members,
      ]),
    );
  }
  if (Object.keys(recipes).length) out.recipes = recipes;

  if (isObject(raw.globals)) {
    const g: Json = {};
    if (raw.globals.preset !== undefined) g.preset = raw.globals.preset;
    if (isObject(raw.globals.elements)) {
      g.elements = Object.fromEntries(Object.entries(raw.globals.elements).map(([sel, el]) => [sel, writeRecipe(el, (_k, v) => cssValue(v))]));
    }
    out.globals = g;
  }

  const animation = raw.animation;
  if (isObject(animation) && isObject(animation.keyframes)) {
    out.keyframes = Object.fromEntries(
      Object.entries(animation.keyframes).map(([name, stops]) => [
        name,
        isObject(stops) ? Object.fromEntries(Object.entries(stops).map(([stop, decls]) => [stop, cssBlock(decls)])) : stops,
      ]),
    );
  }

  if (isObject(raw.layout)) {
    out.layout = Object.fromEntries(Object.entries(raw.layout).filter(([k]) => STRUCTURE.has(k)));
  }
  return out;
};

/**
 * Write a raw theme as Refract DTCG profile files. Reading them back with `readDTCGProfileSet`
 * builds the same theme.
 */
export const writeDTCGProfile = (rawTheme: RawTheme): ProfileFiles => {
  const raw = rawTheme as unknown as Json;
  const theme = createTheme(rawTheme, { adapter: createNoopAdapter() });
  const base: Json = { $schema: "https://theme-registry.github.io/refract/schema/dtcg-profile/v1.json" };
  Object.assign(base, ext(writeDocumentLevel(raw, theme)));
  const modeDocs: ModeDocs = new Map();

  for (const sub of SUBSYSTEMS) {
    const slice = raw[sub];
    if (!isObject(slice)) continue;
    const props = theme.model.subsystems[sub]?.properties ?? {};
    const groups: Json = {};
    for (const prop of Object.keys(props)) {
      if (prop.includes("--") || SETTINGS.has(prop) || STRUCTURE.has(prop)) continue;
      if (!(prop in slice)) continue; // built-in tokens (e.g. layout structure config) aren't authored
      groups[prop] = writeProperty(sub, prop, slice[prop], theme, modeDocs);
    }
    if (Object.keys(groups).length) base[sub] = groups;
  }

  const files: Record<string, DTCGDocument> = { "base.tokens.json": base as unknown as DTCGDocument };
  const resolver: DTCGResolverDocument = {
    version: "2025.10",
    sets: { base: { sources: [{ $ref: "base.tokens.json" }] } },
    resolutionOrder: [{ $ref: "#/sets/base" }],
  };
  if (modeDocs.size) {
    const names = [...modeDocs.keys()];
    const def = names.includes("light") ? "default" : "light";
    const contexts: Record<string, unknown[]> = { [def]: [] };
    for (const name of names) {
      files[`${name}.tokens.json`] = modeDocs.get(name) as unknown as DTCGDocument;
      contexts[name] = [{ $ref: `${name}.tokens.json` }];
    }
    resolver.modifiers = { mode: { ...ext({ as: "modes" }), default: def, contexts } as never };
    resolver.resolutionOrder.push({ $ref: "#/modifiers/mode" });
  }
  return { resolver, files };
};
