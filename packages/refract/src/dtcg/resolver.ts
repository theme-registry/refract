/**
 * Refract DTCG profile — Resolver stage.
 *
 * A theme with modes is a DTCG 2025.10 Resolver document plus the token files it references. This
 * module resolves it in memory (`{ resolver, files }`; a file loader sits on top) and reads it as a
 * profile:
 *
 * 1. Resolve with every modifier at its `default` context and read the result as a profile token
 *    document → the base raw theme.
 * 2. A modifier marked `"as": "modes"` (or, with no marker, one whose contexts are exactly light and
 *    dark): resolve each other context and compare it with the default. Each token that changed becomes
 *    a `modes` entry on its property, so one stylesheet switches values in place.
 * 3. `"as": "themes"`: each other context becomes a partial raw theme for `override()` (whole changed
 *    properties, since `override()` replaces a property at a time).
 *
 * A context may change tokens but not add them. Sources are merged in order, later wins; a token node
 * is replaced whole.
 */
import type { DTCGDocument } from "./types";
import { PROFILE_EXTENSION, readDTCGProfile } from "./profile";
import type { ProfileReport } from "./profile";
import { RefractError } from "../core";
import type { RawTheme } from "../core";

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const fail = (message: string): never => {
  throw new RefractError("REFRACT_E_PROFILE", message);
};

/** A DTCG 2025.10 resolver document (the parts Refract reads). */
export type DTCGResolverDocument = {
  version: string;
  sets?: Record<string, { sources: unknown[]; description?: string }>;
  modifiers?: Record<string, { contexts: Record<string, unknown[]>; default?: string; $extensions?: Json }>;
  resolutionOrder: unknown[];
  name?: string;
  description?: string;
};

export type ProfileSetInput = {
  readonly resolver: DTCGResolverDocument;
  /** Token files by the path the resolver's `$ref`s use (`"base.tokens.json"`). */
  readonly files: Readonly<Record<string, DTCGDocument>>;
};

export type ProfileSetResult = {
  /** The base theme, with every `as: "modes"` modifier folded in as `modes`. */
  readonly raw: RawTheme;
  /** `modifier → context → partial raw theme` for each `as: "themes"` modifier's non-default contexts. */
  readonly themes: Readonly<Record<string, Readonly<Record<string, Partial<RawTheme>>>>>;
  readonly report: ProfileReport & {
    /** The modes folded into the base theme. */
    readonly modes: readonly string[];
  };
};

type Item = { kind: "set"; name: string; sources: unknown[] } | { kind: "modifier"; name: string; contexts: Record<string, unknown[]>; default?: string; as?: string };

/** Deep-merge token documents in order; a token node (has `$value`) is replaced whole. */
const merge = (target: Json, source: Json): Json => {
  for (const [key, value] of Object.entries(source)) {
    const current = target[key];
    if (isObject(value) && !("$value" in value) && isObject(current) && !("$value" in current)) {
      target[key] = merge({ ...current }, value);
    } else {
      target[key] = isObject(value) ? structuredClone(value) : value;
    }
  }
  return target;
};

const hasDocumentExtension = (doc: unknown): boolean =>
  isObject(doc) && isObject(doc.$extensions) && doc.$extensions[PROFILE_EXTENSION] !== undefined;

/** Resolve a source: a `{ $ref: "<file>" }` to its file, an inline token document as itself. */
const sourceDoc = (source: unknown, input: ProfileSetInput, where: string): Json => {
  if (isObject(source) && typeof source.$ref === "string" && Object.keys(source).length === 1) {
    const ref = source.$ref;
    if (ref.startsWith("#")) fail(`${where}: "${ref}" — a source can't point inside the resolver; reference a set from resolutionOrder`);
    if (ref.includes("#")) fail(`${where}: "${ref}" — references into part of a file aren't supported; reference the whole file`);
    const file = input.files[ref];
    if (!isObject(file)) fail(`${where}: "${ref}" isn't among the files given`);
    return file as Json;
  }
  if (isObject(source)) return source;
  return fail(`${where}: a source must be { "$ref": "<file>" } or an inline token document`);
};

/** The resolution order as sets and modifiers, `$ref`s into the resolver followed. */
const orderOf = (input: ProfileSetInput): Item[] => {
  const { resolver } = input;
  if (resolver.version !== "2025.10") fail(`resolver version ${JSON.stringify(resolver.version)} isn't supported; expected "2025.10"`);
  if (!Array.isArray(resolver.resolutionOrder)) fail("the resolver has no resolutionOrder");
  return resolver.resolutionOrder.map((entry, i): Item => {
    const where = `resolutionOrder[${i}]`;
    if (!isObject(entry)) return fail(`${where}: must be an object`);
    if (typeof entry.$ref === "string") {
      const m = entry.$ref.match(/^#\/(sets|modifiers)\/([^/]+)$/);
      if (!m) return fail(`${where}: "${entry.$ref}" must point at #/sets/<name> or #/modifiers/<name>`);
      const [, kind, name] = m;
      if (kind === "sets") {
        const set = resolver.sets?.[name];
        if (!set) return fail(`${where}: no set "${name}"`);
        return { kind: "set", name, sources: set.sources ?? [] };
      }
      const mod = resolver.modifiers?.[name];
      if (!mod) return fail(`${where}: no modifier "${name}"`);
      return modifierItem(name, mod as Json, where);
    }
    if (entry.type === "set") return { kind: "set", name: String(entry.name ?? where), sources: (entry.sources as unknown[]) ?? [] };
    if (entry.type === "modifier") return modifierItem(String(entry.name ?? where), entry, where);
    return fail(`${where}: an inline item needs "type": "set" or "modifier"`);
  });
};

const modifierItem = (name: string, mod: Json, where: string): Item => {
  const contexts = mod.contexts;
  if (!isObject(contexts) || !Object.keys(contexts).length) return fail(`modifier "${name}" (${where}) has no contexts`);
  const def = mod.default;
  if (typeof def !== "string") return fail(`modifier "${name}" needs a default context`);
  if (!(def in contexts)) return fail(`modifier "${name}": default "${def}" isn't one of its contexts`);
  const ext = isObject(mod.$extensions) ? mod.$extensions[PROFILE_EXTENSION] : undefined;
  let as = isObject(ext) ? (ext.as as string | undefined) : undefined;
  if (as !== undefined && as !== "modes" && as !== "themes") fail(`modifier "${name}": "as" must be "modes" or "themes"`);
  if (as === undefined) {
    const names = Object.keys(contexts).sort().join(",");
    if (names !== "dark,light") {
      fail(`modifier "${name}": say how Refract uses it with "$extensions": { "${PROFILE_EXTENSION}": { "as": "modes" | "themes" } }`);
    }
    as = "modes";
  }
  return { kind: "modifier", name, contexts: contexts as Record<string, unknown[]>, default: def, as };
};

/** Resolve the order with `choice[modifier]` as each modifier's context (else its default). */
const resolve = (order: Item[], input: ProfileSetInput, choice: Record<string, string>): Json => {
  const out: Json = {};
  let docExtensions = 0;
  for (const item of order) {
    const sources =
      item.kind === "set" ? item.sources : item.contexts[choice[item.name] ?? (item.default as string)] ?? [];
    sources.forEach((source, i) => {
      const doc = sourceDoc(source, input, `${item.kind} "${item.name}" source ${i}`);
      if (hasDocumentExtension(doc)) docExtensions++;
      merge(out, doc);
    });
  }
  if (docExtensions > 1) fail(`the document-level "${PROFILE_EXTENSION}" block appears in ${docExtensions} files; keep it in one`);
  return out;
};

/** Every token in a resolved document: DTCG id → its node. */
const tokensOf = (doc: Json, prefix: string[] = [], out = new Map<string, Json>()): Map<string, Json> => {
  for (const [key, value] of Object.entries(doc)) {
    if (key.startsWith("$") && key !== "$root") continue;
    if (!isObject(value)) continue;
    const path = [...prefix, key];
    if ("$value" in value) out.set(path.join("."), value);
    else tokensOf(value, path, out);
  }
  return out;
};

const isGenerated = (node: Json | undefined): boolean => {
  const e = node && isObject(node.$extensions) ? node.$extensions[PROFILE_EXTENSION] : undefined;
  return isObject(e) && e.generated !== undefined;
};

/** The tokens whose `$value` differs between the default and a context; adding a token is an error. */
const changedTokens = (base: Map<string, Json>, other: Map<string, Json>, label: string): string[] => {
  const changed: string[] = [];
  for (const [id, node] of other) {
    const before = base.get(id);
    if (!before) fail(`${label} adds ${id}, which the default doesn't have; a context may only change tokens`);
    if (JSON.stringify(before!.$value) === JSON.stringify(node.$value)) continue;
    if (isGenerated(node) || isGenerated(before)) {
      fail(`${label} changes ${id}, a generated token; change the settings it's generated from instead`);
    }
    changed.push(id);
  }
  return changed;
};

/** A DTCG id → `[subsystem, property, member]`, member undefined for `$root`. */
const address = (id: string): [string, string, string | undefined] => {
  const [sub, prop, member] = id.split(".");
  return [sub, prop, member === "$root" ? undefined : member];
};

type RawProperty = { base?: unknown; text?: unknown; variants?: Record<string, unknown>; modes?: Json[] };
const propertyOf = (raw: RawTheme, sub: string, prop: string): RawProperty | undefined =>
  ((raw as Json)[sub] as Record<string, RawProperty> | undefined)?.[prop];

/** The mode entry for one changed token, read from the context's raw theme. */
const modeEntry = (mode: string, contextRaw: RawTheme, id: string): Json => {
  const [sub, prop, member] = address(id);
  const p = propertyOf(contextRaw, sub, prop);
  if (!p) return fail(`${id}: missing from the "${mode}" context`);
  const toEntry = (field: "base" | "text", value: unknown, target?: string): Json => {
    const entry: Json = { mode, ...(target ? { target } : {}) };
    if (isObject(value) && typeof value.ref === "string" && !("modifiers" in value)) {
      if (field === "text") fail(`${id}: a mode can't alias a text colour yet`);
      entry.ref = value.ref;
    } else {
      entry[field] = value;
    }
    return entry;
  };
  if (member === undefined) return toEntry("base", p.base);
  if (sub === "colors" && member === "text") return toEntry("text", p.text);
  const v = p.variants?.[member];
  if (isObject(v) && "modifiers" in v) fail(`${id}: a mode can't change a derived variant; change its source`);
  return toEntry("base", isObject(v) && "base" in v ? v.base : v, member);
};

/**
 * Read a Refract DTCG profile theme from a Resolver document and its token files. Throws
 * `REFRACT_E_PROFILE` on anything it can't read without guessing.
 */
export const readDTCGProfileSet = (input: ProfileSetInput): ProfileSetResult => {
  const order = orderOf(input);
  const modifiers = order.filter((i): i is Extract<Item, { kind: "modifier" }> => i.kind === "modifier");
  const modeModifiers = modifiers.filter(m => m.as === "modes");
  if (modeModifiers.length > 1) {
    fail(`only one modifier can be "as": "modes" (found ${modeModifiers.map(m => m.name).join(", ")}); make the others "themes"`);
  }

  const defaults = Object.fromEntries(modifiers.map(m => [m.name, m.default as string]));
  const baseDoc = resolve(order, input, defaults);
  const { raw, report } = readDTCGProfile(baseDoc as unknown as DTCGDocument);
  const baseTokens = tokensOf(baseDoc);
  const out = structuredClone(raw) as Json;
  const modes: string[] = [];
  const themes: Record<string, Record<string, Partial<RawTheme>>> = {};

  for (const mod of modifiers) {
    for (const context of Object.keys(mod.contexts)) {
      if (context === mod.default) continue;
      const label = `modifier "${mod.name}" context "${context}"`;
      const doc = resolve(order, input, { ...defaults, [mod.name]: context });
      const changed = changedTokens(baseTokens, tokensOf(doc), label);
      const contextRaw = readDTCGProfile(doc as unknown as DTCGDocument).raw;

      if (mod.as === "modes") {
        modes.push(context);
        for (const id of changed) {
          const [sub, prop] = address(id);
          const p = propertyOf(out as RawTheme, sub, prop);
          if (!p) fail(`${id}: not in the default theme`);
          if (isObject(p) && "external" in p) fail(`${id}: an external token can't change per mode`);
          p!.modes = [...(p!.modes ?? []), modeEntry(context, contextRaw, id)];
        }
      } else {
        const partial: Json = {};
        for (const id of changed) {
          const [sub, prop] = address(id);
          const whole = propertyOf(contextRaw, sub, prop);
          ((partial[sub] as Json | undefined) ?? (partial[sub] = {}) as Json)[prop] = whole;
        }
        (themes[mod.name] ??= {})[context] = partial as Partial<RawTheme>;
      }
    }
  }

  if (modes.length) {
    const def = modeModifiers[0].default as string;
    out.modes = [...new Set([...modes, def])];
  }

  return { raw: out as RawTheme, themes, report: { ...report, modes } };
};

/** A single profile token file, or a resolver plus its files. */
export type ProfileInput = DTCGDocument | ProfileSetInput;

const isSetInput = (input: ProfileInput): input is ProfileSetInput =>
  isObject(input) && isObject((input as Json).resolver) && isObject((input as Json).files);

/**
 * Read a Refract DTCG profile — a single token file, or `{ resolver, files }` — into a raw theme, the
 * child themes of any `"as": "themes"` modifier, and a report (generated tokens, extension-only
 * values, modes, diagnostics). `fromDTCGProfile` is its `raw` half. Throws `REFRACT_E_PROFILE`.
 */
export const importDTCGProfile = (input: ProfileInput): ProfileSetResult => {
  if (isSetInput(input)) return readDTCGProfileSet(input);
  const { raw, report } = readDTCGProfile(input as DTCGDocument);
  return { raw, themes: {}, report: { ...report, modes: [] } };
};

/** {@link importDTCGProfile}'s raw theme: `createTheme(fromDTCGProfile(doc), { adapter })`. */
export const fromDTCGProfile = (input: ProfileInput): RawTheme => importDTCGProfile(input).raw;
