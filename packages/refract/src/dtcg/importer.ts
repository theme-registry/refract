import type { DTCGDocument } from "./types";
import type { DTCGDiagnostic, DTCGGraphToken, DTCGTokenGraph } from "./graph";
import { colorObjectRgb, colorObjectToString } from "./color";
import { RefractError } from "../core/errors";

/**
 * The importer contract — how a DTCG document becomes a raw theme.
 *
 * An importer is four hooks over the token graph: `parse` (document → graph), `place` (where a token
 * lands), `value` (what it holds there) and `finalize` (a last pass over the result). The engine
 * (`runImporter`) owns everything else: it calls the hooks, collects members into properties, picks
 * bases, renames collisions and writes the report, so no importer can drop a token silently.
 *
 * `defineImporter` fills each hook a spec leaves out from the importer it extends (the default
 * `dtcgImporter` unless `extends` says otherwise); a hook it does give receives that importer's hook as
 * `next`, so an override changes one rule and hands the rest back.
 */

type RawThemeInput = Record<string, unknown>;

/** The importer contract version an {@link ImporterSpec} pins to, like `AdapterSpec.version`. */
export const IMPORTER_CONTRACT_VERSION = 1;

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

/** A token left out, and why. `place` and `value` return one instead of a placement or a value. */
export type ImportSkip = { readonly skip: string };

/** Where `place` puts a token. */
export type ImportPlacement =
  /** A member of a subsystem property; `member: "$root"` is the property's base. */
  | { readonly kind: "token"; readonly subsystem: DTCGImportSubsystem; readonly property: string; readonly member: string }
  /** A colour borrowed from the parent theme (`external`), for an alias to another document's token. */
  | { readonly kind: "external"; readonly property: string; readonly target: string }
  /** A breakpoint, its value in px. */
  | { readonly kind: "breakpoint"; readonly name: string }
  /** A typography recipe (`typography.recipes.<group>.<name>`), its value the recipe's fields. */
  | { readonly kind: "recipe"; readonly group: string; readonly name: string };

/** What every hook can read and record. */
export type ImportContext = {
  readonly doc: DTCGDocument;
  readonly options: Readonly<FromDTCGOptions>;
  /** The parsed graph (throws inside `parse`, before it exists). */
  readonly graph: DTCGTokenGraph;
  /**
   * Where a token landed, as its final refract path (`colors.brand`, `colors.brand.hover`), or
   * `undefined` when it didn't. Composite tokens are read after every other token, so their
   * references are final.
   */
  placed(id: string): string | undefined;
  /** A token's value in the 2024-draft string form (`#hex` / `rgba()` for a colour), composites field by field. */
  cssValue(id: string): unknown;
  /**
   * Add a member to a property other than the current token's own (a border's style, a text style's
   * font size, a shadow's colour). Returns the name it was stored under, renamed when taken.
   */
  add(subsystem: DTCGImportSubsystem, property: string, member: string, value: unknown): string;
  /** When the property ends with no `$root` or `base` member, take this base instead of choosing a member. */
  baseFallback(subsystem: DTCGImportSubsystem, property: string, value: unknown): void;
  /** Add a note about the current token to the report. */
  note(message: string): void;
};

/** A complete importer: every hook present. Build one with {@link defineImporter}. */
export type Importer = {
  readonly name: string;
  readonly version: number;
  parse(doc: DTCGDocument, ctx: ImportContext): DTCGTokenGraph;
  place(token: DTCGGraphToken, ctx: ImportContext): ImportPlacement | ImportSkip;
  value(token: DTCGGraphToken, placement: ImportPlacement, ctx: ImportContext): unknown;
  finalize(result: DTCGImportResult, ctx: ImportContext): DTCGImportResult;
};

/** An importer as authored: identity plus any hooks to override, each handed the extended importer's as `next`. */
export type ImporterSpec = {
  readonly name: string;
  /** The contract version this importer was written against: {@link IMPORTER_CONTRACT_VERSION}. */
  readonly version: number;
  /** The importer whose hooks fill the gaps and serve as `next` (default: `dtcgImporter`). */
  readonly extends?: Importer;
  parse?(doc: DTCGDocument, ctx: ImportContext, next: (doc: DTCGDocument) => DTCGTokenGraph): DTCGTokenGraph;
  place?(
    token: DTCGGraphToken,
    ctx: ImportContext,
    next: (token: DTCGGraphToken) => ImportPlacement | ImportSkip,
  ): ImportPlacement | ImportSkip;
  value?(
    token: DTCGGraphToken,
    placement: ImportPlacement,
    ctx: ImportContext,
    next: (token: DTCGGraphToken, placement: ImportPlacement) => unknown,
  ): unknown;
  finalize?(
    result: DTCGImportResult,
    ctx: ImportContext,
    next: (result: DTCGImportResult) => DTCGImportResult,
  ): DTCGImportResult;
};

export const isImportSkip = (v: unknown): v is ImportSkip =>
  typeof v === "object" && v !== null && typeof (v as ImportSkip).skip === "string" && Object.keys(v).length === 1;

/** Is `v` a complete {@link Importer} (what a `--importer` module must export)? */
export const isImporter = (v: unknown): v is Importer => {
  const i = v as Importer | undefined;
  return (
    !!i && typeof i.name === "string" && typeof i.version === "number" &&
    typeof i.parse === "function" && typeof i.place === "function" &&
    typeof i.value === "function" && typeof i.finalize === "function"
  );
};

/**
 * Complete an {@link ImporterSpec} into an {@link Importer}: each missing hook comes from `base`, each
 * given one is called with `base`'s as `next`.
 */
export const extendImporter = (base: Importer, spec: ImporterSpec): Importer => ({
  name: spec.name,
  version: spec.version,
  parse: spec.parse ? (doc, ctx) => spec.parse!(doc, ctx, d => base.parse(d, ctx)) : base.parse,
  place: spec.place ? (t, ctx) => spec.place!(t, ctx, x => base.place(x, ctx)) : base.place,
  value: spec.value ? (t, p, ctx) => spec.value!(t, p, ctx, (x, q) => base.value(x, q, ctx)) : base.value,
  finalize: spec.finalize ? (r, ctx) => spec.finalize!(r, ctx, x => base.finalize(x, ctx)) : base.finalize,
});

// --- the engine ---

/**
 * Where a graph carries its 2024-string view. A registry symbol rather than module state: an importer
 * loaded with `--importer` imports the package's `./dtcg`, while the CLI runs its own bundled copy of
 * this engine, and both must see the view. Enumerable, so a `parse` that spreads the graph keeps it.
 */
const LEGACY_VIEW = Symbol.for("@theme-registry/refract.dtcg.legacyView");

/** Attach a graph's 2024-string view, so `ctx.cssValue` returns values as written. Returns the graph. */
export const withLegacyView = (graph: DTCGTokenGraph, legacy: ReadonlyMap<string, unknown>): DTCGTokenGraph =>
  Object.assign(graph, { [LEGACY_VIEW]: legacy });

const legacyViewOf = (graph: DTCGTokenGraph | undefined): ReadonlyMap<string, unknown> | undefined =>
  (graph as { [LEGACY_VIEW]?: ReadonlyMap<string, unknown> } | undefined)?.[LEGACY_VIEW];

/** Composite types: read after every other token, since their fields reference where those landed. */
const COMPOSITE_TYPES = new Set(["shadow", "typography", "border", "transition", "gradient"]);

const naturalOrder = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });

const SUBSYSTEM_ORDER: readonly DTCGImportSubsystem[] = ["colors", "typography", "effects", "borders", "layout", "animation"];

type Member = { value: unknown; id?: string };
type Bucket = {
  sub: DTCGImportSubsystem;
  prop: string;
  root?: Member;
  variants: Map<string, Member>;
  external?: string;
  /** The base to take when no `$root` or `base` member exists, instead of choosing one. */
  fallback?: { value: unknown };
};

const fail = (message: string): never => {
  throw new RefractError("REFRACT_E_IMPORTER", message);
};

/**
 * Run an importer over a DTCG document: its hooks place and convert each token, the engine assembles
 * the raw theme and the report. Throws `REFRACT_E_IMPORTER` on an importer written against another
 * contract version.
 */
export const runImporter = (importer: Importer, doc: DTCGDocument, options: FromDTCGOptions = {}): DTCGImportResult => {
  if (!isImporter(importer)) fail("Not an importer: build one with defineImporter({ name, version, … }).");
  if (importer.version !== IMPORTER_CONTRACT_VERSION) {
    fail(
      `Importer "${importer.name}" targets importer contract version ${importer.version}; this build ` +
        `runs version ${IMPORTER_CONTRACT_VERSION}.`,
    );
  }

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
  const addMember = (b: Bucket, name: string, value: unknown, id: string | undefined, path: string): string => {
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
      renamed.push({ path, from: final, to });
      final = to;
    }
    b.variants.set(final, { value, id });
    if (id) placements[id] = `${b.sub}.${b.prop}.${final}`;
    return final;
  };

  /** A placed token's final path: a `base` member is the property itself once no `$root` exists. */
  const finalPath = (id: string): string | undefined => {
    const at = placements[id];
    if (!at || !at.endsWith(".base")) return at;
    const b = buckets.get(at.slice(0, -".base".length));
    return b && !b.root && b.variants.get("base")?.id === id ? `${b.sub}.${b.prop}` : at;
  };

  let current: DTCGGraphToken | undefined;
  let graph: DTCGTokenGraph | undefined;
  const ctx: ImportContext = {
    doc,
    options,
    get graph() {
      return graph ?? fail("ctx.graph isn't available inside parse.");
    },
    placed: finalPath,
    cssValue(id) {
      const legacy = legacyViewOf(graph);
      if (legacy?.has(id)) return legacy.get(id);
      const t = graph?.byId.get(id);
      const v = t?.value as { colorSpace?: unknown } | undefined;
      if (t?.type === "color" && v && typeof v === "object" && typeof v.colorSpace === "string") {
        const rgb = colorObjectRgb(v as never);
        return rgb ? colorObjectToString(v as never, rgb) : undefined;
      }
      return t?.value;
    },
    add: (sub, prop, member, value) => addMember(bucket(sub, prop), member, value, undefined, current?.id ?? `${sub}.${prop}`),
    baseFallback(sub, prop, value) {
      bucket(sub, prop).fallback = { value };
    },
    note(message) {
      notes.push({ path: current?.id ?? "(document)", message });
    },
  };

  graph = importer.parse(doc, ctx);

  const breakpoints: Record<string, number> = {};
  let breakpointsFromDoc = false;
  const recipes: Record<string, Record<string, unknown>> = {};

  const read = (t: DTCGGraphToken) => {
    current = t;
    const where = importer.place(t, ctx);
    if (isImportSkip(where)) {
      unmapped.push({ path: t.id, reason: where.skip });
      return;
    }
    if (where.kind === "breakpoint") breakpointsFromDoc = true;
    if (where.kind === "external") {
      bucket("colors", where.property).external = where.target;
      placements[t.id] = `colors.${where.property}`;
      return;
    }
    const value = importer.value(t, where, ctx);
    if (isImportSkip(value)) {
      unmapped.push({ path: t.id, reason: value.skip });
      return;
    }
    if (value === undefined) {
      unmapped.push({ path: t.id, reason: `${t.type} value can't be read (see diagnostics)` });
      return;
    }
    switch (where.kind) {
      case "token":
        addMember(bucket(where.subsystem, where.property), where.member, value, t.id, t.id);
        break;
      case "breakpoint":
        if (typeof value !== "number") {
          unmapped.push({ path: t.id, reason: "breakpoint value isn't a number of px" });
          return;
        }
        breakpoints[where.name] = value;
        placements[t.id] = `breakpoints.${where.name}`;
        break;
      case "recipe": {
        const block = (recipes[where.group] ??= {});
        let final = where.name;
        if (block[final]) {
          let n = 2;
          while (block[`${where.name}-${n}`]) n++;
          final = `${where.name}-${n}`;
          renamed.push({ path: t.id, from: where.name, to: final });
        }
        block[final] = value;
        placements[t.id] = `typography.recipes.${where.group}.${final}`;
        break;
      }
    }
  };

  for (const t of graph.tokens) if (!COMPOSITE_TYPES.has(t.type)) read(t);
  for (const t of graph.tokens) if (COMPOSITE_TYPES.has(t.type)) read(t);
  current = undefined;

  // Finalize each bucket into a raw property, recording placements and any chosen base.
  const finalize = (b: Bucket): Record<string, unknown> => {
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
    } else if (b.fallback) {
      base = b.fallback.value;
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
    return {
      base,
      ...(b.sub === "colors" ? { tones: false } : {}),
      ...(Object.keys(variants).length ? { variants } : {}),
    };
  };

  // Assemble the raw theme. A breakpoint group in the document replaces the `breakpoints` option.
  const raw: RawThemeInput = {};
  const bp = breakpointsFromDoc ? breakpoints : { ...(options.breakpoints ?? {}) };
  if (Object.keys(bp).length) raw.breakpoints = bp;
  for (const sub of SUBSYSTEM_ORDER) {
    const props: Record<string, unknown> = {};
    for (const b of [...buckets.values()].filter(x => x.sub === sub).sort((a, c) => naturalOrder(a.prop, c.prop))) {
      props[b.prop] = finalize(b);
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

  return importer.finalize(
    {
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
    },
    ctx,
  );
};
