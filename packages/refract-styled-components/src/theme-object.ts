/**
 * The literal theme object (§8) — the SC target's replacement for CSS `:root` variables.
 *
 * `buildThemeData` walks the Model's property tokens into a nested `{ [subsystem]: { [camelKey]: literal } }`
 * tree (variants/extras fold into their group as camelCased keys — `primary` → `primaryText`), plus a
 * parallel `modes` tree (§10.3 appearance-mode overrides — only the fields a mode redefines). The object
 * **is** the indirection: values are resolved literals, no `var()`. The same data serves two sinks — a
 * live JS object for the runtime `theme` (recipes read it from styled-components context) and an
 * object-literal source string for `emit()`.
 *
 * Structured compound tokens (§15 shadow / transition `Ref.struct`) are **skipped** — the SC adapter's
 * structured composition is deferred, exactly as the prior stylesheet lane skipped their `:root` vars.
 */
import type { ThemeModel, Ref, Literal } from "@theme-registry/refract";
import { themeKey } from "./identifiers";

/** A resolved literal in the theme object: a number stays a number (`fontWeight`), a length/colour is a string. */
export type ThemeLiteral = string | number;
type ThemeTree = Record<string, Record<string, ThemeLiteral>>;
type ModesTree = Record<string, ThemeTree>;

export interface ThemeData {
  /** `subsystem → key → literal` (no `modes` / helpers — those are attached by the caller). */
  readonly tree: ThemeTree;
  /** `mode → subsystem → key → literal` — only the fields each mode redefines. */
  readonly modes: ModesTree;
  /** The mode names present (`["dark"]`), in first-seen order. */
  readonly modeNames: string[];
  /** Every dotted token path that made it into the tree (non-struct) — recipe refs check membership. */
  readonly tokenPaths: Set<string>;
  /** `mode → set of dotted token paths that carry an override` — the recipe scheme block reads this. */
  readonly modeOverridePaths: Record<string, Set<string>>;
}

/** Format one token `Ref` to its theme-object literal. Returns `undefined` for a structured token (skipped). */
const formatValue = (ref: Ref, path: string, resolve: (path: string) => Literal): ThemeLiteral | undefined => {
  if (ref.struct !== undefined) return undefined;
  if (ref.external !== undefined) return `var(${ref.external})`; // §W6b — the theme entry IS the parent var

  const raw: Literal = ref.value !== undefined ? ref.value : resolve(path);
  // §21: a length leaf carries its resolved unit — emit `value + unit` as a string. A unit-less number
  // (fontWeight / lineHeight / opacity) has no `unit` and stays a JS number, so the theme object types
  // it as `number`.
  if (ref.unit !== undefined) return `${raw}${ref.unit}`;
  return raw;
};

/** Walk the Model into the nested theme tree + modes tree. `resolve` fills in pure-alias tokens. */
export const buildThemeData = (model: ThemeModel, resolve: (path: string) => Literal): ThemeData => {
  const tree: ThemeTree = {};
  const modes: ModesTree = {};
  const modeNames: string[] = [];
  const tokenPaths = new Set<string>();
  const modeOverridePaths: Record<string, Set<string>> = {};

  const put = (subsystem: string, key: string, path: string, ref: Ref): void => {
    const value = formatValue(ref, path, resolve);
    if (value === undefined) return; // structured token — deferred
    (tree[subsystem] ??= {})[key] = value;
    tokenPaths.add(path);
  };

  for (const [subsystem, sub] of Object.entries(model.subsystems)) {
    for (const [property, pm] of Object.entries(sub.properties ?? {})) {
      put(subsystem, themeKey([property]), `${subsystem}.${property}`, pm.base);
      for (const [extra, ref] of Object.entries(pm.extras ?? {})) {
        put(subsystem, themeKey([property, extra]), `${subsystem}.${property}.${extra}`, ref);
      }
      for (const [variant, v] of Object.entries(pm.variants ?? {})) {
        put(subsystem, themeKey([property, variant]), `${subsystem}.${property}.${variant}`, v.base);
        // dec.3 — a variant's own extras map to `<property><Variant><Extra>` in the SC theme object.
        for (const [extra, ref] of Object.entries(v.extras ?? {})) {
          put(subsystem, themeKey([property, variant, extra]), `${subsystem}.${property}.${variant}.${extra}`, ref);
        }
      }
      // §10.3 appearance modes — a LIST of `{ mode, target?, overrides }`. Each field maps to the
      // property key (or a variant key when `target` scopes it); an extra field appends `<Extra>`.
      // The recipe scheme block re-reads exactly these paths.
      for (const entry of pm.modes ?? []) {
        const mode = entry.mode;
        if (mode === undefined) continue;
        const target = entry.target;
        const segments = target ? [property, target] : [property];
        const basePath = target ? `${subsystem}.${property}.${target}` : `${subsystem}.${property}`;
        for (const [field, ref] of Object.entries(entry.overrides ?? {})) {
          const value = formatValue(ref, `${subsystem}.${property}`, resolve);
          if (value === undefined) continue;
          const key = field === "base" ? themeKey(segments) : themeKey([...segments, field]);
          const path = field === "base" ? basePath : `${basePath}.${field}`;
          if (!modeNames.includes(mode)) modeNames.push(mode);
          (((modes[mode] ??= {})[subsystem] ??= {}))[key] = value;
          (modeOverridePaths[mode] ??= new Set()).add(path);
        }
      }
    }
  }

  return { tree, modes, modeNames, tokenPaths, modeOverridePaths };
};

// ---------------------------------------------------------------------------
// Serialization to object-literal source (emit)
// ---------------------------------------------------------------------------

const INDENT = "  ";

/** A theme literal → its JS source (`600` stays a number literal; a string is JSON-quoted). */
const literalSource = (value: ThemeLiteral): string =>
  typeof value === "number" ? String(value) : JSON.stringify(value);

const serializeLeafMap = (map: Record<string, ThemeLiteral>, depth: number): string => {
  const pad = INDENT.repeat(depth);
  const inner = INDENT.repeat(depth + 1);
  const entries = Object.entries(map).map(([k, v]) => `${inner}${k}: ${literalSource(v)},`);
  return `{\n${entries.join("\n")}\n${pad}}`;
};

const serializeTree = (tree: ThemeTree, depth: number): string[] =>
  Object.entries(tree).map(
    ([subsystem, map]) => `${INDENT.repeat(depth)}${subsystem}: ${serializeLeafMap(map, depth)},`,
  );

/**
 * Serialize the theme object literal body (the `{ … }`), including the subsystem trees, the optional
 * `modes` tree, and any trailing bare-identifier refs (`media`, `scheme`, helper fns) the caller wires.
 */
export const serializeThemeObject = (data: ThemeData, trailingRefs: string[]): string => {
  const lines: string[] = ["{"];
  lines.push(...serializeTree(data.tree, 1));

  if (data.modeNames.length) {
    lines.push(`${INDENT}modes: {`);
    for (const mode of data.modeNames) {
      lines.push(`${INDENT.repeat(2)}${mode}: {`);
      lines.push(...serializeTree(data.modes[mode], 3));
      lines.push(`${INDENT.repeat(2)}},`);
    }
    lines.push(`${INDENT}},`);
  }

  for (const ref of trailingRefs) lines.push(`${INDENT}${ref},`);
  lines.push("}");
  return lines.join("\n");
};

/**
 * Assemble the **live** runtime theme object: the token tree + `modes` + the wrapped `media` / `scheme`
 * tagged-template helpers + any opted-in color-math fns. This is what a consumer passes to
 * `<ThemeProvider>`; recipes read every value off it via styled-components context.
 */
export const buildRuntimeThemeObject = (
  data: ThemeData,
  attach: Record<string, unknown>,
): Record<string, unknown> => {
  const obj: Record<string, unknown> = {};
  for (const [subsystem, map] of Object.entries(data.tree)) obj[subsystem] = { ...map };
  if (data.modeNames.length) {
    const modes: Record<string, unknown> = {};
    for (const mode of data.modeNames) {
      const bySub: Record<string, unknown> = {};
      for (const [subsystem, map] of Object.entries(data.modes[mode])) bySub[subsystem] = { ...map };
      modes[mode] = bySub;
    }
    obj.modes = modes;
  }
  Object.assign(obj, attach);
  return obj;
};
