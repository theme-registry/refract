import type { DTCGColorObject, DTCGDocument, DTCGTokenType } from "./types";
import { RefractError } from "../core/errors";
import { DTCG_COLOR_SPACES, colorObjectRgb, colorObjectToString, colorStringToObject, NATIVE_COLOR_SPACES } from "./color";

/**
 * The DTCG token graph — the neutral middle layer every import reads.
 *
 * `parseDTCGGraph(doc)` parses a DTCG **2025.10** document (or a 2024-draft one: its string values are
 * converted to the same canonical shapes) into typed tokens with canonical values, alias edges kept,
 * and `$extensions` preserved. Nothing is guessed: a value the spec doesn't allow becomes a diagnostic,
 * never a silent fallback. Mapping tokens onto refract subsystems is a later stage's job.
 */

/** Why a diagnostic was raised. */
export type DTCGDiagnosticCode =
  | "type-unknown" // no `$type` on the token, its groups, or its alias target
  | "type-mismatch" // an alias's declared `$type` differs from its target's
  | "invalid-value" // a `$value` that doesn't match its type
  | "color-space-unsupported" // a colour in a space refract can't convert, with no `hex` fallback
  | "color-space-fallback" // a colour in a non-native space, read through its `hex` fallback
  | "dimension-unit" // a dimension/duration unit outside the spec's set (px/rem, ms/s)
  | "alias-unresolved" // a reference whose target isn't in the document
  | "extends-unresolved"; // a group `$extends` whose target isn't a group in the document

export type DTCGDiagnostic = {
  readonly severity: "error" | "warning";
  readonly code: DTCGDiagnosticCode;
  /** Token or group path, dot-joined (`color.brand.$root`). */
  readonly path: string;
  readonly message: string;
};

export type DTCGGraphToken = {
  /** Dot-joined path, the id references use: `color.brand.$root`. */
  readonly id: string;
  readonly path: readonly string[];
  /** Own `$type`, else the nearest group's, else the alias target's; `"unknown"` when none applies. */
  readonly type: DTCGTokenType | "unknown";
  /**
   * The canonical value, aliases followed: a colour is a {@link DTCGColorObject} (a CSS colour string
   * refract can't parse to sRGB stays a string), a dimension/duration is `{ value, unit }`, a font weight
   * is a number, a composite has each field canonicalized. `undefined` for an external alias, or when
   * the value is invalid (see the graph's diagnostics).
   */
  readonly value: unknown;
  /** The `$value` as written. */
  readonly raw: unknown;
  /** The token the whole `$value` references (the direct target; follow it for a chain). */
  readonly alias?: string;
  /** The whole `$value` references a token absent from the document (`{color.brand}` → `color.brand`). */
  readonly external?: string;
  /** Every token this one references directly, including from inside a composite. */
  readonly references: readonly string[];
  readonly description?: string;
  /** Own `$deprecated`, else the nearest group's. */
  readonly deprecated?: boolean | string;
  readonly extensions?: Readonly<Record<string, unknown>>;
};

export type DTCGTokenGraph = {
  /** Tokens in document order. */
  readonly tokens: readonly DTCGGraphToken[];
  readonly byId: ReadonlyMap<string, DTCGGraphToken>;
  readonly diagnostics: readonly DTCGDiagnostic[];
  readonly description?: string;
  /** The document's top-level `$extensions`, untouched. */
  readonly extensions?: Readonly<Record<string, unknown>>;
};

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const isTokenNode = (v: unknown): v is Json => isObject(v) && "$value" in v;

const CURLY_REF = /^\{([^{}]+)\}$/;

/** A 2025.10 JSON Pointer reference: `{ "$ref": "#/color/brand/$value" }`. */
const isPointerRef = (v: unknown): v is { $ref: string } =>
  isObject(v) && typeof v.$ref === "string" && Object.keys(v).length === 1;

const pointerSegments = (pointer: string): string[] =>
  pointer
    .replace(/^#?\/?/, "")
    .split("/")
    .filter(s => s.length)
    .map(s => s.replace(/~1/g, "/").replace(/~0/g, "~"));

/** Font-weight names the 2025.10 spec allows, and the numeric weight each stands for. */
const FONT_WEIGHT_NAMES: Readonly<Record<string, number>> = {
  thin: 100, hairline: 100,
  "extra-light": 200, "ultra-light": 200,
  light: 300,
  normal: 400, regular: 400, book: 400,
  medium: 500,
  "semi-bold": 600, "demi-bold": 600,
  bold: 700,
  "extra-bold": 800, "ultra-bold": 800,
  black: 900, heavy: 900,
  "extra-black": 950, "ultra-black": 950,
};

/** The field types inside each composite type, so every field is canonicalized as its own type. */
const COMPOSITE_FIELDS: Readonly<Partial<Record<DTCGTokenType, Readonly<Record<string, DTCGTokenType>>>>> = {
  typography: { fontFamily: "fontFamily", fontSize: "dimension", fontWeight: "fontWeight", letterSpacing: "dimension", lineHeight: "number" },
  shadow: { color: "color", offsetX: "dimension", offsetY: "dimension", blur: "dimension", spread: "dimension" },
  border: { color: "color", width: "dimension", style: "strokeStyle" },
  transition: { duration: "duration", delay: "duration", timingFunction: "cubicBezier" },
  gradient: { color: "color", position: "number" },
};

const DIMENSION_UNITS = new Set(["px", "rem"]);
const DURATION_UNITS = new Set(["ms", "s"]);
const NUMBER_WITH_UNIT = /^(-?(?:\d+\.?\d*|\.\d+))([a-z%]*)$/i;

/** A canonical value plus its 2024-draft string form (what `parseDTCGDocument` hands to `fromDTCG`). */
type Resolved = { value: unknown; legacy: unknown };

/** Graph plus the per-token 2024-draft view; the latter stays internal to the `parseDTCGDocument` shim. */
export type DTCGGraphBuild = { graph: DTCGTokenGraph; legacy: ReadonlyMap<string, unknown> };

// --- $extends ---

/** Resolve every group `$extends` (deep merge: the target's members, then the group's own on top). */
const expandExtends = (doc: Json, diagnostics: DTCGDiagnostic[]): Json => {
  const groupAt = (root: Json, path: string[]): Json | undefined => {
    let node: unknown = root;
    for (const seg of path) {
      if (!isObject(node)) return undefined;
      node = node[seg];
    }
    return isObject(node) && !isTokenNode(node) ? node : undefined;
  };

  const merge = (base: Json, own: Json): Json => {
    const out: Json = { ...base };
    for (const [k, v] of Object.entries(own)) {
      const prev = out[k];
      out[k] = isObject(prev) && !isTokenNode(prev) && isObject(v) && !isTokenNode(v) ? merge(prev, v) : v;
    }
    return out;
  };

  const expanding = new Set<string>();
  const done = new Map<string, Json>();

  const expand = (node: Json, path: string[]): Json => {
    const id = path.join(".");
    const cached = done.get(id);
    if (cached) return cached;
    if (expanding.has(id)) {
      throw new RefractError("REFRACT_E_CYCLE", `Circular DTCG $extends at group "${id || "(root)"}"`);
    }
    expanding.add(id);

    let own: Json = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === "$extends") continue;
      own[k] = isObject(v) && !isTokenNode(v) && !k.startsWith("$") ? expand(v, [...path, k]) : v;
    }

    const ext = node.$extends;
    if (typeof ext === "string") {
      const curly = ext.match(CURLY_REF);
      const targetPath = curly ? curly[1].split(".") : pointerSegments(ext);
      const target = groupAt(doc, targetPath);
      if (target) {
        own = merge(expand(target, targetPath), own);
      } else {
        diagnostics.push({
          severity: "error",
          code: "extends-unresolved",
          path: id,
          message: `$extends "${ext}" does not name a group in this document`,
        });
      }
    }

    expanding.delete(id);
    done.set(id, own);
    return own;
  };

  return expand(doc, []);
};

// --- the walk ---

type Entry = { id: string; path: string[]; node: Json; groupType?: DTCGTokenType; groupDeprecated?: boolean | string };

const collect = (doc: Json): Entry[] => {
  const entries: Entry[] = [];
  const walk = (node: Json, path: string[], groupType?: DTCGTokenType, groupDeprecated?: boolean | string) => {
    const type = (node.$type as DTCGTokenType | undefined) ?? groupType;
    const deprecated = (node.$deprecated as boolean | string | undefined) ?? groupDeprecated;
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith("$") && key !== "$root") continue;
      if (!isObject(child)) continue;
      const childPath = [...path, key];
      if (isTokenNode(child)) {
        entries.push({ id: childPath.join("."), path: childPath, node: child, groupType: type, groupDeprecated: deprecated });
      } else if (key !== "$root") {
        walk(child, childPath, type, deprecated);
      }
    }
  };
  walk(doc, []);
  return entries;
};

/**
 * Parse a DTCG document into a {@link DTCGTokenGraph}, plus the internal 2024-draft view the
 * `parseDTCGDocument` shim needs. Throws `REFRACT_E_CYCLE` on a circular alias or `$extends`.
 */
export const buildDTCGGraph = (doc: DTCGDocument): DTCGGraphBuild => {
  const diagnostics: DTCGDiagnostic[] = [];
  const root = doc as unknown as Json;
  const expanded = expandExtends(root, diagnostics);
  const entries = collect(expanded);
  const entryById = new Map(entries.map(e => [e.id, e]));

  const report = (severity: DTCGDiagnostic["severity"], code: DTCGDiagnosticCode, path: string, message: string) =>
    diagnostics.push({ severity, code, path, message });

  const tokens = new Map<string, DTCGGraphToken>();
  const legacy = new Map<string, unknown>();
  const resolving = new Set<string>();

  type Ref = { id: string; sub: string[]; text: string; pointer: boolean };

  /** A reference string/object → the target token id plus a sub-path into its `$value` (pointers only). */
  const parseRef = (ref: unknown): Ref | undefined => {
    if (typeof ref === "string") {
      const m = ref.match(CURLY_REF);
      return m ? { id: m[1], sub: [], text: ref, pointer: false } : undefined;
    }
    if (isPointerRef(ref)) {
      const segs = pointerSegments(ref.$ref);
      const at = segs.indexOf("$value");
      return at < 0
        ? { id: segs.join("."), sub: [], text: ref.$ref, pointer: true }
        : { id: segs.slice(0, at).join("."), sub: segs.slice(at + 1), text: ref.$ref, pointer: true };
    }
    return undefined;
  };

  /** A `#/…` pointer can only name something in this document, so a missing target is an error. */
  const reportMissing = (from: string, ref: Ref, kept: string) =>
    ref.pointer
      ? report("error", "alias-unresolved", from, `$ref "${ref.text}" doesn't point at a token in this document`)
      : report("warning", "alias-unresolved", from, `reference "${ref.text}" has no target in this document; ${kept}`);

  const dig = (value: unknown, sub: string[]): unknown => {
    let v = value;
    for (const s of sub) {
      if (v === null || typeof v !== "object") return undefined;
      v = (v as Record<string, unknown>)[s];
    }
    return v;
  };

  /** A reference used inside a value: the target's canonical + legacy value (or the raw text when absent). */
  const resolveNested = (from: string, ref: Ref, refs: Set<string>, raw: unknown): Resolved => {
    if (!entryById.has(ref.id)) {
      reportMissing(from, ref, "kept as written");
      return ref.pointer ? { value: undefined, legacy: undefined } : { value: raw, legacy: raw };
    }
    refs.add(ref.id);
    const target = resolveToken(ref.id);
    return { value: dig(target.value, ref.sub), legacy: dig(legacy.get(ref.id), ref.sub) };
  };

  const canonical = (id: string, raw: unknown, type: DTCGTokenType | "unknown", refs: Set<string>): Resolved => {
    const ref = parseRef(raw);
    if (ref) return resolveNested(id, ref, refs, raw);

    const invalid = (why: string): Resolved => {
      report("error", "invalid-value", id, `${type} value ${JSON.stringify(raw)} ${why}`);
      return { value: undefined, legacy: raw };
    };

    switch (type) {
      case "color": {
        if (typeof raw === "string") return { value: colorStringToObject(raw) ?? raw, legacy: raw };
        if (!isObject(raw)) return invalid("is not a colour");
        const color = raw as unknown as DTCGColorObject;
        if (!DTCG_COLOR_SPACES.has(color.colorSpace)) return invalid(`has an unknown colorSpace`);
        if (!Array.isArray(color.components) || color.components.length !== 3) return invalid("needs three components");
        const rgb = colorObjectRgb(color);
        if (!rgb) {
          report("error", "color-space-unsupported", id,
            `colorSpace "${color.colorSpace}" can't be converted to sRGB and has no hex fallback`);
          return { value: color, legacy: undefined };
        }
        if (!NATIVE_COLOR_SPACES.has(color.colorSpace)) {
          report("warning", "color-space-fallback", id,
            `colorSpace "${color.colorSpace}" isn't converted natively; read through its hex fallback ${color.hex}`);
        }
        return { value: color, legacy: colorObjectToString(color, rgb) };
      }
      case "dimension":
      case "duration": {
        const units = type === "dimension" ? DIMENSION_UNITS : DURATION_UNITS;
        if (typeof raw === "number") {
          // 2024 docs sometimes wrote a bare number; read it as px / ms, as the importer always has.
          return { value: { value: raw, unit: type === "dimension" ? "px" : "ms" }, legacy: raw };
        }
        let value: number;
        let unit: string;
        if (typeof raw === "string") {
          const m = raw.trim().match(NUMBER_WITH_UNIT);
          if (!m) return invalid("isn't a number with a unit");
          value = Number(m[1]);
          unit = m[2] || (value === 0 ? (type === "dimension" ? "px" : "ms") : "");
          if (!unit) return invalid("has no unit");
        } else if (isObject(raw) && typeof raw.value === "number" && typeof raw.unit === "string") {
          value = raw.value;
          unit = raw.unit;
        } else {
          return invalid(`isn't { value, unit }`);
        }
        if (!units.has(unit)) {
          report("warning", "dimension-unit", id, `unit "${unit}" is outside the DTCG ${type} units (${[...units].join(", ")})`);
        }
        return { value: { value, unit }, legacy: typeof raw === "string" ? raw : `${value}${unit}` };
      }
      case "fontWeight": {
        if (typeof raw === "number") {
          return raw >= 1 && raw <= 1000 ? { value: raw, legacy: raw } : invalid("is outside 1–1000");
        }
        if (typeof raw === "string" && raw in FONT_WEIGHT_NAMES) return { value: FONT_WEIGHT_NAMES[raw], legacy: raw };
        return invalid("isn't 1–1000 or a DTCG weight name");
      }
      case "number":
        return typeof raw === "number" ? { value: raw, legacy: raw } : invalid("isn't a number");
      case "cubicBezier": {
        const ok = Array.isArray(raw) && raw.length === 4 && raw.every(n => typeof n === "number") &&
          raw[0] >= 0 && raw[0] <= 1 && raw[2] >= 0 && raw[2] <= 1;
        return ok ? { value: raw, legacy: raw } : invalid("isn't [x1, y1, x2, y2] with x in 0–1");
      }
      case "shadow":
      case "gradient":
        if (Array.isArray(raw)) {
          const parts = raw.map(layer => composite(id, layer, type, refs));
          return { value: parts.map(p => p.value), legacy: parts.map(p => p.legacy) };
        }
        return composite(id, raw, type, refs);
      case "typography":
      case "border":
      case "transition":
        return composite(id, raw, type, refs);
      default:
        // fontFamily, strokeStyle, unknown: carried as written.
        return { value: raw, legacy: raw };
    }
  };

  const composite = (id: string, raw: unknown, type: DTCGTokenType, refs: Set<string>): Resolved => {
    const ref = parseRef(raw);
    if (ref) return resolveNested(id, ref, refs, raw);
    if (!isObject(raw)) {
      report("error", "invalid-value", id, `${type} value ${JSON.stringify(raw)} isn't an object`);
      return { value: undefined, legacy: raw };
    }
    const fields = COMPOSITE_FIELDS[type] ?? {};
    const value: Json = {};
    const leg: Json = {};
    for (const [k, v] of Object.entries(raw)) {
      const fieldType = fields[k];
      // A 2024-draft lineHeight is sometimes a string ("1.5"); keep it rather than reject it.
      const r = fieldType && !(k === "lineHeight" && typeof v === "string")
        ? canonical(`${id}.${k}`, v, fieldType, refs)
        : (parseRef(v) ? resolveNested(id, parseRef(v)!, refs, v) : { value: v, legacy: v });
      value[k] = r.value;
      leg[k] = r.legacy;
    }
    return { value, legacy: leg };
  };

  /** Resolve one token (memoized; cycles throw). */
  const resolveToken = (id: string): DTCGGraphToken => {
    const done = tokens.get(id);
    if (done) return done;
    if (resolving.has(id)) {
      throw new RefractError("REFRACT_E_CYCLE", `Circular token reference: ${id}`);
    }
    resolving.add(id);

    const entry = entryById.get(id)!;
    const node = entry.node;
    const raw = node.$value;
    const declared = (node.$type as DTCGTokenType | undefined) ?? entry.groupType;
    const refs = new Set<string>();

    let type: DTCGTokenType | "unknown" = declared ?? "unknown";
    let value: unknown;
    let leg: unknown;
    let alias: string | undefined;
    let external: string | undefined;

    const whole = parseRef(raw);
    if (whole && !entryById.has(whole.id)) {
      // A curly alias to a token another document owns: kept as an external edge, never flattened.
      reportMissing(id, whole, "kept as an external reference");
      if (!whole.pointer) {
        external = whole.id;
        leg = raw;
      }
    } else if (whole) {
      const target = resolveToken(whole.id);
      refs.add(whole.id);
      alias = whole.id;
      if (declared && target.type !== "unknown" && declared !== target.type && whole.sub.length === 0) {
        report("warning", "type-mismatch", id, `declared ${declared} but its alias target ${whole.id} is ${target.type}`);
      }
      if (!declared && whole.sub.length === 0) type = target.type;
      value = dig(target.value, whole.sub);
      leg = dig(legacy.get(whole.id), whole.sub);
    } else {
      if (type === "unknown") report("error", "type-unknown", id, "no $type on the token, its groups, or an alias target");
      ({ value, legacy: leg } = canonical(id, raw, type, refs));
    }

    const token: DTCGGraphToken = {
      id,
      path: entry.path,
      type,
      value,
      raw,
      ...(alias ? { alias } : {}),
      ...(external ? { external } : {}),
      references: [...refs],
      ...(typeof node.$description === "string" ? { description: node.$description } : {}),
      ...((node.$deprecated ?? entry.groupDeprecated) !== undefined
        ? { deprecated: (node.$deprecated ?? entry.groupDeprecated) as boolean | string }
        : {}),
      ...(isObject(node.$extensions) ? { extensions: node.$extensions } : {}),
    };
    resolving.delete(id);
    tokens.set(id, token);
    legacy.set(id, leg);
    return token;
  };

  for (const e of entries) resolveToken(e.id);
  const ordered = entries.map(e => tokens.get(e.id)!);

  return {
    graph: {
      tokens: ordered,
      byId: new Map(ordered.map(t => [t.id, t])),
      diagnostics,
      ...(typeof root.$description === "string" ? { description: root.$description } : {}),
      ...(isObject(root.$extensions) ? { extensions: root.$extensions } : {}),
    },
    legacy,
  };
};

/**
 * Parse a DTCG document (2025.10, or the 2024 draft) into a typed token graph: canonical values,
 * alias edges, `$root` tokens, resolved `$extends`, JSON Pointer `$ref`s, preserved `$extensions`, and
 * a diagnostic for anything the spec doesn't allow. Throws `REFRACT_E_CYCLE` on a circular reference.
 */
export const parseDTCGGraph = (doc: DTCGDocument): DTCGTokenGraph => buildDTCGGraph(doc).graph;
