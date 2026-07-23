/**
 * CSS lowering of the format-neutral Model → `CssNode[]`.
 *
 * Variable-node lowering (naming + value formatting + responsive expansion) and recipe-rule
 * lowering (a **forward** lowering — the Model rule-sets go straight to `CssRuleNode[]`, no
 * `generateRecipeCss` round-trip) both live here. Refs carry canonical token paths; a
 * `pathToVar` map turns each into its `var(--…)`. Byte-parity with the former token-based path
 * is the golden gate.
 */
import type {
  ContainerModel,
  Keyframe,
  MergedRuleSet,
  PropertyModel,
  PropertyResponsiveOverride,
  Ref,
  RuleSet,
  RuleSetGroup,
  RuleSetOverride,
  ShadowLayer,
  TransitionPart,
} from "@theme-registry/refract";
import type { ShadowDimension } from "@theme-registry/refract";
import type { ContainerDescriptors, MediaDescriptor, MediaVariant } from "@theme-registry/refract";
import type { CssDeclaration, CssKeyframesNode, CssRuleNode, CssVariablesNode } from "./nodes";
import type { VarNamer } from "./naming";

const str = (value: unknown): string => (value == null ? "" : String(value));

/**
 * A resolved length leaf → CSS text (§21). Units are baked into the Model by `resolveModelUnits`, so a
 * text adapter only concatenates: `unit` present → `<value><unit>`; absent → the bare value (unit-less
 * numbers like opacity, or a raw-string escape / keyword). Struct (shadow/transition) is composed by
 * its subsystem before this is reached.
 */
const dimensionCss = (ref: Ref): string =>
  ref.unit !== undefined ? `${ref.value}${ref.unit}` : str(ref.value);

/** A shadow geometry field ({@link ShadowDimension}) → CSS text — pinned `{value,unit}` or a bare number. */
const shadowDimCss = (dim: ShadowDimension): string =>
  typeof dim === "number" ? String(dim) : `${dim.value}${dim.unit}`;

const DEFAULT_RESPONSIVE_QUERY: MediaVariant = "exact";

// ---------------------------------------------------------------------------
// Shared responsive expansion (property variables)
// ---------------------------------------------------------------------------

type ResolveVariableName = (property: string, variant?: string, field?: string) => string;

const resolveMediaQuery = <TBreakpoint extends string>(
  media: MediaDescriptor<TBreakpoint>,
  breakpoint: TBreakpoint,
  query: MediaVariant,
  orientation?: "portrait" | "landscape",
): string => {
  if (!orientation) {
    const group = media[breakpoint];
    return group?.[query] ?? "";
  }
  const opts = { orientation };
  if (query === "min") return media.min(breakpoint, opts);
  if (query === "max") return media.max(breakpoint, opts);
  return media.exact(breakpoint, opts);
};

/** dec.9 — combine two `@media …` conditions into one (`@media <a> and <b>`), e.g. a breakpoint
 *  query AND a mode's OS-preference query. */
const combineMedia = (a: string, b: string): string => {
  const cond = (s: string) => s.replace(/^@media\s*/, "");
  return `@media ${cond(a)} and ${cond(b)}`;
};

const expandResponsiveVariableNodes = <TBreakpoint extends string>(
  properties: Record<string, PropertyModel>,
  media: MediaDescriptor<TBreakpoint>,
  resolveName: ResolveVariableName,
  formatValue: (ref: Ref) => string,
): CssVariablesNode[] => {
  // Grouped by `<media>||<selector>` so a mode-gated override lands in its own block. A plain
  // (no-mode) override keeps selector `:root`, so its key/order is unchanged → goldens byte-identical.
  const byBlock = new Map<string, { media: string; selector: string; variables: Record<string, string> }>();
  const add = (mediaQuery: string, selector: string, updates: Record<string, string>): void => {
    const key = `${mediaQuery}||${selector}`;
    const existing = byBlock.get(key);
    if (existing) Object.assign(existing.variables, updates);
    else byBlock.set(key, { media: mediaQuery, selector, variables: { ...updates } });
  };

  for (const [propertyName, model] of Object.entries(properties)) {
    for (const entry of model.responsive ?? []) {
      const mediaQuery = resolveMediaQuery(
        media,
        entry.breakpoint as TBreakpoint,
        (entry.query ?? DEFAULT_RESPONSIVE_QUERY) as MediaVariant,
        entry.orientation,
      );
      if (!mediaQuery) continue;

      const updates = computeEntryUpdates(propertyName, entry, resolveName, formatValue);
      if (!Object.keys(updates).length) continue;

      const mode = entry.mode;
      if (!mode) {
        add(mediaQuery, ":root", updates);
      } else {
        // dec.9 — the override applies only under `mode`: a `[data-theme]` block (manual toggle) always,
        // plus an OS-preference combined block for first-class modes (dark/light) — mirrors mode emit.
        add(mediaQuery, `:root[data-theme="${mode}"]`, updates);
        const osMedia = MODE_MEDIA[mode];
        if (osMedia) add(combineMedia(mediaQuery, osMedia), ":root", updates);
      }
    }
  }

  return Array.from(byBlock.values(), ({ media: m, selector, variables }): CssVariablesNode => ({
    kind: "variables",
    selector,
    media: m,
    variables,
  }));
};

const computeEntryUpdates = (
  propertyName: string,
  entry: PropertyResponsiveOverride,
  resolveName: ResolveVariableName,
  formatValue: (ref: Ref) => string,
): Record<string, string> => {
  // dec.5 — `ref` (READ source) swaps the destination var to that variant's var; `target` is the
  // WRITE destination (omit → the base var). They COMPOSE (no mutual-exclusion): read from `ref`,
  // write into `target`. Literal field overrides land on the same destination.
  const { ref, target } = entry;
  const updates: Record<string, string> = {};

  if (ref !== undefined) {
    updates[resolveName(propertyName, target)] = `var(${resolveName(propertyName, ref)})`;
  }

  for (const [field, r] of Object.entries(entry.overrides ?? {})) {
    const varName = field === "base" ? resolveName(propertyName, target) : resolveName(propertyName, target, field);
    // §15/§21: the formatter reads the whole ref (struct for shadow/transition, resolved `unit` for lengths).
    updates[varName] = formatValue(r);
  }

  return updates;
};

const rootNode = (variables: Record<string, string>): CssVariablesNode[] =>
  Object.keys(variables).length ? [{ kind: "variables", selector: ":root", variables }] : [];

// ---------------------------------------------------------------------------
// Shared appearance-mode expansion (§10.3)
// ---------------------------------------------------------------------------

/**
 * The OS-preference media query for a first-class mode. Named modes without an OS signal (e.g.
 * `hc`) get no media block — only the `[data-theme]` attribute block (a manual toggle).
 */
const MODE_MEDIA: Record<string, string> = {
  dark: "@media (prefers-color-scheme: dark)",
  light: "@media (prefers-color-scheme: light)",
};

/** Fetch (or create) the per-mode variable dict in a mode→vars accumulator, preserving mode order. */
const modeVars = (byMode: Map<string, Record<string, string>>, mode: string): Record<string, string> => {
  let vars = byMode.get(mode);
  if (!vars) {
    vars = {};
    byMode.set(mode, vars);
  }
  return vars;
};

/**
 * A mode→vars accumulator → its `CssVariablesNode[]`: per mode, an OS-preference `@media` block
 * (first-class modes only) re-declaring the mode's var names on `:root`, then a
 * `:root[data-theme="<mode>"]` attribute block (higher specificity → a manual toggle wins; source
 * order last). Both redefine the SAME base var names, so every downstream `var(--…)` reference
 * flips through the cascade with one redefinition. Empty modes contribute nothing.
 */
const modeVariableNodes = (byMode: Map<string, Record<string, string>>): CssVariablesNode[] => {
  const nodes: CssVariablesNode[] = [];
  for (const [mode, variables] of byMode) {
    if (!Object.keys(variables).length) continue;
    const media = MODE_MEDIA[mode];
    if (media) nodes.push({ kind: "variables", selector: ":root", media, variables: { ...variables } });
    nodes.push({ kind: "variables", selector: `:root[data-theme="${mode}"]`, variables: { ...variables } });
  }
  return nodes;
};

// ---------------------------------------------------------------------------
// Colors variable nodes
// ---------------------------------------------------------------------------

export type ColorsLoweringContext<TBreakpoint extends string = string> = {
  varName: VarNamer;
  media: MediaDescriptor<TBreakpoint>;
  /** Formats a palette colour value for output (§20) — identity for `rgb`, else hex/oklch. */
  formatColor: (value: unknown) => string;
};

/**
 * A subsystem token-path → its uniform CSS variable name (§17): `[subsystem, property, variant, field]`
 * joined into a dotted path, then `varNameFromPath`. base = bare property (no `--base`); a variant and/or
 * a field append — `colors.primary` → `--<t>-colors-primary`, `colors.primary.dark` → `--…-primary-dark`,
 * `colors.primary.text` → `--…-primary-text`, and (dec.3) a variant's own extra
 * `colors.primary.loud.text` → `--…-primary-loud-text`.
 */
const subsystemVarName = (
  varName: VarNamer,
  subsystem: string,
  property: string,
  variant?: string,
  field?: string,
): string =>
  varName([subsystem, property, variant, field].filter(Boolean).join("."));

/**
 * Colors property tokens → `:root` variable node(s) + responsive media nodes. base →
 * `--<t>-colors-<name>`, `extras.text` → `--<t>-colors-<name>-text`, variants →
 * `--<t>-colors-<name>-<variant>`, all in Model order.
 */
export const deriveColorsVariableNodes = <TBreakpoint extends string = string>(
  properties: Record<string, PropertyModel>,
  ctx: ColorsLoweringContext<TBreakpoint>,
): CssVariablesNode[] => {
  const { varName, formatColor } = ctx;
  const nameFor = (property: string, variant?: string, field?: string): string =>
    subsystemVarName(varName, "colors", property, variant, field);
  const variables: Record<string, string> = {};

  for (const [name, model] of Object.entries(properties)) {
    if (model.base.external !== undefined) continue; // §W6b — parent owns the var; emit no definition
    variables[nameFor(name)] = formatColor(model.base.value);
    const text = model.extras?.text;
    if (text && text.value != null && text.value !== "") {
      variables[nameFor(name, undefined, "text")] = formatColor(text.value);
    }
    for (const [variant, v] of Object.entries(model.variants ?? {})) {
      variables[nameFor(name, variant)] = formatColor(v.base.value);
      // dec.3 — the variant's own extras → `--<t>-colors-<name>-<variant>-<extra>`.
      for (const [ex, exRef] of Object.entries(v.extras ?? {})) {
        if (exRef.value != null && exRef.value !== "") variables[nameFor(name, variant, ex)] = formatColor(exRef.value);
      }
    }
  }

  return [
    ...rootNode(variables),
    ...expandResponsiveVariableNodes(properties, ctx.media, nameFor, ref => formatColor(ref.value)),
    ...deriveColorsModeNodes(properties, varName, formatColor),
  ];
};

/**
 * Colors appearance-mode blocks (§10.3). For each palette colour's modes, re-declare the affected
 * base var names — `--<t>-colors-<name>` for the `base` field and `--<t>-colors-<name>-text` for the
 * `text` extra — with the mode value, grouped per mode into the dual media + `[data-theme]` blocks.
 */
const deriveColorsModeNodes = (
  properties: Record<string, PropertyModel>,
  varName: VarNamer,
  formatColor: (value: unknown) => string,
): CssVariablesNode[] => {
  const byMode = new Map<string, Record<string, string>>();
  for (const [name, model] of Object.entries(properties)) {
    if (!model.modes) continue;
    for (const entry of model.modes) {
      if (entry.mode === undefined) continue;
      const vars = modeVars(byMode, entry.mode);
      // WHERE — a `target` scopes the re-declaration onto that variant's var (`--colors-<name>-<target>`);
      // omit → the base var (byte-identical to the old field-map behaviour).
      const target = entry.target;
      const fields = entry.overrides ?? {};
      const baseRef = fields.base;
      if (baseRef && baseRef.value != null) {
        vars[subsystemVarName(varName, "colors", name, target)] = formatColor(baseRef.value);
      }
      for (const [field, ref] of Object.entries(fields)) {
        if (field === "base") continue;
        if (ref && ref.value != null && ref.value !== "") {
          vars[subsystemVarName(varName, "colors", name, target, field)] = formatColor(ref.value);
        }
      }
    }
  }
  return modeVariableNodes(byMode);
};

/**
 * Build a `tokenPath → cssVarName` map for a subsystem's property tokens (base + `text` extras +
 * variants), each named uniformly via {@link varNameFromPath}, so the recipe lowering renders a
 * Model rule-set whose refs are token paths. Works for colors (with the `text` extra) and every
 * regular subsystem alike.
 */
const buildSubsystemPathToVar = (
  subsystem: string,
  properties: Record<string, PropertyModel>,
  varName: VarNamer,
): Record<string, string> => {
  const map: Record<string, string> = {};
  for (const [name, model] of Object.entries(properties)) {
    // §W6b — an external token maps straight to the parent's var name, so refs lower to var(--…) verbatim.
    map[`${subsystem}.${name}`] = model.base.external ?? varName(`${subsystem}.${name}`);
    for (const [field, ref] of Object.entries(model.extras ?? {})) {
      if (ref?.value == null || ref.value === "") continue;
      map[`${subsystem}.${name}.${field}`] = varName(`${subsystem}.${name}.${field}`);
    }
    for (const [variant, v] of Object.entries(model.variants ?? {})) {
      map[`${subsystem}.${name}.${variant}`] = varName(`${subsystem}.${name}.${variant}`);
      for (const ex of Object.keys(v.extras ?? {})) {
        map[`${subsystem}.${name}.${variant}.${ex}`] = varName(`${subsystem}.${name}.${variant}.${ex}`);
      }
    }
  }
  return map;
};

export const buildColorsPathToVar = (
  properties: Record<string, PropertyModel>,
  varName: VarNamer,
): Record<string, string> => buildSubsystemPathToVar("colors", properties, varName);

// ---------------------------------------------------------------------------
// Regular subsystems (typography / effects): base + variants only
// ---------------------------------------------------------------------------

type RegularVariableSpec = {
  /** `:root` value formatting — reads the whole {@link Ref} (value / struct / resolved `unit`). */
  formatRoot: (propertyKey: string, ref: Ref) => string;
  /** Responsive value formatting (defaults to {@link dimensionCss}). */
  formatResponsive?: (ref: Ref) => string;
};

type RegularLoweringContext<TBreakpoint extends string = string> = {
  varName: VarNamer;
  media: MediaDescriptor<TBreakpoint>;
};

/**
 * Regular subsystem properties → variable node(s) (§17 uniform naming). Each `(property, variant)`
 * names `--<t>-<subsystem>-<property>[-<variant>]` with the subsystem's value formatting (base first,
 * then authored variants, matching the token-map order). Responsive overrides + modes reuse the name.
 */
const deriveRegularVariableNodes = <TBreakpoint extends string = string>(
  subsystem: string,
  properties: Record<string, PropertyModel>,
  ctx: RegularLoweringContext<TBreakpoint>,
  spec: RegularVariableSpec,
): CssVariablesNode[] => {
  const { varName } = ctx;
  const nameFor: ResolveVariableName = (property, variant, field) =>
    subsystemVarName(varName, subsystem, property, variant, field);

  const variables: Record<string, string> = {};
  for (const [name, model] of Object.entries(properties)) {
    if (model.base.external !== undefined) continue; // §W6b — parent owns the var; emit no definition
    variables[nameFor(name)] = spec.formatRoot(name, model.base);
    for (const [variant, v] of Object.entries(model.variants ?? {})) {
      variables[nameFor(name, variant)] = spec.formatRoot(name, v.base);
      // dec.3 — the variant's own extras → `--<t>-<subsystem>-<name>-<variant>-<extra>`.
      for (const [ex, exRef] of Object.entries(v.extras ?? {})) {
        variables[nameFor(name, variant, ex)] = spec.formatRoot(name, exRef);
      }
    }
  }

  const formatResponsive = spec.formatResponsive ?? dimensionCss;
  return [
    ...rootNode(variables),
    ...expandResponsiveVariableNodes(properties, ctx.media, nameFor, formatResponsive),
    ...deriveRegularModeNodes(properties, (key, variant) => nameFor(key, variant), spec.formatRoot),
  ];
};

/**
 * Regular-subsystem appearance-mode blocks (§10.3). Regular subsystems own no extras, so a mode
 * redefines only the property's base var (via the same `formatRoot` formatting the base emit uses);
 * any non-base mode field is ignored. Grouped per mode into the dual media/attr blocks.
 */
const deriveRegularModeNodes = (
  properties: Record<string, PropertyModel>,
  varNameFor: (property: string, variant?: string) => string,
  formatRoot: (propertyKey: string, ref: Ref) => string,
): CssVariablesNode[] => {
  const byMode = new Map<string, Record<string, string>>();
  for (const [name, model] of Object.entries(properties)) {
    if (!model.modes) continue;
    for (const entry of model.modes) {
      if (entry.mode === undefined) continue;
      const baseRef = entry.overrides?.base;
      if (baseRef == null || (baseRef.struct == null && baseRef.value == null)) continue;
      // WHERE — a `target` scopes onto that variant's var; omit → the base var.
      modeVars(byMode, entry.mode)[varNameFor(name, entry.target)] = formatRoot(name, baseRef);
    }
  }
  return modeVariableNodes(byMode);
};

/** Build a `tokenPath → cssVarName` map for a regular subsystem (uniform naming). */
const buildRegularPathToVar = (
  subsystem: string,
  properties: Record<string, PropertyModel>,
  varName: VarNamer,
): Record<string, string> => buildSubsystemPathToVar(subsystem, properties, varName);

// --- Typography ---

/**
 * Typography property tokens → `:root` variable node(s). Length leaves (`fontSize`, `letterSpacing`)
 * carry a resolved `unit` from the §21 pass; unit-less numbers (`fontWeight`, `lineHeight` when un-unitted)
 * and strings (`fontFamily`) stringify raw — {@link dimensionCss} does both.
 */
export const deriveTypographyVariableNodes = <TBreakpoint extends string = string>(
  properties: Record<string, PropertyModel>,
  ctx: RegularLoweringContext<TBreakpoint>,
): CssVariablesNode[] =>
  deriveRegularVariableNodes("typography", properties, ctx, {
    formatRoot: (_propertyKey, ref) => dimensionCss(ref),
  });

export const buildTypographyPathToVar = (
  properties: Record<string, PropertyModel>,
  varName: VarNamer,
): Record<string, string> => buildRegularPathToVar("typography", properties, varName);

// --- Effects ---

// --- Structured effects value composition (§15) ---
// The Model carries shadow/transition values as structure (`Ref.struct`); the CSS adapter is where
// they become CSS text. A layer/part's `color` is a `colors.*` token path → `var(--…)` via the
// global path→var map (colors processed before effects — the §14.4 cross-subsystem watch-point).
// Shadow geometry fields carry a resolved unit (§21) — `shadowDimCss`; an absent (required) offset
// defaults to `0` in the layer's unit ({@link layerUnit}), so a drop-shadow stays `0px …` not `0 …`.

/** Resolve a shadow layer's `colors.*` color ref → `var(--…)`; falls back to the raw path if unmapped.
 *  Translucency lives in the referenced colour (an `alpha` colour variant — §13.3), not here. */
const resolveColorRef = (color: string, pathToVar: Record<string, string>): string => {
  const varName = pathToVar[color];
  return varName ? `var(${varName})` : color;
};

/** The layer's shared length unit — read from the first resolved geometry field; `px` if none resolved. */
const layerUnit = (layer: ShadowLayer): string => {
  for (const field of [layer.offsetX, layer.offsetY, layer.blur, layer.spread]) {
    if (field !== undefined && typeof field !== "number") return field.unit;
  }
  return "px";
};

/** Compose one structured shadow layer → CSS `[inset] <x> <y> [blur] [spread] [color]` (§21 units). */
const composeShadowLayer = (
  layer: ShadowLayer,
  pathToVar: Record<string, string>,
): string => {
  const zero = `0${layerUnit(layer)}`;
  const len = (dim: ShadowDimension | undefined): string => (dim === undefined ? zero : shadowDimCss(dim));
  const parts: string[] = [];
  if (layer.inset) parts.push("inset");
  parts.push(len(layer.offsetX), len(layer.offsetY));
  // `spread` is only valid after a `blur` slot — emit `blur` (default 0) when spread is present.
  if (layer.spread != null) parts.push(len(layer.blur), len(layer.spread));
  else if (layer.blur != null) parts.push(len(layer.blur));
  if (layer.color) parts.push(resolveColorRef(layer.color, pathToVar));
  return parts.join(" ");
};

/** Compose a shadow value (one or more layers) → a comma-joined `box-shadow` string. */
const composeShadow = (
  layers: ShadowLayer[],
  pathToVar: Record<string, string>,
): string => layers.map(layer => composeShadowLayer(layer, pathToVar)).join(", ");

/** Compose one structured transition part → CSS `<property> <duration>ms [timing] [delay]ms`. */
const composeTransitionPart = (part: TransitionPart): string => {
  const parts: string[] = [part.property];
  // A bare `delay` needs a `duration` slot ahead of it (CSS reads the first time as duration).
  if (part.duration != null || part.delay != null) parts.push(`${part.duration ?? 0}ms`);
  if (part.timingFunction) parts.push(part.timingFunction);
  if (part.delay != null) parts.push(`${part.delay}ms`);
  return parts.join(" ");
};

/** Compose a transition value (one or more parts) → a comma-joined `transition` string. */
const composeTransition = (parts: TransitionPart[]): string =>
  parts.map(composeTransitionPart).join(", ");

/** Compose a structured effects value → CSS by property (`transitions` vs shadow). */
const composeEffectsStruct = (
  propertyKey: string,
  value: readonly unknown[],
  pathToVar: Record<string, string>,
): string =>
  propertyKey === "transitions"
    ? composeTransition(value as TransitionPart[])
    : composeShadow(value as ShadowLayer[], pathToVar);

/**
 * Compose a structured effects value without a property key (the responsive path, where only the
 * value is in hand): a transition part carries a `property` field; a shadow layer does not.
 */
const composeEffectsStructAuto = (
  value: readonly unknown[],
  pathToVar: Record<string, string>,
): string => {
  const first = value[0];
  const isTransition = !!first && typeof first === "object" && "property" in first;
  return isTransition
    ? composeTransition(value as TransitionPart[])
    : composeShadow(value as ShadowLayer[], pathToVar);
};

/**
 * Effects property tokens → `:root` variable node(s). `blur` carries a resolved length unit (§21);
 * `shadow` / `transitions` compose from their structured {@link Ref.struct} value (§15) into CSS text —
 * a layer/part `color` ref resolves via `ctx.pathToVar` (the global map, colors already merged); the
 * scalars (`opacity` / `zIndex`) are unit-less. {@link dimensionCss} covers blur + the unit-less scalars.
 */
export const deriveEffectsVariableNodes = <TBreakpoint extends string = string>(
  properties: Record<string, PropertyModel>,
  ctx: RegularLoweringContext<TBreakpoint> & { pathToVar?: Record<string, string> },
): CssVariablesNode[] => {
  const pathToVar = ctx.pathToVar ?? {};
  return deriveRegularVariableNodes("effects", properties, ctx, {
    formatRoot: (propertyKey, ref) =>
      ref.struct ? composeEffectsStruct(propertyKey, ref.struct, pathToVar) : dimensionCss(ref),
    formatResponsive: ref =>
      ref.struct ? composeEffectsStructAuto(ref.struct, pathToVar) : dimensionCss(ref),
  });
};

export const buildEffectsPathToVar = (
  properties: Record<string, PropertyModel>,
  varName: VarNamer,
): Record<string, string> => buildRegularPathToVar("effects", properties, varName);

// --- Borders (§14) ---

/**
 * Borders property tokens → `:root` variable node(s). width/offset/radius carry a resolved length unit
 * (§21); `style` (a keyword string) has no unit. {@link dimensionCss} covers both.
 */
export const deriveBordersVariableNodes = <TBreakpoint extends string = string>(
  properties: Record<string, PropertyModel>,
  ctx: RegularLoweringContext<TBreakpoint>,
): CssVariablesNode[] =>
  deriveRegularVariableNodes("borders", properties, ctx, {
    formatRoot: (_propertyKey, ref) => dimensionCss(ref),
  });

export const buildBordersPathToVar = (
  properties: Record<string, PropertyModel>,
  varName: VarNamer,
): Record<string, string> =>
  buildRegularPathToVar("borders", properties, varName);

// --- Animation (§10.2) ---

/** Motion-token keys whose numeric value formats as a `<n>ms` time. `easing` stays a raw string. */
const MS_ANIMATION_KEYS = new Set(["duration", "delay"]);

const formatMs = (value: unknown): string => (typeof value === "number" ? `${value}ms` : str(value));

/** Animation motion tokens (duration/easing/delay) → `:root` variable node(s). Numeric durations/delays
 *  format as ms (time, not length — animation is outside the §21 length registry, so no `unit` is baked). */
export const deriveAnimationVariableNodes = <TBreakpoint extends string = string>(
  properties: Record<string, PropertyModel>,
  ctx: RegularLoweringContext<TBreakpoint>,
): CssVariablesNode[] =>
  deriveRegularVariableNodes("animation", properties, ctx, {
    formatRoot: (propertyKey, ref) =>
      typeof ref.value === "number" && MS_ANIMATION_KEYS.has(propertyKey) ? `${ref.value}ms` : str(ref.value),
    formatResponsive: ref => formatMs(ref.value),
  });

export const buildAnimationPathToVar = (
  properties: Record<string, PropertyModel>,
  varName: VarNamer,
): Record<string, string> => buildRegularPathToVar("animation", properties, varName);

// --- Layout ---

/** A structural-config property key (`columns--size`, `container--inset`) vs a regular one (`spacing`). */
const isLayoutConfigKey = (key: string): boolean => key.includes("--");

/** Split layout's merged property map into the regular tokens and the structural-config tokens (order kept). */
export const splitLayoutProperties = (
  properties: Record<string, PropertyModel>,
): { regular: Record<string, PropertyModel>; config: Record<string, PropertyModel> } => {
  const regular: Record<string, PropertyModel> = {};
  const config: Record<string, PropertyModel> = {};
  for (const [key, model] of Object.entries(properties)) {
    if (isLayoutConfigKey(key)) config[key] = model;
    else regular[key] = model;
  }
  return { regular, config };
};

/**
 * Layout regular property tokens → `:root` variable node(s). spacing/gutters carry a resolved length
 * unit (§21); `aspectRatio` is unit-less. {@link dimensionCss} covers both.
 */
export const deriveLayoutVariableNodes = <TBreakpoint extends string = string>(
  properties: Record<string, PropertyModel>,
  ctx: RegularLoweringContext<TBreakpoint>,
): CssVariablesNode[] =>
  deriveRegularVariableNodes("layout", properties, ctx, {
    formatRoot: (_propertyKey, ref) => dimensionCss(ref),
  });

/** The fixed layout knobs that always get a canonical base var name, even when unauthored. */
const LAYOUT_BASE_KEYS = ["spacing", "gutters", "aspectRatio"] as const;

/**
 * A `tokenPath → cssVarName` map for the whole layout subsystem — regular tokens via the uniform
 * naming (`layout.spacing.relaxed` → `--<t>-layout-spacing-relaxed`) **and** structural-config
 * tokens (`layout.container--inset` → `--<t>-layout-container-inset`), so the structural rule
 * declarations (which reference config tokens by path) resolve to the config `:root` var names.
 */
export const buildLayoutPathToVar = (
  properties: Record<string, PropertyModel>,
  varName: VarNamer,
): Record<string, string> => {
  const { regular, config } = splitLayoutProperties(properties);
  const map = buildRegularPathToVar("layout", regular, varName);
  // Seed the canonical base names for the fixed layout knobs (spacing/gutters/aspectRatio) so a
  // structural declaration referencing a base token (`layout.spacing`) always resolves to its var
  // name — even when no such property is authored (the default container with an empty `layout: {}`
  // references `layout.spacing`; the OLD generator hardcoded `var(--…-layout-spacing--base)`). For a
  // theme that DOES author these, the value is identical to the regular map entry — a no-op.
  for (const key of LAYOUT_BASE_KEYS) {
    const path = `layout.${key}`;
    if (!(path in map)) map[path] = varName(path);
  }
  for (const key of Object.keys(config)) {
    map[`layout.${key}`] = varName(`layout.${key}`);
  }
  return map;
};

/**
 * Layout structural-config tokens → `:root` variable node(s), one node per config group
 * (`columns`, `container`), grouped by the key's leading `<group>--` segment in first-seen order.
 * Each var is `--<t>-layout-<key>` (uniform); its value is the literal or a `var(--…)` (via
 * `pathToVar`) — so `--<t>-layout-columns-gutter: var(--<t>-layout-gutters)`.
 */
export const deriveLayoutConfigVariableNodes = (
  config: Record<string, PropertyModel>,
  ctx: { varName: VarNamer; pathToVar: Record<string, string> },
): CssVariablesNode[] => {
  const byGroup = new Map<string, Record<string, string>>();
  for (const [key, model] of Object.entries(config)) {
    const group = key.split("--")[0];
    let vars = byGroup.get(group);
    if (!vars) {
      vars = {};
      byGroup.set(group, vars);
    }
    vars[ctx.varName(`layout.${key}`)] = String(refToStyleValue(model.base, ctx.pathToVar));
  }
  return Array.from(byGroup.values(), (variables): CssVariablesNode => ({
    kind: "variables",
    selector: ":root",
    variables,
  }));
};

// ---------------------------------------------------------------------------
// Container rule lowering (two-pass: bases in reverse, medias forward)
// ---------------------------------------------------------------------------

/**
 * Lower a container {@link RuleSetGroup} to `CssRuleNode[]`. Unlike `lowerRecipeGroup` (which
 * interleaves base + medias per variant), the container generator emitted **all bases first**
 * (via `unshift`, so reverse of processing order) then **all medias** (forward). Reproduce that:
 * pass 1 emits base rules in reverse group order; pass 2 emits media overrides in forward order.
 * Byte-identical to the old `deriveContainerRules`, without the reverse node↔rule-set codec.
 */
export const lowerContainerGroup = <TBreakpoint extends string = string>(
  group: RuleSetGroup,
  options: LowerRecipeGroupOptions<TBreakpoint>,
): LowerRecipeGroupResult => {
  const { media, selectorBuilder, pathToVar } = options;
  const entries = Object.entries(group);
  const variants: Record<string, string> = {};
  for (const [name] of entries) variants[name] = selectorBuilder(name);

  const baseNodes: CssRuleNode[] = [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const [name, ruleSet] = entries[i];
    const declarations = declarationsFromRefs(ruleSet.declarations, pathToVar);
    if (declarations.length) baseNodes.push({ kind: "rule", selector: selectorBuilder(name), declarations });
  }

  const mediaNodes: CssRuleNode[] = [];
  for (const [name, ruleSet] of entries) {
    for (const override of ruleSet.overrides) {
      if (override.state !== undefined || !override.breakpoint) continue;
      const mediaQuery = resolveMediaQuery(
        media,
        override.breakpoint as TBreakpoint,
        (override.query ?? "exact") as MediaVariant,
        override.orientation,
      );
      if (!mediaQuery) continue;
      const declarations = declarationsFromRefs(override.declarations ?? {}, pathToVar);
      if (!declarations.length) continue;
      mediaNodes.push({ kind: "rule", selector: selectorBuilder(name), media: mediaQuery, declarations });
    }
  }

  return { nodes: [...baseNodes, ...mediaNodes], variants };
};

// ---------------------------------------------------------------------------
// Recipe rule lowering (forward: Model rule-sets → CssRuleNode[])
// ---------------------------------------------------------------------------

/** A declaration ref → its CSS value: a `var(--…)` (via `pathToVar`), optionally wrapped; else the literal. */
const refToStyleValue = (ref: Ref, pathToVar: Record<string, string>): string | number => {
  if (ref.ref === undefined) return ref.value as string | number;
  const v = `var(${pathToVar[ref.ref] ?? ref.ref})`;
  return ref.wrap ? `${ref.wrap}(${v})` : v;
};

const declarationsFromRefs = (
  decls: Record<string, Ref>,
  pathToVar: Record<string, string>,
): CssDeclaration[] =>
  Object.entries(decls).map(([property, ref]) => ({ property, value: refToStyleValue(ref, pathToVar) }));

// ---------------------------------------------------------------------------
// Globals lowering (§9) — preset `kind:"reset"` (`:where(sel)`) + themed `kind:"globals"` elements
// ---------------------------------------------------------------------------

/**
 * Suffix each comma-part of a raw selector (`h1,h2` + `.subtle` → `h1.subtle,h2.subtle`; `a` +
 * `:hover` → `a:hover`). Applies a variant class or a state pseudo to every element in a grouped
 * selector, not just the last — so a globals variant/state on `h1,h2` scopes both.
 */
const suffixSelector = (selector: string, suffix: string): string =>
  selector
    .split(",")
    .map(part => `${part.trim()}${suffix}`)
    .join(",");

/**
 * Lower one preset `kind:"reset"` rule-set → a specificity-0 `:where(sel) { … }` node. Literal
 * declarations pass through; token-path refs resolve via `globalPathToVar`, and an unresolved ref is
 * **dropped** (the opportunistic `defaults` `h1`–`h6` heading map / `static` layer — a ratio-less
 * theme drops the missing scale step). Never throws — the throw policy lives on themed elements.
 */
const lowerResetRuleSet = (
  ruleSet: RuleSet,
  globalPathToVar: Record<string, string>,
): CssRuleNode[] => {
  const selector = ruleSet.selector;
  if (!selector) return [];
  const declarations: CssDeclaration[] = [];
  for (const [property, ref] of Object.entries(ruleSet.declarations)) {
    if (ref.ref === undefined) {
      declarations.push({ property, value: ref.value as string | number });
      continue;
    }
    const varName = globalPathToVar[ref.ref];
    if (varName) declarations.push({ property, value: `var(${varName})` });
    // else drop: the scale step / token isn't present → omit this declaration.
  }
  return declarations.length ? [{ kind: "rule", selector: `:where(${selector})`, declarations }] : [];
};

/**
 * Emit one themed rule (a globals element base, or one of its variants) at `selector`: the base
 * declarations, its breakpoint-only overrides as `@media` blocks, then its state overrides as
 * `selector:state` rules (canonical order, source-order-last so they win), then container overrides.
 * Refs are validated up-front in `createTheme` (`validateGlobalsRefs`), so `declarationsFromRefs`
 * lowers them without a per-adapter throw.
 */
const emitGlobalsRule = <TBreakpoint extends string>(
  nodes: CssRuleNode[],
  selector: string,
  declarations: Record<string, Ref>,
  overrides: RuleSetOverride[],
  pathToVar: Record<string, string>,
  media: MediaDescriptor<TBreakpoint>,
  containers: ContainerDescriptors | undefined,
): void => {
  const base = declarationsFromRefs(declarations, pathToVar);
  if (base.length) nodes.push({ kind: "rule", selector, declarations: base });

  for (const override of overrides) {
    if (override.state !== undefined || override.container !== undefined || !override.breakpoint) continue;
    const mediaQuery = resolveMediaQuery(
      media,
      override.breakpoint as TBreakpoint,
      (override.query ?? "exact") as MediaVariant,
      override.orientation,
    );
    if (!mediaQuery) continue;
    const decls = declarationsFromRefs(override.declarations ?? {}, pathToVar);
    if (decls.length) nodes.push({ kind: "rule", selector, media: mediaQuery, declarations: decls });
  }

  const stateOverrides = overrides.filter(o => o.state !== undefined);
  for (const override of orderStateOverrides(stateOverrides)) {
    const stateSelector = CSS_STATE_SELECTORS[override.state as string];
    if (!stateSelector) continue;
    const decls = declarationsFromRefs(override.declarations ?? {}, pathToVar);
    if (!decls.length) continue;
    const node: CssRuleNode = { kind: "rule", selector: suffixSelector(selector, stateSelector), declarations: decls };
    if (override.breakpoint) {
      const mediaQuery = resolveMediaQuery(
        media,
        override.breakpoint as TBreakpoint,
        (override.query ?? "exact") as MediaVariant,
        override.orientation,
      );
      if (mediaQuery) node.media = mediaQuery;
    }
    nodes.push(node);
  }

  for (const override of overrides) {
    if (!override.container) continue;
    const query = containerQueryFor(override, containers);
    if (!query) continue;
    const decls = declarationsFromRefs(override.declarations ?? {}, pathToVar);
    if (!decls.length) continue;
    nodes.push({ kind: "rule", selector, media: query, declarations: decls });
  }
};

/**
 * Lower the globals subsystem's rule-set groups to `CssRuleNode[]`. Two kinds coexist:
 *  - `kind:"reset"` (preset `static` / `defaults`) → specificity-0 `:where(sel)` (drop policy).
 *  - `kind:"globals"` (themed `elements`) → a bare `sel { … }` at a higher tier, its `states` /
 *    `responsive` overrides, and each delta-only variant as a self-scoped `sel.<variant>` rule.
 * Groups render in insertion order (`static` → `defaults` → `elements`).
 */
export const lowerGlobalsGroups = <TBreakpoint extends string>(
  ruleSets: Record<string, RuleSetGroup>,
  globalPathToVar: Record<string, string>,
  media: MediaDescriptor<TBreakpoint>,
  containers?: ContainerDescriptors,
): CssRuleNode[] => {
  const nodes: CssRuleNode[] = [];
  for (const ruleSetGroup of Object.values(ruleSets)) {
    for (const ruleSet of Object.values(ruleSetGroup)) {
      if (ruleSet.kind === "globals") {
        const selector = ruleSet.selector;
        if (!selector) continue;
        emitGlobalsRule(nodes, selector, ruleSet.declarations, ruleSet.overrides, globalPathToVar, media, containers);
        for (const [variantName, variant] of Object.entries(ruleSet.variants ?? {})) {
          const variantSelector = suffixSelector(selector, `.${variantName}`);
          emitGlobalsRule(nodes, variantSelector, variant.declarations, variant.overrides, globalPathToVar, media, containers);
        }
      } else {
        nodes.push(...lowerResetRuleSet(ruleSet, globalPathToVar));
      }
    }
  }
  return nodes;
};

// ---------------------------------------------------------------------------
// Container context declaration (§10.5) — `.<prefix>-cq-<name> { container-type; container-name }`
// ---------------------------------------------------------------------------

/**
 * Lower the theme's `containers` config to the utility classes that establish each named containment
 * context: `.<classPrefix>-cq-<name> { container-type: <type>; container-name: <name>; }` (§10.5 D4).
 * A distinct `cq` segment avoids colliding with layout's `.<prefix>-container` max-width wrapper. Put
 * on a wrapper element; the recipe's `@container <name> (…)` rules then respond to it. The context
 * class routes through `containerClass` (§7B `kind:"container"`), so a naming override remaps it
 * consistently with `theme.classes.containers.context.<name>`.
 */
export const deriveContainerContextNodes = (
  containers: Record<string, ContainerModel> | undefined,
  containerClass: (name: string) => string,
): CssRuleNode[] => {
  const nodes: CssRuleNode[] = [];
  for (const [name, container] of Object.entries(containers ?? {})) {
    nodes.push({
      kind: "rule",
      selector: `.${containerClass(name)}`,
      declarations: [
        { property: "container-type", value: container.type },
        { property: "container-name", value: name },
      ],
    });
  }
  return nodes;
};

// --- State → selector table + canonical ordering ---

const CSS_STATE_SELECTORS: Record<string, string> = {
  link: ":link",
  visited: ":visited",
  hover: ":hover",
  focus: ":focus",
  active: ":active",
  disabled: "[disabled]",
  pressed: "[aria-pressed]",
};

/** The states the CSS adapter can render (the validation set for recipe normalization). */
export const CSS_KNOWN_STATES: ReadonlyArray<string> = Object.keys(CSS_STATE_SELECTORS);

const STATE_ORDER: Record<string, number> = CSS_KNOWN_STATES.reduce<Record<string, number>>(
  (acc, name, index) => {
    acc[name] = index;
    return acc;
  },
  {},
);

const orderStateOverrides = (overrides: RuleSetOverride[]): RuleSetOverride[] =>
  [...overrides]
    .map((override, index) => ({ override, index }))
    .sort((a, b) => {
      const orderA = STATE_ORDER[a.override.state as string] ?? Number.MAX_SAFE_INTEGER;
      const orderB = STATE_ORDER[b.override.state as string] ?? Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      const bpA = a.override.breakpoint ? 1 : 0;
      const bpB = b.override.breakpoint ? 1 : 0;
      if (bpA !== bpB) return bpA - bpB;
      return a.index - b.index;
    })
    .map(({ override }) => override);

const deriveStateNodes = <TBreakpoint extends string>(
  ruleSet: RuleSet,
  selector: string,
  media: MediaDescriptor<TBreakpoint>,
  pathToVar: Record<string, string>,
): CssRuleNode[] => {
  // dec.8 — `target`ed state overrides emit against a SIBLING selector, appended last by the caller
  // so they win; the base state rules here are the un-targeted ones (byte-identical to before).
  const stateOverrides = ruleSet.overrides.filter(o => o.state !== undefined && !o.target);
  if (!stateOverrides.length) return [];

  const nodes: CssRuleNode[] = [];
  for (const override of orderStateOverrides(stateOverrides)) {
    const stateSelector = CSS_STATE_SELECTORS[override.state as string];
    if (!stateSelector) continue;

    const declarations = declarationsFromRefs(override.declarations ?? {}, pathToVar);
    if (!declarations.length) continue;

    const node: CssRuleNode = { kind: "rule", selector: `${selector}${stateSelector}`, declarations };

    if (override.breakpoint) {
      const mediaQuery = resolveMediaQuery(
        media,
        override.breakpoint as TBreakpoint,
        (override.query ?? "exact") as MediaVariant,
        override.orientation,
      );
      if (mediaQuery) node.media = mediaQuery;
    }

    nodes.push(node);
  }
  return nodes;
};

export type LowerRecipeGroupOptions<TBreakpoint extends string = string> = {
  media: MediaDescriptor<TBreakpoint>;
  selectorBuilder: (variantName: string) => string;
  pathToVar: Record<string, string>;
  /** Container-query descriptors (§10.5) — resolve a `{ container, size, query }` override → `@container …`. */
  containers?: ContainerDescriptors;
};

/**
 * Resolve a container override's `{ container, size, query }` to its `@container <name> (…)` prelude
 * via the container descriptors, or `""` when the container/size/descriptors are absent (§10.5).
 */
const containerQueryFor = (
  override: RuleSetOverride,
  containers: ContainerDescriptors | undefined,
): string => {
  if (!override.container || !override.size) return "";
  const descriptor = containers?.[override.container];
  if (!descriptor) return "";
  const query = (override.query ?? "min") as MediaVariant;
  return descriptor[query](override.size);
};

export type LowerRecipeGroupResult = {
  nodes: CssRuleNode[];
  variants: Record<string, string>;
};

/**
 * A Model recipe {@link RuleSetGroup} → recipe `CssRuleNode[]` (+ variant → selector map).
 * Forward lowering: base + breakpoint-conditioned overrides render first (per variant), then
 * state (+ state×breakpoint) overrides append as `:state` rules so they win by source order.
 */
export const lowerRecipeGroup = <TBreakpoint extends string = string>(
  group: RuleSetGroup,
  options: LowerRecipeGroupOptions<TBreakpoint>,
): LowerRecipeGroupResult => {
  const { media, selectorBuilder, pathToVar } = options;
  const nodes: CssRuleNode[] = [];
  const variants: Record<string, string> = {};

  for (const [name, ruleSet] of Object.entries(group)) {
    const selector = selectorBuilder(name);
    variants[name] = selector;

    const baseDeclarations = declarationsFromRefs(ruleSet.declarations, pathToVar);
    if (baseDeclarations.length) nodes.push({ kind: "rule", selector, declarations: baseDeclarations });

    for (const override of ruleSet.overrides) {
      if (override.state !== undefined || !override.breakpoint) continue;
      const mediaQuery = resolveMediaQuery(
        media,
        override.breakpoint as TBreakpoint,
        (override.query ?? "exact") as MediaVariant,
        override.orientation,
      );
      if (!mediaQuery) continue;
      const declarations = declarationsFromRefs(override.declarations ?? {}, pathToVar);
      if (!declarations.length) continue;
      nodes.push({ kind: "rule", selector, media: mediaQuery, declarations });
    }
  }

  const stateNodes: CssRuleNode[] = [];
  for (const [name, ruleSet] of Object.entries(group)) {
    stateNodes.push(...deriveStateNodes(ruleSet, selectorBuilder(name), media, pathToVar));
  }

  // dec.8 — `target`ed state overrides: emit `<item>-<target>:state` against the desugared sibling
  // (§7A), collected across the whole group and appended LAST so they beat the sibling's inherited
  // (un-targeted) state rules by source order.
  const targetedStateNodes: CssRuleNode[] = [];
  for (const [name, ruleSet] of Object.entries(group)) {
    for (const override of ruleSet.overrides) {
      if (override.state === undefined || !override.target) continue;
      const stateSelector = CSS_STATE_SELECTORS[override.state];
      if (!stateSelector) continue;
      const declarations = declarationsFromRefs(override.declarations ?? {}, pathToVar);
      if (!declarations.length) continue;
      const siblingSelector = selectorBuilder(`${name}-${override.target}`);
      const node: CssRuleNode = { kind: "rule", selector: `${siblingSelector}${stateSelector}`, declarations };
      if (override.breakpoint) {
        const mediaQuery = resolveMediaQuery(
          media,
          override.breakpoint as TBreakpoint,
          (override.query ?? "exact") as MediaVariant,
          override.orientation,
        );
        if (mediaQuery) node.media = mediaQuery;
      }
      targetedStateNodes.push(node);
    }
  }

  // Container-query overrides (§10.5): each `{ container, size }` override → a rule wrapped in an
  // `@container <name> (…)` prelude (carried on the node's generic `media` field). Appended last so
  // they win by source order, like state rules. Skipped entirely when no `containers` are configured.
  const containerNodes: CssRuleNode[] = [];
  for (const [name, ruleSet] of Object.entries(group)) {
    const selector = selectorBuilder(name);
    for (const override of ruleSet.overrides) {
      if (!override.container) continue;
      const query = containerQueryFor(override, options.containers);
      if (!query) continue;
      const declarations = declarationsFromRefs(override.declarations ?? {}, pathToVar);
      if (!declarations.length) continue;
      containerNodes.push({ kind: "rule", selector, media: query, declarations });
    }
  }

  return { nodes: [...nodes, ...stateNodes, ...containerNodes, ...targetedStateNodes], variants };
};

// ---------------------------------------------------------------------------
// Animation lowering (§10.2) — keyframes at-rules + animation-shorthand recipes
// ---------------------------------------------------------------------------

/** The token-path prefix an `animation-name` ref carries — it resolves to the bare keyframe id. */
const KEYFRAME_REF_PREFIX = "animation.keyframes.";

/**
 * Lower the animation subsystem's keyframes to `@keyframes` at-rule nodes. Each step keeps its
 * verbatim `stop`; declarations resolve through `globalPathToVar` — a literal `{ value }` passes
 * through, a token-path `{ ref }` (e.g. `colors.surface`) becomes `var(--…)` (so a keyframe can
 * animate a themed value). Keyframe identifiers are emitted raw (as authored).
 */
export const lowerKeyframes = (
  keyframes: Record<string, Keyframe>,
  globalPathToVar: Record<string, string>,
): CssKeyframesNode[] => {
  const nodes: CssKeyframesNode[] = [];
  for (const [name, keyframe] of Object.entries(keyframes)) {
    const steps = keyframe.steps.map(step => ({
      stop: step.stop,
      declarations: Object.entries(step.declarations).map(([property, ref]): CssDeclaration => ({
        property,
        value: refToStyleValue(ref, globalPathToVar),
      })),
    }));
    nodes.push({ kind: "keyframes", name, steps });
  }
  return nodes;
};

/** The `animation:` shorthand sub-property order — first `<time>` = duration, second = delay; name last. */
const ANIMATION_LONGHAND_ORDER: ReadonlyArray<string> = [
  "animation-duration",
  "animation-timing-function",
  "animation-delay",
  "animation-iteration-count",
  "animation-direction",
  "animation-fill-mode",
  "animation-play-state",
  "animation-name",
];

/** Resolve an `animation-name` ref to its bare keyframe identifier, validating it against the known set. */
const resolveKeyframeName = (
  ref: Ref,
  keyframeNames: ReadonlySet<string>,
  selector: string,
): string => {
  const name =
    ref.ref !== undefined
      ? ref.ref.startsWith(KEYFRAME_REF_PREFIX)
        ? ref.ref.slice(KEYFRAME_REF_PREFIX.length)
        : ref.ref
      : str(ref.value);
  if (!keyframeNames.has(name)) {
    throw new Error(
      `css adapter: animation recipe '${selector}' references unknown keyframe '${name}' — ` +
        `no matching entry in animation.keyframes`,
    );
  }
  return name;
};

/**
 * Compose one animation declaration set (base or override) into an `animation:` shorthand string in
 * canonical sub-property order. Duration/easing/delay refs → `var(--…)` (or literal); the
 * `animation-name` ref → the bare, validated keyframe identifier. Returns `""` when nothing is set.
 */
const composeAnimationShorthand = (
  decls: Record<string, Ref>,
  pathToVar: Record<string, string>,
  keyframeNames: ReadonlySet<string>,
  selector: string,
): string => {
  const parts: string[] = [];
  for (const longhand of ANIMATION_LONGHAND_ORDER) {
    const ref = decls[longhand];
    if (!ref) continue;
    parts.push(
      longhand === "animation-name"
        ? resolveKeyframeName(ref, keyframeNames, selector)
        : String(refToStyleValue(ref, pathToVar)),
    );
  }
  return parts.join(" ");
};

export type LowerAnimationGroupOptions<TBreakpoint extends string = string> =
  LowerRecipeGroupOptions<TBreakpoint> & { keyframeNames: ReadonlySet<string> };

/**
 * Lower an animation recipe {@link RuleSetGroup} to class rules whose single declaration is the
 * composed `animation:` shorthand — base first, then breakpoint overrides, then state overrides
 * (canonical order, source-order wins) — mirroring {@link lowerRecipeGroup}'s node ordering with a
 * whole-set shorthand composer in place of the per-declaration lowering.
 */
export const lowerAnimationRecipeGroup = <TBreakpoint extends string = string>(
  group: RuleSetGroup,
  options: LowerAnimationGroupOptions<TBreakpoint>,
): LowerRecipeGroupResult => {
  const { media, selectorBuilder, pathToVar, keyframeNames } = options;
  const nodes: CssRuleNode[] = [];
  const variants: Record<string, string> = {};

  const shorthandNode = (
    selector: string,
    decls: Record<string, Ref>,
    mediaQuery?: string,
  ): CssRuleNode | undefined => {
    const shorthand = composeAnimationShorthand(decls, pathToVar, keyframeNames, selector);
    if (!shorthand) return undefined;
    const node: CssRuleNode = { kind: "rule", selector, declarations: [{ property: "animation", value: shorthand }] };
    if (mediaQuery) node.media = mediaQuery;
    return node;
  };

  for (const [name, ruleSet] of Object.entries(group)) {
    const selector = selectorBuilder(name);
    variants[name] = selector;

    const base = shorthandNode(selector, ruleSet.declarations);
    if (base) nodes.push(base);

    for (const override of ruleSet.overrides) {
      if (override.state !== undefined || !override.breakpoint) continue;
      const mediaQuery = resolveMediaQuery(
        media,
        override.breakpoint as TBreakpoint,
        (override.query ?? "exact") as MediaVariant,
        override.orientation,
      );
      if (!mediaQuery) continue;
      const node = shorthandNode(selector, override.declarations ?? {}, mediaQuery);
      if (node) nodes.push(node);
    }
  }

  const stateNodes: CssRuleNode[] = [];
  for (const [name, ruleSet] of Object.entries(group)) {
    const selector = selectorBuilder(name);
    const stateOverrides = ruleSet.overrides.filter(o => o.state !== undefined);
    for (const override of orderStateOverrides(stateOverrides)) {
      const stateSelector = CSS_STATE_SELECTORS[override.state as string];
      if (!stateSelector) continue;
      let mediaQuery: string | undefined;
      if (override.breakpoint) {
        mediaQuery = resolveMediaQuery(
          media,
          override.breakpoint as TBreakpoint,
          (override.query ?? "exact") as MediaVariant,
          override.orientation,
        ) || undefined;
      }
      const node = shorthandNode(`${selector}${stateSelector}`, override.declarations ?? {}, mediaQuery);
      if (node) stateNodes.push(node);
    }
  }

  // Container-query overrides (§10.5): compose the shorthand and wrap it in `@container <name> (…)`.
  const containerNodes: CssRuleNode[] = [];
  for (const [name, ruleSet] of Object.entries(group)) {
    const selector = selectorBuilder(name);
    for (const override of ruleSet.overrides) {
      if (!override.container) continue;
      const query = containerQueryFor(override, options.containers);
      if (!query) continue;
      const node = shorthandNode(selector, override.declarations ?? {}, query);
      if (node) containerNodes.push(node);
    }
  }

  return { nodes: [...nodes, ...stateNodes, ...containerNodes], variants };
};

// ---------------------------------------------------------------------------
// Merged (flattened) rule-set lowering — the `components` emit mode (§9d/9e)
// ---------------------------------------------------------------------------

/** Sort merged state keys by the canonical `CSS_STATE_SELECTORS` order (hover before disabled, …). */
const orderStateKeys = (keys: string[]): string[] =>
  [...keys].sort(
    (a, b) =>
      (STATE_ORDER[a] ?? Number.MAX_SAFE_INTEGER) - (STATE_ORDER[b] ?? Number.MAX_SAFE_INTEGER),
  );

export type LowerMergedRuleSetOptions<TBreakpoint extends string = string> = {
  /** The base selector for the flattened variant (e.g. `.app-buttons-primary`). */
  selector: string;
  media: MediaDescriptor<TBreakpoint>;
  pathToVar: Record<string, string>;
  /** Container-query descriptors (§10.5) — resolve a merged container bucket → `@container …`. */
  containers?: ContainerDescriptors;
};

/**
 * Lower one flattened {@link MergedRuleSet} to `CssRuleNode[]` — the format-neutral twin of
 * {@link lowerRecipeGroup} for the `components` emit mode. Reuses the same declaration lowering,
 * state→selector table, and media resolution: `base` → the base rule at `selector`; each `state`
 * → a `${selector}:hover`/`[disabled]`/… rule (canonical order); each responsive entry → an
 * `@media` block (with an optional state selector). Declarations stay as `var(--…)` refs — inline
 * baking is a render-time choice the adapter makes downstream (via `enrichDeclarationsWithRefs`).
 */
export const lowerMergedRuleSet = <TBreakpoint extends string = string>(
  merged: MergedRuleSet,
  options: LowerMergedRuleSetOptions<TBreakpoint>,
): CssRuleNode[] => {
  const { selector, media, pathToVar, containers } = options;
  const nodes: CssRuleNode[] = [];

  const baseDeclarations = declarationsFromRefs(merged.base, pathToVar);
  if (baseDeclarations.length) nodes.push({ kind: "rule", selector, declarations: baseDeclarations });

  for (const state of orderStateKeys(Object.keys(merged.states))) {
    const stateSelector = CSS_STATE_SELECTORS[state];
    if (!stateSelector) continue;
    const declarations = declarationsFromRefs(merged.states[state], pathToVar);
    if (declarations.length) {
      nodes.push({ kind: "rule", selector: `${selector}${stateSelector}`, declarations });
    }
  }

  for (const entry of merged.responsive) {
    // A viewport bucket → `@media`; a container bucket (§10.5) → `@container` (carried on the same
    // generic `media` field). Both may still carry a state selector.
    const atRule = entry.container
      ? containerQueryFor(entry as RuleSetOverride, containers)
      : resolveMediaQuery(
          media,
          entry.breakpoint as TBreakpoint,
          (entry.query ?? "exact") as MediaVariant,
          entry.orientation,
        );
    if (!atRule) continue;
    const declarations = declarationsFromRefs(entry.declarations, pathToVar);
    if (!declarations.length) continue;
    const stateSelector = entry.state ? CSS_STATE_SELECTORS[entry.state] ?? "" : "";
    nodes.push({ kind: "rule", selector: `${selector}${stateSelector}`, media: atRule, declarations });
  }

  return nodes;
};
