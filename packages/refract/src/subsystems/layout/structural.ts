/**
 * Layout structural generators → **Model rule-sets** (the clean-room payoff).
 *
 * `columns` / `grids` / `stacks` / `container` used to emit `CssNode[]` that a lossless
 * node↔rule-set codec (`routeLayoutStructuralThroughModel`) round-tripped into the Model.
 * Here the generators emit {@link RuleSetGroup}s **natively** — declarations carry token-path
 * {@link Ref}s (`layout.spacing.relaxed`), never `var(--…)` — so the codec never exists. The CSS
 * adapter lowers these rule-sets to `CssRuleNode[]` (columns/grids/stacks via `lowerRecipeGroup`,
 * container via the two-pass `lowerContainerGroup`, matching the old unshift-bases/push-medias order).
 *
 * The columns/container config knobs (`--…-columns--size`, `--…-container--inset`, …) ride along as
 * **layout property tokens** (`configProperties`, merged as `extraProperties` in the Model); the
 * structural rule declarations reference those config tokens by path (`layout.container--inset`),
 * exactly the two-level indirection the old generators produced. Math ported verbatim from the old
 * `subsystems/layout/tokens.ts`; only the output shape (rule-sets, not CSS) differs.
 *
 * The math forms variant keys from raw breakpoint keys + span numbers (`col-sm-3`); the adapter
 * prepends the class prefix + sanitizes. No CSS syntax is produced here — core stays format-neutral.
 */
import type { PropertyModel, Ref, RuleSet, RuleSetGroup, RuleSetOverride } from "../../core/model";
import { type MediaConfig, formatWidth, resolveMediaConfig } from "../../core/media";
import type {
  ColumnsValue,
  ContainerConfig,
  GridsDefinition,
  StacksDefinition,
} from "./types";

/** The structural output: rule-set groups (for the Model + CSS) + config `:root` tokens. */
export type LayoutStructuralOutput = {
  ruleSetGroups: Record<string, RuleSetGroup>;
  configProperties: Record<string, PropertyModel>;
};

// --- token-path ref helpers (no CSS) ---

/** A spacing token ref: `layout.spacing` for `"base"`, else `layout.spacing.<variant>`. */
const spacingRef = (variant: string): Ref => ({
  ref: variant === "base" ? "layout.spacing" : `layout.spacing.${variant}`,
});
/** A gutters token ref: `layout.gutters` for `"base"`, else `layout.gutters.<variant>`. */
const guttersRef = (variant: string): Ref => ({
  ref: variant === "base" ? "layout.gutters" : `layout.gutters.${variant}`,
});
/** A sizes token ref (§22): `layout.sizes` for `"base"`, else `layout.sizes.<variant>`. */
const sizesRef = (variant: string): Ref => ({
  ref: variant === "base" ? "layout.sizes" : `layout.sizes.${variant}`,
});
/** A ref to a structural config token (`layout.<key>`, e.g. `layout.container--inset`). */
const configRef = (key: string): Ref => ({ ref: `layout.${key}` });
const literal = (value: string | number): Ref => ({ value });

const sortByWidth = (breakpoints: Record<string, number>): string[] =>
  Object.keys(breakpoints).sort((a, b) => breakpoints[a] - breakpoints[b]);

// ---------------------------------------------------------------------------
// Columns — `kind: "utility"`, one rule-set per (span × breakpoint)
// ---------------------------------------------------------------------------

export const buildColumns = (
  input: ColumnsValue | undefined,
  breakpoints: Record<string, number>,
): LayoutStructuralOutput | undefined => {
  if (!input) return undefined;
  const config = typeof input === "number" ? { size: input } : input;
  const size = config.size;
  const gutterRef = config.gutter ?? "base";
  const insetRef = config.inset ?? "none";

  const configProperties: Record<string, PropertyModel> = {
    "columns--size": { base: literal(String(size)) },
    "columns--gutter": { base: guttersRef(gutterRef) },
    "columns--inset": { base: spacingRef(insetRef) },
  };

  const group: RuleSetGroup = {};
  const spans = Array.from({ length: size }, (_, i) => i + 1);
  for (const key of sortByWidth(breakpoints)) {
    for (const span of spans) {
      const colVariant = `col-${key}-${span}`;
      const offsetVariant = `offset-${key}-${span}`;
      const colDecl: Record<string, Ref> = { "grid-column-end": literal(`span ${span}`) };
      const offsetDecl: Record<string, Ref> = { "grid-column-start": literal(String(span + 1)) };

      if (breakpoints[key] === 0) {
        group[colVariant] = { kind: "utility", declarations: colDecl, overrides: [] };
        group[offsetVariant] = { kind: "utility", declarations: offsetDecl, overrides: [] };
      } else {
        group[colVariant] = {
          kind: "utility",
          declarations: {},
          overrides: [{ breakpoint: key, query: "min", declarations: colDecl }],
        };
        group[offsetVariant] = {
          kind: "utility",
          declarations: {},
          overrides: [{ breakpoint: key, query: "min", declarations: offsetDecl }],
        };
      }
    }
  }

  return { ruleSetGroups: { columns: group }, configProperties };
};

// ---------------------------------------------------------------------------
// Grids — `kind: "recipe"`, one rule-set per grid
// ---------------------------------------------------------------------------

/** The grid declaration props (in emission order) that pass through as literals. */
const GRID_LITERAL_PROPS: ReadonlyArray<[keyof GridsDefinition[string], string]> = [
  ["templateColumns", "grid-template-columns"],
  ["templateRows", "grid-template-rows"],
  ["autoRows", "grid-auto-rows"],
  ["autoColumns", "grid-auto-columns"],
  ["justifyItems", "justify-items"],
  ["alignItems", "align-items"],
  ["justifyContent", "justify-content"],
  ["alignContent", "align-content"],
];

const gridDeclarations = (
  grid: Record<string, unknown>,
  includeDisplay: boolean,
): Record<string, Ref> => {
  const decls: Record<string, Ref> = {};
  if (includeDisplay) decls["display"] = literal("grid");
  for (const [key, cssProperty] of GRID_LITERAL_PROPS) {
    const value = grid[key as string];
    if (value) decls[cssProperty] = literal(value as string);
  }
  if (grid.gap) decls["gap"] = spacingRef(grid.gap as string);
  return decls;
};

export const buildGrids = (
  grids: GridsDefinition | undefined,
): LayoutStructuralOutput | undefined => {
  if (!grids || !Object.keys(grids).length) return undefined;
  const group: RuleSetGroup = {};

  for (const [name, grid] of Object.entries(grids)) {
    const declarations = gridDeclarations(grid, true);
    const overrides: RuleSetOverride[] = [];
    for (const entry of grid.responsive ?? []) {
      const respDecls = gridDeclarations(entry, false);
      if (Object.keys(respDecls).length) {
        overrides.push({ breakpoint: entry.breakpoint, query: entry.query ?? "exact", declarations: respDecls });
      }
    }
    group[`grid-${name}`] = { kind: "recipe", declarations, overrides };
  }

  return { ruleSetGroups: { grids: group }, configProperties: {} };
};

// ---------------------------------------------------------------------------
// Stacks — `kind: "recipe"`, one rule-set per stack
// ---------------------------------------------------------------------------

export const buildStacks = (
  stacks: StacksDefinition | undefined,
): LayoutStructuralOutput | undefined => {
  if (!stacks || !Object.keys(stacks).length) return undefined;
  const group: RuleSetGroup = {};

  for (const [name, stack] of Object.entries(stacks)) {
    const declarations: Record<string, Ref> = {
      display: literal(stack.inline ? "inline-flex" : "flex"),
      "flex-direction": literal(stack.direction ?? "column"),
    };
    if (stack.align) declarations["align-items"] = literal(stack.align);
    if (stack.justify) declarations["justify-content"] = literal(stack.justify);
    if (stack.wrap) declarations["flex-wrap"] = literal(stack.wrap);
    if (stack.gap) declarations["gap"] = spacingRef(stack.gap);

    const overrides: RuleSetOverride[] = [];
    for (const entry of stack.responsive ?? []) {
      const respDecls: Record<string, Ref> = {};
      if (entry.inline !== undefined) respDecls["display"] = literal(entry.inline ? "inline-flex" : "flex");
      if (entry.direction) respDecls["flex-direction"] = literal(entry.direction);
      if (entry.align) respDecls["align-items"] = literal(entry.align);
      if (entry.justify) respDecls["justify-content"] = literal(entry.justify);
      if (entry.wrap) respDecls["flex-wrap"] = literal(entry.wrap);
      if (Object.keys(respDecls).length) {
        overrides.push({ breakpoint: entry.breakpoint, query: entry.query ?? "exact", declarations: respDecls });
      }
    }
    group[`stack-${name}`] = { kind: "recipe", declarations, overrides };
  }

  return { ruleSetGroups: { stacks: group }, configProperties: {} };
};

// ---------------------------------------------------------------------------
// Container — `kind: "recipe"`; always emits a default container (matches the old generator)
// ---------------------------------------------------------------------------

const resolveContainerConfig = (raw: unknown): ContainerConfig => {
  if (!raw || typeof raw === "string") return { mode: (raw as string) ?? "fixed" };
  const obj = raw as Record<string, unknown>;
  return {
    mode: (obj.base as string) ?? "fixed",
    inset: obj.inset as string | undefined,
    gutter: obj.gutter as string | undefined,
    direction: obj.direction as string | undefined,
    align: obj.align as string | undefined,
    justify: obj.justify as string | undefined,
    maxWidth: obj.maxWidth as string | number | undefined,
  };
};

/**
 * Container rule-sets + config tokens. Emitted in **processing order** (base first, then each
 * variant); the adapter's `lowerContainerGroup` reverses for bases and keeps medias forward, which
 * reproduces the old generator's `unshift`(bases)/`push`(medias) node stream byte-for-byte.
 * Runs even with no `container` config (defaults to `"fixed"`) — the old generator did too.
 */
/**
 * Resolve a **fluid** container's max-width cap (§22 D4). A string naming an authored `sizes` variant →
 * a unit-aware `layout.sizes.*` ref (the recommended path — flip the theme to rem and the cap follows);
 * a breakpoint name → that breakpoint's px width; any other string → a raw literal (`"80rem"`, `calc()`).
 * A bare **number** stays a `${n}px` literal — an intentional "exactly this" escape (reference a `sizes`
 * token for unit-awareness). Size names win over breakpoint names on collision (a cap is a size concept).
 */
const resolveFluidMaxWidth = (
  value: string | number,
  sizeNames: ReadonlySet<string>,
  breakpoints: Record<string, number>,
): Ref => {
  if (typeof value === "number") return literal(`${value}px`);
  if (sizeNames.has(value)) return sizesRef(value);
  if (breakpoints[value] !== undefined) return literal(`${breakpoints[value]}px`);
  return literal(value);
};

/** The authored `sizes` variant names (plus `base`) — for disambiguating a fluid container cap (§22 D4). */
const collectSizeNames = (sizes: unknown): Set<string> => {
  const names = new Set<string>();
  if (sizes && typeof sizes === "object" && !Array.isArray(sizes)) {
    const obj = sizes as Record<string, unknown>;
    if ("base" in obj) names.add("base");
    const variants = obj.variants as Record<string, unknown> | undefined;
    if (variants && typeof variants === "object") for (const k of Object.keys(variants)) names.add(k);
  }
  return names;
};

export const buildContainer = (
  containerInput: unknown,
  breakpoints: Record<string, number>,
  sizeNames: ReadonlySet<string> = new Set(),
  mediaConfig?: MediaConfig,
): LayoutStructuralOutput => {
  // Fixed-container max-widths are breakpoint-DERIVED, so they format in the same px/em/rem unit the
  // `@media` thresholds use (§10.5) — NOT the §21 declaration-`units` axis. `formatWidth` is the shared
  // threshold formatter, so a fixed container stays aligned with where its breakpoints fire.
  const resolvedMedia = resolveMediaConfig(mediaConfig);
  const mediaLen = (value: number): string => formatWidth(value, resolvedMedia);
  const configProperties: Record<string, PropertyModel> = {};
  const group: RuleSetGroup = {};
  const sortedKeys = sortByWidth(breakpoints);

  const extended =
    containerInput && typeof containerInput === "object"
      ? (containerInput as Record<string, unknown>)
      : undefined;

  const baseConfig: ContainerConfig = extended
    ? {
        mode: (extended.base as string) ?? "fixed",
        inset: extended.inset as string | undefined,
        gutter: extended.gutter as string | undefined,
        direction: extended.direction as string | undefined,
        align: extended.align as string | undefined,
        justify: extended.justify as string | undefined,
        maxWidth: extended.maxWidth as string | number | undefined,
      }
    : resolveContainerConfig(containerInput ?? "fixed");
  const variants = (extended?.variants as Record<string, unknown>) ?? {};
  const responsiveEntries = (extended?.responsive as Array<Record<string, unknown>>) ?? [];

  const variantKeyFor = (name: string | null): string =>
    name ? `container-${name}` : "container";

  const buildSingleContainer = (name: string | null, config: ContainerConfig): void => {
    const suffix = name ? `--${name}` : "";
    const insetKey = `container${suffix}--inset`;
    const gutterKey = `container${suffix}--gutter`;

    const insetRef = config.inset ?? baseConfig.inset ?? "base";
    const gutterRef = config.gutter ?? baseConfig.gutter;
    const mode = config.mode ?? baseConfig.mode ?? "fixed";
    const direction = config.direction ?? baseConfig.direction;
    const align = config.align ?? baseConfig.align;
    const justify = config.justify ?? baseConfig.justify;
    const maxWidthValue = config.maxWidth ?? (name ? baseConfig.maxWidth : undefined);

    configProperties[insetKey] = { base: spacingRef(insetRef) };
    if (gutterRef) configProperties[gutterKey] = { base: guttersRef(gutterRef) };

    const declarations: Record<string, Ref> = {
      "box-sizing": literal("border-box"),
      width: literal("100%"),
      "margin-left": literal("auto"),
      "margin-right": literal("auto"),
      "padding-left": configRef(insetKey),
      "padding-right": configRef(insetKey),
    };
    if (gutterRef) declarations["gap"] = configRef(gutterKey);
    if (direction) {
      declarations["display"] = literal("flex");
      declarations["flex-direction"] = literal(direction);
    }
    if (align) declarations["align-items"] = literal(align);
    if (justify) declarations["justify-content"] = literal(justify);

    const overrides: RuleSetOverride[] = [];
    if (mode === "fixed") {
      const maxBp =
        typeof maxWidthValue === "string" && breakpoints[maxWidthValue] !== undefined
          ? maxWidthValue
          : undefined;
      const maxBpIndex = maxBp ? sortedKeys.indexOf(maxBp) : -1;

      for (let i = 0; i < sortedKeys.length; i++) {
        const key = sortedKeys[i];
        const refKey = maxBpIndex >= 0 && i > maxBpIndex ? maxBp! : key;
        const width = breakpoints[refKey];
        if (width === 0) {
          if (i === 0) declarations["max-width"] = literal("none");
          continue;
        }
        if (i === 0) {
          declarations["max-width"] = literal(mediaLen(width));
        } else {
          overrides.push({ breakpoint: key, query: "min", declarations: { "max-width": literal(mediaLen(width)) } });
        }
      }
    } else if (mode === "fluid") {
      if (maxWidthValue !== undefined) {
        declarations["max-width"] = resolveFluidMaxWidth(maxWidthValue, sizeNames, breakpoints);
      }
    } else {
      declarations["max-width"] = literal(typeof mode === "number" ? `${mode}px` : mode);
    }

    group[variantKeyFor(name)] = { kind: "recipe", declarations, overrides };
  };

  buildSingleContainer(null, baseConfig);
  for (const [name, raw] of Object.entries(variants)) {
    buildSingleContainer(name, resolveContainerConfig(raw));
  }

  // Top-level responsive entries layer media overrides onto the base/target container.
  // (Not exercised by the current fixtures; kept for parity with the old generator.)
  for (const entry of responsiveEntries) {
    const target = entry.target as string | undefined;
    const variantKey = variantKeyFor(target ?? null);
    const ruleSet = group[variantKey];
    if (!ruleSet) continue;

    const declarations: Record<string, Ref> = {};
    if (entry.direction) declarations["flex-direction"] = literal(entry.direction as string);
    if (entry.align) declarations["align-items"] = literal(entry.align as string);
    if (entry.justify) declarations["justify-content"] = literal(entry.justify as string);
    if (entry.inset) {
      const insetKey = target ? `container--${target}--inset` : "container--inset";
      declarations["padding-left"] = configRef(insetKey);
      declarations["padding-right"] = configRef(insetKey);
    }
    if (entry.gutter) {
      const gutterKey = target ? `container--${target}--gutter` : "container--gutter";
      declarations["gap"] = configRef(gutterKey);
    }
    if (Object.keys(declarations).length) {
      ruleSet.overrides.push({
        breakpoint: entry.breakpoint as string,
        query: (entry.query as "min" | "max" | "exact") ?? "exact",
        declarations,
      });
    }
  }

  return { ruleSetGroups: { container: group }, configProperties };
};

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Run all four structural generators over the raw layout slice, merging their rule-set groups
 * (structural order: columns → grids → stacks → container) and config tokens. Container always
 * runs; the rest run only when their raw key is present.
 */
export const buildLayoutStructural = (
  rawSlice: Record<string, unknown>,
  breakpoints: Record<string, number>,
  mediaConfig?: MediaConfig,
): LayoutStructuralOutput => {
  const ruleSetGroups: Record<string, RuleSetGroup> = {};
  const configProperties: Record<string, PropertyModel> = {};

  const merge = (out: LayoutStructuralOutput | undefined): void => {
    if (!out) return;
    Object.assign(ruleSetGroups, out.ruleSetGroups);
    Object.assign(configProperties, out.configProperties);
  };

  merge(buildColumns(rawSlice.columns as ColumnsValue | undefined, breakpoints));
  merge(buildGrids(rawSlice.grids as GridsDefinition | undefined));
  merge(buildStacks(rawSlice.stacks as StacksDefinition | undefined));
  merge(buildContainer(rawSlice.container, breakpoints, collectSizeNames(rawSlice.sizes), mediaConfig));

  return { ruleSetGroups, configProperties };
};
