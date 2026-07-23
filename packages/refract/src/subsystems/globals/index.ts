/**
 * The globals subsystem (§9 — formerly `reset`).
 *
 * Owns **no primitive properties** and **no minted-class recipes** — it fills the Model with two
 * kinds of selector-targeting rule-set:
 *
 *  - **preset layers** (`static` + default `defaults`) — `kind:"reset"`, literal/opportunistic
 *    normalization the adapters render at specificity-0 (`:where(sel)`). Unchanged from `reset`.
 *  - **themed elements** (`elements`) — `kind:"globals"`, one rule-set per selector, carrying base
 *    declarations + `states`/`responsive` overrides + delta-only `variants`. The adapters render
 *    these at a higher tier (bare `a { }`, variant `a.subtle` / nested `&.subtle`).
 *
 * Element rules reuse the shared recipe normalization (`normalizeRecipeGroup`) for the genuinely
 * common part — flattening `states` + `responsive` into one `overrides` list — but stay *structural*
 * (a base selector + a named-variant map), not §7A recipe-sibling classes: they're elements, not
 * recipes. Their token refs resolve late in each adapter and are validated up-front in `createTheme`
 * (`validateGlobalsRefs`), like `components`. It grows a hook, never the spine.
 */

import type { NormalizedProperties, StructuralContext, StructuralOutput, Subsystem } from "../../core/subsystem";
import type { Ref, RuleSet, RuleSetGroup, RuleSetOverride, GlobalsVariant } from "../../core/model";
import { normalizeRecipeGroup } from "../../core/normalize";
import type {
  NormalizedRecipeVariant,
  RecipeNormalizationOptions,
  RecipeResponsiveOverride,
} from "../../core/normalize";
import type { GlobalsDeclValue, GlobalsDeclarations, GlobalsElement, GlobalsRaw } from "./types";
import { expandPreset } from "./presets";

/** The condition-axis keys carried on a normalized recipe override — never declarations. */
const CONDITION_KEYS = new Set([
  "state",
  "breakpoint",
  "query",
  "orientation",
  "container",
  "size",
  "variant",
  "target",
]);

/** A globals leaf value → a Model {@link Ref} (literal-first, §9): a bare `string` / `number` is a raw
 *  literal → `{ value }`; a `ref("…")` / `{ ref: "…" }` marker is a token path → `{ ref }` (lowered to
 *  `var(--…)` / theme read by the adapter). Mirrors the components `css` delta grammar. */
const leafToRef = (value: GlobalsDeclValue): Ref => {
  if (value !== null && typeof value === "object") return { ref: value.ref };
  return { value };
};

/** Format an authored CSS property name to its declaration name (`textDecoration` → `text-decoration`). */
const formatProperty = (property: string): string => {
  if (property.startsWith("--")) return property;
  return property
    .replace(/_/g, "-")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();
};

/** A flat declaration map (a normalized base or one override entry) → `formattedProperty → Ref`,
 *  skipping the condition axes (present on override entries) — everything else is a leaf. */
const interpretDeclarations = (props: Record<string, unknown>): Record<string, Ref> => {
  const declarations: Record<string, Ref> = {};
  for (const [property, value] of Object.entries(props)) {
    if (value == null || CONDITION_KEYS.has(property)) continue;
    declarations[formatProperty(property)] = leafToRef(value as GlobalsDeclValue);
  }
  return declarations;
};

/** One normalized override entry → a Model {@link RuleSetOverride} (condition axes copied, delta
 *  props interpreted into declarations). */
const interpretOverride = (entry: RecipeResponsiveOverride<GlobalsDeclarations>): RuleSetOverride => {
  const override: RuleSetOverride = { declarations: interpretDeclarations(entry as Record<string, unknown>) };
  const e = entry as Record<string, unknown>;
  for (const key of CONDITION_KEYS) {
    if (e[key] !== undefined) (override as Record<string, unknown>)[key] = e[key];
  }
  return override;
};

/** A normalized recipe variant → `{ declarations, overrides }` (the shared base/override interpret). */
const interpretItem = (
  normalized: NormalizedRecipeVariant<GlobalsDeclarations>,
): { declarations: Record<string, Ref>; overrides: RuleSetOverride[] } => ({
  declarations: interpretDeclarations(normalized.base as Record<string, unknown>),
  overrides: normalized.responsive.map(interpretOverride),
});

/**
 * Normalize one authored element def as a single-item recipe group and interpret it. `variants` is
 * peeled off first, so `normalizeRecipeGroup` sees no `variants` key (§7A stays a no-op) and just
 * flattens `states` + `responsive`. The one-item group keys the result by the name we passed.
 */
const normalizeElementItem = (
  name: string,
  def: Record<string, unknown>,
  options: RecipeNormalizationOptions<string>,
): { declarations: Record<string, Ref>; overrides: RuleSetOverride[] } => {
  // dec.7 — globals element variants keep the rich (states/responsive) modifier, a superset of the
  // flat recipe modifier `normalizeRecipeGroup` is typed for; the runtime (`mergeRecipe`) is generic,
  // so this cast is structurally safe.
  const normalized = normalizeRecipeGroup<GlobalsDeclarations, string>(
    { [name]: def } as unknown as Parameters<typeof normalizeRecipeGroup<GlobalsDeclarations, string>>[0],
    options,
  );
  return interpretItem(normalized[name]);
};

/** `globals.elements` (selector → themed element rule) → the `kind:"globals"` `elements` rule-set group. */
const buildElementsGroup = (
  elements: Record<string, GlobalsElement> | undefined,
  ctx: StructuralContext,
): RuleSetGroup | undefined => {
  if (!elements || !Object.keys(elements).length) return undefined;
  const allowedBreakpoints = Object.keys(ctx.breakpoints);
  const group: RuleSetGroup = {};

  for (const [selector, element] of Object.entries(elements)) {
    if (!element || typeof element !== "object") continue;
    const options: RecipeNormalizationOptions<string> = {
      propertyPath: `globals.elements.${selector}`,
      allowedBreakpoints,
      allowedStates: ctx.allowedStates,
      allowedContainers: ctx.allowedContainers,
    };

    // Peel `variants` so the base normalizes without §7A desugaring; variants stay structural.
    const { variants, ...baseDef } = element as Record<string, unknown>;
    const base = normalizeElementItem(selector, baseDef, options);

    const ruleSet: RuleSet = {
      kind: "globals",
      selector,
      declarations: base.declarations,
      overrides: base.overrides,
    };

    if (variants && typeof variants === "object" && Object.keys(variants).length) {
      const variantMap: Record<string, GlobalsVariant> = {};
      for (const [variantName, delta] of Object.entries(variants as Record<string, unknown>)) {
        if (!delta || typeof delta !== "object") continue;
        variantMap[variantName] = normalizeElementItem(variantName, delta as Record<string, unknown>, {
          ...options,
          propertyPath: `${options.propertyPath}.variants.${variantName}`,
        });
      }
      if (Object.keys(variantMap).length) ruleSet.variants = variantMap;
    }

    group[selector] = ruleSet;
  }

  return Object.keys(group).length ? group : undefined;
};

/**
 * Normalize a `rawTheme.globals` slice into its `{ static?, defaults?, elements? }` rule-set groups.
 *
 * The **preset** must be explicit for the static + default layers to emit — a bare `{ elements }`
 * produces only the themed element group, so an `override` delta inherits the parent's preset instead
 * of reverting to the default.
 */
const buildGlobalsRuleSets = (
  rawSlice: unknown,
  ctx: StructuralContext,
): Record<string, RuleSetGroup> => {
  const parsed = (rawSlice ?? {}) as GlobalsRaw;
  const groups: Record<string, RuleSetGroup> = {};

  // Static + default heading layers only when the preset is explicitly authored.
  if (parsed.preset !== undefined) {
    const expanded = expandPreset(parsed.preset);
    if (expanded.static) groups.static = expanded.static;
    if (expanded.defaults) groups.defaults = expanded.defaults;
  }

  // Themed element rules always apply (the delta a preset-less slice carries).
  const elements = buildElementsGroup(parsed.elements, ctx);
  if (elements) groups.elements = elements;

  return groups;
};

export const globalsSubsystem: Subsystem = {
  key: "globals",
  // No property pipeline — globals owns no primitive tokens.
  normalizeProperties(): NormalizedProperties {
    return {};
  },
  buildStructural(rawSlice, ctx): StructuralOutput {
    return { ruleSetGroups: buildGlobalsRuleSets(rawSlice, ctx), configProperties: {} };
  },
};

export type { GlobalsRaw, GlobalsPreset, GlobalsDeclValue, GlobalsDeclarations, GlobalsElement } from "./types";
