/**
 * The clean-room `createTheme` — the public entry point.
 *
 * A **walking skeleton** (Step 0d): a live spine that grows one seam per step, so every
 * later step is reviewed through the real entry point rather than isolated unit tests.
 * The control flow is fixed; coverage grows by pushing a {@link Subsystem} onto `SUBSYSTEMS`
 * or filling a hook — never by editing the spine.
 *
 * `adapter` is a **required** option (no `createCssAdapter()` default), which is what lets
 * this module stay in core importing nothing but the `ThemeAdapter` interface.
 *
 * Flow: read breakpoints → build the media descriptor → normalize each subsystem's slice
 * into a per-subsystem Model input (`buildSubsystemInput`) → `buildThemeModel` → assemble the
 * theme surface (`assembleTheme`: token map + `resolveToken` + `adapter.bind` + `extend`).
 *
 * `theme.override(partial)` (Step 5) is a **delta merge**, not a re-run: it normalizes ONLY the
 * partial's changed subsystem slices (through the very same `buildSubsystemInput`), immutably
 * merges those Model fragments into the current Model at property / rule-set-group granularity,
 * and re-assembles onto the **new** Model. The parent Model (and its bound outputs) are untouched
 * — real child themes. There is no raw retention: the Model is the only held state, and the
 * reference-resolution context recipe interpretation needs is reconstructed from it
 * (`reconstructNormalizedProperties`). Synthesized steps are derived refs, so overriding a base
 * re-derives its steps for free; the merge code itself carries no subsystem-specific logic.
 */

import type { ThemeAdapter, RenderContext } from "./ThemeAdapter";
import { RefractError } from "./errors";
import type { Subsystem, RecipeInterpretContext, NormalizedProperties } from "./subsystem";
import type {
  Literal,
  Ref,
  ThemeModel,
  SubsystemModel,
  PropertyModel,
  RuleSetGroup,
  Keyframe,
  ContainerModel,
  SubsystemModelInput,
  BuildThemeModelInput,
} from "./model";
import type { InterpretedRecipeVariant } from "./model";
import {
  buildThemeModel,
  buildSubsystemModel,
  buildTokenMap,
  buildRuleSetFromInterpreted,
  buildComponentRuleSetFromInterpreted,
} from "./model";
import { resolveModelUnits, type UnitsConfig, type UnitResolutionConfig } from "./units";
import type { NormalizedPropertyValue } from "./normalize";
import type { RawTheme } from "./rawTheme";
import { normalizeRecipeGroup, createRecipeVariantResolver } from "./normalize";
import { buildDerivationRegistry, resolveToken, bakeCrossPropertyDerivations } from "./derive";
import {
  buildMediaDescriptor,
  buildContainerDescriptors,
  mediaQueryString,
  resolveMediaConfig,
  DEFAULT_BREAKPOINTS,
  type MediaDescriptor,
  type MediaConfig,
} from "./media";
import { colorsSubsystem } from "../subsystems/colors";
import { typographySubsystem } from "../subsystems/typography";
import { layoutSubsystem } from "../subsystems/layout";
import { effectsSubsystem } from "../subsystems/effects";
import { bordersSubsystem } from "../subsystems/borders";
import { animationSubsystem } from "../subsystems/animation";
import { componentsSubsystem } from "../subsystems/components";
import { globalsSubsystem } from "../subsystems/globals";

/**
 * The subsystems the spine drives, in order. Grows as later steps port each subsystem.
 * `globals` is last: its themed element refs resolve late against every subsystem's tokens (like
 * `components`), so it only needs the others' Model present, not their array position.
 */
const SUBSYSTEMS: readonly Subsystem[] = [
  colorsSubsystem,
  typographySubsystem,
  layoutSubsystem,
  effectsSubsystem,
  bordersSubsystem,
  animationSubsystem,
  componentsSubsystem,
  globalsSubsystem,
];

/**
 * The generic recipe path — normalize each `<subsystem>.recipes.<group>`, drive the shared
 * cycle-safe resolver through the subsystem's `interpretRecipe` hook, and build the Model
 * rule-set group from the interpreted (ref-carrying) output. Subsystem-agnostic: the only
 * subsystem-specific knowledge is the `interpretRecipe` hook itself.
 */
function buildSubsystemRuleSets(
  subsystem: Subsystem,
  rawRecipes: Record<string, unknown> | undefined,
  ctx: {
    breakpoints: Record<string, number>;
    media: MediaDescriptor<string>;
    properties: RecipeInterpretContext["properties"];
    allowedBreakpoints: string[];
    allowedStates?: ReadonlyArray<string>;
    allowedContainers?: ReadonlyMap<string, ReadonlySet<string>>;
  },
): Record<string, RuleSetGroup> {
  if (!subsystem.interpretRecipe || !rawRecipes || !Object.keys(rawRecipes).length) {
    return {};
  }

  const groups: Record<string, RuleSetGroup> = {};
  for (const [groupName, groupDef] of Object.entries(rawRecipes)) {
    const groupPath = `${subsystem.key}.recipes.${groupName}`;
    const normalized = normalizeRecipeGroup(groupDef as Record<string, Record<string, unknown>>, {
      propertyPath: groupPath,
      allowedBreakpoints: ctx.allowedBreakpoints,
      allowedStates: ctx.allowedStates,
      allowedContainers: ctx.allowedContainers,
    });

    const resolver = createRecipeVariantResolver<
      Record<string, unknown>,
      string,
      InterpretedRecipeVariant<string>
    >(
      normalized,
      (variantName, variant, resolve) =>
        subsystem.interpretRecipe!(variantName, variant, {
          breakpoints: ctx.breakpoints,
          media: ctx.media,
          properties: ctx.properties,
          resolveRecipeVariant: resolve,
          groupPath,
        }),
      { groupPath },
    );

    // Build each variant's rule-set. When the subsystem extracts cross-subsystem references
    // (composition), keep them as Model pointers via `buildComponentRuleSetFromInterpreted`; else
    // a plain structural copy. Per-variant so the reference extraction reads the normalized base.
    const interpreted = resolver.resolveAll();
    const group: RuleSetGroup = {};
    for (const [variantName, interpretedVariant] of Object.entries(interpreted)) {
      if (subsystem.extractReferences) {
        const references = subsystem.extractReferences(normalized[variantName]?.base ?? {});
        group[variantName] = buildComponentRuleSetFromInterpreted(interpretedVariant, references);
      } else {
        group[variantName] = buildRuleSetFromInterpreted(interpretedVariant);
      }
    }
    groups[groupName] = group;
  }
  return groups;
}

/** Breakpoints → the core media descriptor. `mediaConfig` controls the emitted unit (px default, em/rem — §10.5 D6). */
const buildMedia = (
  breakpoints: Record<string, number>,
  mediaConfig?: MediaConfig,
): MediaDescriptor<string> =>
  buildMediaDescriptor(breakpoints, opts => mediaQueryString(opts, resolveMediaConfig(mediaConfig)));

/**
 * Normalize the authored `containers` config (§10.5) → the Model container map: default each
 * `container-type` to `inline-size` (D2), keep the `sizes` scale. Returns `undefined` for an absent /
 * empty config (additive — no `containers` field on the Model → byte-identical output).
 */
const normalizeContainers = (raw: unknown): Record<string, ContainerModel> | undefined => {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, ContainerModel> = {};
  for (const [name, def] of Object.entries(
    raw as Record<string, { type?: "inline-size" | "size"; sizes?: Record<string, number> }>,
  )) {
    if (!def || typeof def !== "object" || !def.sizes || !Object.keys(def.sizes).length) continue;
    out[name] = { type: def.type ?? "inline-size", sizes: { ...def.sizes } };
  }
  return Object.keys(out).length ? out : undefined;
};

/** Container model → `name → Set(sizeNames)`, the allowed-set recipe normalization validates container refs against. */
const containerSizeSets = (
  containers?: Record<string, ContainerModel>,
): ReadonlyMap<string, ReadonlySet<string>> | undefined => {
  if (!containers) return undefined;
  const map = new Map<string, ReadonlySet<string>>();
  for (const [name, c] of Object.entries(containers)) map.set(name, new Set(Object.keys(c.sizes)));
  return map;
};

/**
 * §W6b — resolve an authored `external` string to the literal parent CSS-variable name. A leading
 * `--` is a literal var (verbatim, any naming); otherwise it's a refract token path lowered to
 * `--<prefix>-<dashed-path>` — the parent's *default* naming (document that assumption).
 */
const resolveExternalVar = (external: string, prefix: string): string => {
  if (external.startsWith("--")) return external;
  const dashed = external.split(".").join("-").toLowerCase();
  return prefix ? `--${prefix}-${dashed}` : `--${dashed}`;
};

/**
 * §W6b — split a raw subsystem slice into its external-token properties (a value with a string
 * `external` key) and the remaining slice. The externals are pulled out BEFORE the subsystem runs, so
 * a `var(…)` passthrough never hits colour coercion / scale synthesis / unit tagging; they re-join as
 * normalized properties carrying `external` (the resolved parent var name).
 */
const extractExternals = (
  slice: Record<string, unknown> | undefined,
  prefix: string,
): { clean: Record<string, unknown> | undefined; externals: NormalizedProperties } => {
  if (!slice) return { clean: slice, externals: {} };
  const clean: Record<string, unknown> = {};
  const externals: NormalizedProperties = {};
  for (const [key, value] of Object.entries(slice)) {
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof (value as { external?: unknown }).external === "string"
    ) {
      const varName = resolveExternalVar((value as { external: string }).external, prefix);
      externals[key] = { base: `var(${varName})`, external: varName, responsive: [] } as NormalizedProperties[string];
    } else {
      clean[key] = value;
    }
  }
  return { clean, externals };
};

/** Context threaded into {@link buildSubsystemInput}. */
interface SubsystemBuildContext {
  readonly breakpoints: Record<string, number>;
  /** §W6b — the parent theme's var prefix (from `raw.extends.prefix`, default `"dt"`). */
  readonly extendsPrefix: string;
  readonly media: MediaDescriptor<string>;
  /** Media unit config (§10.5) — threaded to `buildStructural` for breakpoint-derived container widths. */
  readonly mediaConfig?: MediaConfig;
  readonly allowedBreakpoints: string[];
  readonly allowedStates?: ReadonlyArray<string>;
  /** Container queries (§10.5): `name → allowed size-names`, validated on container recipe overrides. */
  readonly allowedContainers?: ReadonlyMap<string, ReadonlySet<string>>;
  /**
   * Override only: the parent subsystem's reconstructed normalized properties. The partial's own
   * freshly-normalized properties are overlaid on top, and the union is the reference-resolution
   * context recipe interpretation reads (so a delta that touches only a recipe still resolves refs
   * against the inherited palette). Absent on the initial build (a subsystem's own props suffice).
   */
  readonly inheritedProperties?: NormalizedProperties;
}

/**
 * The per-subsystem "raw slice → {@link SubsystemModelInput}" build, extracted so BOTH the initial
 * build and `override` run the exact same normalization. Pure: normalize the slice's properties,
 * drive the generic recipe path (interpret against the inherited⊕own properties), and run the
 * structural generator hook. No spine control flow — a subsystem is data.
 */
function buildSubsystemInput(
  subsystem: Subsystem,
  rawSlice: Record<string, unknown> | undefined,
  ctx: SubsystemBuildContext,
): SubsystemModelInput {
  // §W6b — external-token properties are pulled out of the slice so the subsystem never coerces or
  // synthesizes a `var(…)` passthrough; they re-join as normalized properties carrying `external`.
  const { clean, externals } = extractExternals(rawSlice, ctx.extendsPrefix);
  const properties = subsystem.normalizeProperties(clean, {
    allowedBreakpoints: ctx.allowedBreakpoints,
  });
  Object.assign(properties, externals);
  // Recipe interpretation resolves refs against the subsystem's properties. On override the parent's
  // (reconstructed) properties are the base, the partial's fresh ones win on collision.
  const interpretProperties = ctx.inheritedProperties
    ? { ...ctx.inheritedProperties, ...properties }
    : properties;

  const recipeGroups = buildSubsystemRuleSets(
    subsystem,
    rawSlice?.recipes as Record<string, unknown> | undefined,
    {
      breakpoints: ctx.breakpoints,
      media: ctx.media,
      properties: interpretProperties,
      allowedBreakpoints: ctx.allowedBreakpoints,
      allowedStates: ctx.allowedStates,
      allowedContainers: ctx.allowedContainers,
    },
  );

  // Generator-driven rule-sets (layout's columns/grids/stacks/container). Structural groups insert
  // **ahead of** recipe groups; the config knobs merge into the subsystem's tokens as extraProperties.
  let ruleSetGroups = recipeGroups;
  let extraProperties: Record<string, PropertyModel> | undefined;
  let keyframes: Record<string, Keyframe> | undefined;
  if (subsystem.buildStructural && rawSlice) {
    const structural = subsystem.buildStructural(rawSlice, {
      breakpoints: ctx.breakpoints,
      media: ctx.media,
      mediaConfig: ctx.mediaConfig,
      // §9: a structural subsystem whose rule-sets carry recipe-style conditions (globals element
      // `states` / container `responsive`) validates them against the same sets the recipe path uses.
      allowedStates: ctx.allowedStates,
      allowedContainers: ctx.allowedContainers,
    });
    ruleSetGroups = { ...structural.ruleSetGroups, ...recipeGroups };
    if (Object.keys(structural.configProperties).length) {
      extraProperties = structural.configProperties;
    }
    // Keyframes (§10.2, animation) ride their own Model slot — neither rule-set nor token.
    if (structural.keyframes && Object.keys(structural.keyframes).length) {
      keyframes = structural.keyframes;
    }
  }

  const input: SubsystemModelInput = {};
  if (Object.keys(properties).length) input.properties = properties;
  if (Object.keys(ruleSetGroups).length) input.ruleSetGroups = ruleSetGroups;
  if (extraProperties) input.extraProperties = extraProperties;
  if (keyframes) input.keyframes = keyframes;
  return input;
}

/**
 * Reconstruct a subsystem's normalized-property view from its Model {@link PropertyModel}s — base
 * value + variant keys + scalar extras. This is the "everything override needs is in the Model"
 * principle: no raw retention. It only needs to be faithful enough for recipe **reference
 * resolution** (a name existing, its variant keys), which this shape provides. Subsystem-generic.
 */
function reconstructNormalizedProperties(
  subModel: SubsystemModel | undefined,
): NormalizedProperties {
  const out: NormalizedProperties = {};
  if (!subModel?.properties) return out;
  for (const [name, pm] of Object.entries(subModel.properties)) {
    const normalized: Record<string, unknown> = { base: pm.base.value };
    if (pm.variants && Object.keys(pm.variants).length) {
      const variants: Record<string, unknown> = {};
      for (const [vname, v] of Object.entries(pm.variants)) {
        // dec.3 — reconstruct the variant's base + its own extras for recipe reference resolution.
        const reconstructed: Record<string, unknown> = { base: v.base.value };
        if (v.extras) for (const [ename, ref] of Object.entries(v.extras)) reconstructed[ename] = ref.value;
        variants[vname] = reconstructed;
      }
      normalized.variants = variants;
    }
    if (pm.extras) {
      for (const [ename, ref] of Object.entries(pm.extras)) normalized[ename] = ref.value;
    }
    out[name] = normalized as NormalizedPropertyValue<unknown, Record<string, unknown>>;
  }
  return out;
}

/**
 * Immutable per-subsystem merge — **property-level replace** (a property in the partial replaces
 * the whole {@link PropertyModel}; untouched properties keep their reference) + **rule-set
 * variant-level replace within a group** (a variant in the partial replaces that variant; untouched
 * variants and untouched groups keep their references). New objects only at the touched levels;
 * everything else is shared. No per-subsystem branch — the shape is the same for all five.
 */
function mergeSubsystemModel(
  current: SubsystemModel | undefined,
  partial: SubsystemModel,
): SubsystemModel {
  if (!current) return partial;
  const merged: SubsystemModel = { ...current };
  if (partial.properties) {
    merged.properties = { ...(current.properties ?? {}), ...partial.properties };
  }
  if (partial.ruleSets) {
    const ruleSets: Record<string, RuleSetGroup> = { ...(current.ruleSets ?? {}) };
    for (const [group, groupRuleSets] of Object.entries(partial.ruleSets)) {
      ruleSets[group] = { ...(current.ruleSets?.[group] ?? {}), ...groupRuleSets };
    }
    merged.ruleSets = ruleSets;
  }
  // Keyframes (§10.2): name-level replace — a keyframe in the partial replaces that keyframe;
  // untouched ones keep their reference. Same rule as rule-set variants; additive when absent.
  if (partial.keyframes) {
    merged.keyframes = { ...(current.keyframes ?? {}), ...partial.keyframes };
  }
  return merged;
}

/**
 * DTCG round-trip: splice a prebuilt IR overlay (rule-sets / keyframes / containers) into a resolved
 * Model, reusing {@link mergeSubsystemModel} for the per-subsystem merge (no new merge logic). Returns
 * the model unchanged when no overlay option is set, so the standard build path stays byte-identical.
 */
function applyModelOverlay(model: ThemeModel, options: CreateThemeOptions): ThemeModel {
  const { propertiesOverlay, ruleSetsOverlay, keyframesOverlay, containersOverlay } = options;
  if (!propertiesOverlay && !ruleSetsOverlay && !keyframesOverlay && !containersOverlay) return model;
  const subsystems = { ...model.subsystems };
  const keys = new Set([
    ...Object.keys(propertiesOverlay ?? {}),
    ...Object.keys(ruleSetsOverlay ?? {}),
    ...Object.keys(keyframesOverlay ?? {}),
  ]);
  for (const key of keys) {
    subsystems[key] = mergeSubsystemModel(subsystems[key], {
      properties: propertiesOverlay?.[key],
      ruleSets: ruleSetsOverlay?.[key],
      keyframes: keyframesOverlay?.[key],
    });
  }
  const next: ThemeModel = { ...model, subsystems };
  if (containersOverlay) next.containers = { ...(model.containers ?? {}), ...containersOverlay };
  return next;
}

/** The stable engine an initial theme and every child derived from it share. */
interface ThemeEngine {
  readonly adapter: ThemeAdapter;
  readonly derivationRegistry: ReturnType<typeof buildDerivationRegistry>;
  readonly allowedStates?: ReadonlyArray<string>;
  /** Media unit config (§10.5 D6) — shared by the viewport `@media` + container `@container` descriptors. */
  readonly mediaConfig?: MediaConfig;
  /** Length-unit resolution config (§21) — `units` role map + `baseFontSize`. Stable across children. */
  readonly unitConfig?: UnitResolutionConfig;
}

export interface CreateThemeOptions<TAdapter extends ThemeAdapter = ThemeAdapter> {
  /** Required — the format target. Core ships no default adapter. */
  readonly adapter: TAdapter;
  /**
   * Media-query output config (§10.5) — `{ unit: "px" | "em" | "rem"; baseFontSize }`. Breakpoint and
   * container thresholds are authored as px numbers; `unit` controls the emitted unit (em/rem = value ÷
   * baseFontSize). Defaults to px. Stable across `override()` children.
   */
  readonly media?: MediaConfig;
  /**
   * Declaration-value length units (§21) — a token-path-prefix role map. `units.default` (global),
   * `units["<subsystem>"]`, `units["<subsystem>.<property>"]`; most-specific wins, over a built-in seed
   * (length subsystems → px, `lineHeight` → none, `letterSpacing` → em). A bare authored number is
   * deferred (resolved here); an explicit unit (`"1.5rem"`) is pinned. Unit intent is a theme fact, so it
   * lives here (not on the adapter): every adapter receives a Model with fully-resolved `{ value, unit }`.
   */
  readonly units?: UnitsConfig;
  /** Divisor for a deferred length resolving to `rem` (§21). Defaults to 16. */
  readonly baseFontSize?: number;
  /**
   * DTCG round-trip (§12 Phase 2) — prebuilt property Model to splice in **after** property build,
   * keyed `subsystem → property`. Carries the lossless bits the resolved DTCG token surface can't
   * (appearance `modes` / `responsive` / derivation refs / `external`); a property present here
   * REPLACES the one the standard tokens rebuilt (property-level merge). `fromDTCGTheme` sets it from
   * the `com.theme-registry.refract` extension. Absent → the standard build is untouched.
   */
  readonly propertiesOverlay?: Record<string, Record<string, PropertyModel>>;
  /**
   * DTCG round-trip — prebuilt, already-interpreted rule-set IR to splice into the Model **after**
   * property build, keyed `subsystem → group → variant`. Bypasses authoring/normalization (the IR is
   * a built Model slice, lengths already resolved), then flows through the normal `{ ref }` validation.
   * `fromDTCGTheme` sets this to restore recipes a DTCG document carried in its
   * `com.theme-registry.refract` extension. Rarely set by hand. Absent → the standard build is untouched.
   */
  readonly ruleSetsOverlay?: Record<string, Record<string, RuleSetGroup>>;
  /** DTCG round-trip — prebuilt keyframes to splice in, keyed `subsystem → name`. See {@link ruleSetsOverlay}. */
  readonly keyframesOverlay?: Record<string, Record<string, Keyframe>>;
  /** DTCG round-trip — prebuilt query containers to splice into the Model root. See {@link ruleSetsOverlay}. */
  readonly containersOverlay?: Record<string, ContainerModel>;
}

/** The public theme surface. Grows: `css`/recipe helpers (step 1). */
export interface Theme {
  /** The format-neutral held state — the single source of truth. */
  readonly model: ThemeModel;
  /**
   * Flat, lazy, cached `path -> Ref` view of the Model's property tokens
   * (`"<subsystem>.<property>[.<variant|extra>]"`). Aliases / derived steps stay as refs
   * (`{ ref }` / `{ ref, fn, arg }`), so the map is override-safe. Rule-sets are excluded.
   */
  readonly tokens: Record<string, Ref>;
  /**
   * Resolve one token path to its concrete literal — following aliases and running derivations
   * (`lighten` / `darken` / …) through the subsystem derivation registry. Throws on unknown paths.
   */
  readonly resolveToken: (path: string) => Literal;
  /**
   * Derive a **child** theme by immutably merging `partial` (a partial raw theme) into this theme's
   * Model. Only the partial's subsystem slices are re-normalized; the merge is a property /
   * rule-set-variant replace. The parent theme (Model, tokens, css) is untouched — call it again to
   * derive siblings. Overriding a colour base re-derives its synthesized steps automatically.
   *
   * Accepts a (partial) {@link RawTheme} — every key is already optional, so a delta touching one
   * subsystem slice is a valid `RawTheme`.
   */
  readonly override: (partial: RawTheme) => Theme;
}

export function createTheme(
  rawTheme: RawTheme,
  options: CreateThemeOptions,
): Theme {
  const { adapter } = options;

  // Bridge the strict authoring type to the loose spine once, at the boundary: subsystem hooks
  // still consume each `raw[key]` slice as `Record<string, unknown>` (types-only, no runtime change).
  const raw = rawTheme as Record<string, unknown>;
  const breakpoints = (raw.breakpoints as Record<string, number> | undefined) ?? DEFAULT_BREAKPOINTS;
  const allowedBreakpoints = Object.keys(breakpoints);
  // §W6b — the parent theme's var prefix for external-token passthroughs (default `"dt"`).
  const extendsPrefix = (raw.extends as { prefix?: string } | undefined)?.prefix ?? "dt";
  // The adapter owns the known-state set; core validates recipe `state:` refs against it (no CSS import).
  const allowedStates = adapter.allowedStates;
  // dec.1 — the appearance-mode registry. Property `modes` keys are validated against it (typo-detection).
  // Default `["dark", "light"]`; declaring `modes` is how a custom mode (e.g. `hc`) becomes valid.
  const allowedModes = new Set((raw.modes as string[] | undefined) ?? ["dark", "light"]);
  const mediaConfig = options.media;
  const media = buildMedia(breakpoints, mediaConfig);

  // Named query containers (§10.5): normalize the config, derive the allowed-size sets container
  // recipe overrides validate against. Absent → additive (no `containers` on the Model).
  const containers = normalizeContainers(raw.containers);
  const allowedContainers = containerSizeSets(containers);

  // Loop the subsystem list into per-subsystem Model inputs. Generic by construction:
  // a new subsystem is a push onto SUBSYSTEMS, never a change here.
  const subsystemInputs: Record<string, SubsystemModelInput> = {};
  for (const subsystem of SUBSYSTEMS) {
    const input = buildSubsystemInput(subsystem, raw[subsystem.key] as Record<string, unknown> | undefined, {
      breakpoints,
      extendsPrefix,
      media,
      mediaConfig,
      allowedBreakpoints,
      allowedStates,
      allowedContainers,
    });
    if (Object.keys(input).length) subsystemInputs[subsystem.key] = input;
  }

  const built = buildThemeModel({ breakpoints, containers, ...subsystemInputs } as BuildThemeModelInput);

  // §21: resolve every length leaf to a concrete `{ value, unit }` — the single format-neutral pass
  // that consults the `units` role map. Adapters downstream never see a deferred length. Default (no
  // `units`) tags px only → CSS/SCSS byte-identical. `unitConfig` is stable across `override()` children.
  const unitConfig: UnitResolutionConfig = { units: options.units, baseFontSize: options.baseFontSize };
  const resolved = resolveModelUnits(built, unitConfig);

  // DTCG round-trip: splice any prebuilt IR overlay (recipes/keyframes/containers a DTCG document
  // carried in its `com.theme-registry.refract` extension) into the Model AFTER unit resolution (the
  // overlay came from a built Model, so its lengths are already resolved) and BEFORE the ref-validation
  // below — so a restored rule-set's `{ ref }`s are validated exactly like an authored one.
  const overlaid = applyModelOverlay(resolved, options);

  // One derivation registry, collected generically from each subsystem's `derivations` map —
  // no subsystem-specific import here (spine stays control-flow-generic). Stable across children.
  const derivationRegistry = buildDerivationRegistry(
    SUBSYSTEMS.flatMap(subsystem => (subsystem.derivations ? [subsystem.derivations] : [])),
  );

  // dec.4 — fill every CROSS-property derived variant / mode value (a `{ ref, modifiers }` sourcing
  // another property) against the full token map, now that it exists. Byte-identical for a Model with
  // no cross-property derivation (returned by reference). Runs before validation so an unknown-source
  // ref fails loud here.
  const model = bakeCrossPropertyDerivations(overlaid, derivationRegistry);

  // §19 / §9 — post-build ref validation, collect-all (P2-3). A component `css` delta and a globals
  // element declaration are literal-first: a bare string is raw CSS; a `ref("…")` / `{ ref }` marks a
  // token path. Every marked `{ ref }` must resolve to a real token BEFORE any adapter runs, so a
  // mistyped path fails loud here instead of lowering to a dangling `var(--…)`. Both passes ACCUMULATE
  // their failures so an invalid theme reports every bad ref at once, as one `REFRACT_E_VALIDATION`.
  const validationErrors = [
    ...collectComponentReferenceErrors(model),
    ...collectComponentCssRefErrors(model),
    ...collectGlobalsRefErrors(model),
    ...collectModeErrors(model, allowedModes),
  ];
  if (validationErrors.length > 0) {
    const list = validationErrors.map(e => `  - ${e}`).join("\n");
    throw new RefractError(
      "REFRACT_E_VALIDATION",
      `refract: ${validationErrors.length} validation error(s):\n${list}`,
      validationErrors,
    );
  }

  return assembleTheme(model, { adapter, derivationRegistry, allowedStates, mediaConfig, unitConfig });
}

/**
 * dec.1 — validate every property `modes` key against the declared `modes` registry (default
 * `["dark", "light"]`). A mode name not in the registry is a typo or an undeclared custom mode; throw
 * so it fails loud (like an unknown breakpoint) instead of silently emitting a dead `[data-theme]` block.
 * Walks the built Model's per-subsystem property `modes` — the same post-build shape the other
 * collectors use. Initial-build only (mirrors the existing collect-* passes).
 */
function collectModeErrors(model: ThemeModel, allowedModes: ReadonlySet<string>): string[] {
  const errors: string[] = [];
  const report = (subKey: string, propName: string, mode: string, where: string): void => {
    if (!allowedModes.has(mode)) {
      errors.push(
        `${subKey}.${propName}${where}: unknown appearance mode '${mode}' — declare it in the top-level ` +
          `'modes' registry (known: ${[...allowedModes].join(", ")})`,
      );
    }
  };
  for (const [subKey, sub] of Object.entries(model.subsystems)) {
    for (const [propName, pm] of Object.entries(sub.properties ?? {})) {
      for (const entry of pm.modes ?? []) {
        if (entry.mode) report(subKey, propName, entry.mode, "");
      }
      // dec.9 — a responsive entry's `mode` condition is validated against the same registry.
      for (const entry of pm.responsive ?? []) {
        if (entry.mode) report(subKey, propName, entry.mode, " (responsive)");
      }
    }
  }
  return errors;
}

/**
 * A component variant references sibling recipes cross-subsystem (`colors: "solid.primary"` → stored as
 * `"colors:solid.primary"`). Those pointers are what compose the class-list at emit time — a reference
 * to a recipe that doesn't exist would silently drop from the composition and ship a button missing its
 * colours. Assert each `subsystem:group.variant` reference resolves to a real recipe in the built Model,
 * collect-all so every dangling reference is reported at once.
 */
function collectComponentReferenceErrors(model: ThemeModel): string[] {
  const ruleSets = model.subsystems.components?.ruleSets;
  if (!ruleSets) return [];
  const errors: string[] = [];
  for (const [group, ruleSetGroup] of Object.entries(ruleSets)) {
    for (const [variant, ruleSet] of Object.entries(ruleSetGroup)) {
      for (const reference of ruleSet.references ?? []) {
        const [subsystem, rest = ""] = reference.split(":");
        const dot = rest.indexOf(".");
        const refGroup = dot >= 0 ? rest.slice(0, dot) : rest;
        const refVariant = dot >= 0 ? rest.slice(dot + 1) : "";
        if (!model.subsystems[subsystem]?.ruleSets?.[refGroup]?.[refVariant]) {
          errors.push(
            `components.${group}.${variant}: Recipe variant "${refVariant}" is not defined in ` +
              `"${subsystem}:${refGroup}". Check the subsystem:group.variant reference against what the ` +
              `subsystem declares.`,
          );
        }
      }
    }
  }
  return errors;
}

/**
 * §19: validate every component `css`-delta reference. A component's own rule-set declarations are
 * literal-first — a bare authored string stays a literal; only a `ref("…")` / `{ ref }` marker becomes
 * a `{ ref }`. Assert each such `{ ref }` points at a real token in the flat global namespace
 * (`buildTokenMap`); an unknown path is a typo in the marked token path (a raw CSS value needs no
 * marker — it's just a bare string). Rule-set-only (components own no property tokens),
 * so this walks just the component `ruleSets` base declarations + their condition overrides.
 */
function collectComponentCssRefErrors(model: ThemeModel): string[] {
  const ruleSets = model.subsystems.components?.ruleSets;
  if (!ruleSets) return [];
  const tokens = buildTokenMap(model);
  const errors: string[] = [];
  const checkDecls = (
    declarations: Record<string, Ref> | undefined,
    group: string,
    variant: string,
    where: string,
  ): void => {
    for (const [property, ref] of Object.entries(declarations ?? {})) {
      if (ref.ref !== undefined && !(ref.ref in tokens)) {
        errors.push(
          `components.${group}.${variant}: css '${property}'${where} references unknown token ` +
            `'${ref.ref}' — check the token path, or use a bare string / number for a raw CSS value`,
        );
      }
    }
  };
  for (const [group, ruleSetGroup] of Object.entries(ruleSets)) {
    for (const [variant, ruleSet] of Object.entries(ruleSetGroup)) {
      checkDecls(ruleSet.declarations, group, variant, "");
      for (const override of ruleSet.overrides ?? []) {
        checkDecls(override.declarations, group, variant, " (override)");
      }
    }
  }
  return errors;
}

/**
 * §9: validate every `globals` themed-element reference. An element declaration is literal-first — a
 * `ref("…")` / `{ ref: "…" }` marker became `{ ref }`. Assert each `{ ref }` in the `kind:"globals"`
 * element rule-sets (base declarations, condition overrides, and each variant's delta) points at a real
 * token, throwing on an unknown path (a typo in the marked token path).
 * Only `kind:"globals"` is checked — the preset `static`/`defaults` layers (`kind:"reset"`) keep
 * their opportunistic drop policy (a ratio-less theme drops missing heading scale steps).
 */
function collectGlobalsRefErrors(model: ThemeModel): string[] {
  const ruleSets = model.subsystems.globals?.ruleSets;
  if (!ruleSets) return [];
  const tokens = buildTokenMap(model);
  const errors: string[] = [];
  const checkDecls = (
    declarations: Record<string, Ref> | undefined,
    selector: string,
    where: string,
  ): void => {
    for (const [property, ref] of Object.entries(declarations ?? {})) {
      if (ref.ref !== undefined && !(ref.ref in tokens)) {
        errors.push(
          `globals element '${selector}'${where}: '${property}' references unknown token ` +
            `'${ref.ref}' — check the token path, or use a bare string / number for a raw CSS value`,
        );
      }
    }
  };
  for (const ruleSetGroup of Object.values(ruleSets)) {
    for (const ruleSet of Object.values(ruleSetGroup)) {
      if (ruleSet.kind !== "globals") continue;
      const selector = ruleSet.selector ?? "";
      checkDecls(ruleSet.declarations, selector, "");
      for (const override of ruleSet.overrides ?? []) {
        checkDecls(override.declarations, selector, " (override)");
      }
      for (const [variantName, variant] of Object.entries(ruleSet.variants ?? {})) {
        const where = ` (variant '${variantName}')`;
        checkDecls(variant.declarations, selector, where);
        for (const override of variant.overrides ?? []) {
          checkDecls(override.declarations, selector, `${where} (override)`);
        }
      }
    }
  }
  return errors;
}

/**
 * Assemble the public theme surface over a Model — the token map, `resolveToken`, `adapter.bind`,
 * and the `override` seam. Called once for the initial Model and once per child (a fresh surface
 * over the merged Model), so parent and child never share mutable derived state — only the
 * immutable Model branches the merge left untouched.
 */
function assembleTheme(model: ThemeModel, engine: ThemeEngine): Theme {
  const media = buildMedia(model.breakpoints, engine.mediaConfig);
  // Per-named-container `@container` descriptors (§10.5), sharing the media unit config.
  const containers = buildContainerDescriptors(model.containers, engine.mediaConfig);

  // Flat `path -> Ref` token map, derived lazily from the Model and cached on the Model reference
  // (the locked caching principle). A child's new Model is a new WeakMap key → a fresh, un-stale map.
  const tokenMapCache = new WeakMap<ThemeModel, Record<string, Ref>>();
  const getTokens = (): Record<string, Ref> => {
    let map = tokenMapCache.get(model);
    if (!map) {
      map = buildTokenMap(model);
      tokenMapCache.set(model, map);
    }
    return map;
  };

  // Resolve one token path to a literal via the 0e resolver (also fills RenderContext.resolve).
  const resolve = (path: string): Literal =>
    resolveToken(getTokens(), engine.derivationRegistry, path);
  const ctx: RenderContext = { media, containers, resolve };

  // Bind the adapter once (curries Model + ctx onto the render surface). Its `extend` attaches the
  // adapter's own output surface (the CSS adapter → `css` / `variablesCss` / `recipesCss` / `nodes`
  // / `classes`, computed on demand). Core stays format-agnostic.
  const bound = engine.adapter.bind(model, ctx);

  const theme: Theme = {
    model,
    get tokens() {
      return getTokens();
    },
    resolveToken: resolve,
    override: partial => overrideTheme(model, partial as Record<string, unknown>, engine),
  };

  const extensions = bound.extend?.(theme as unknown as Record<string, unknown>);
  if (extensions) {
    Object.defineProperties(theme, Object.getOwnPropertyDescriptors(extensions));
  }

  return theme;
}

/**
 * `theme.override(partial)` — the delta merge. Normalize ONLY the partial's changed subsystem
 * slices through {@link buildSubsystemInput}, immutably merge those fragments into the current
 * Model ({@link mergeSubsystemModel}), and re-assemble onto the new Model. The parent Model is left
 * byte-identical (structural sharing for untouched branches). Recipe interpretation in the delta
 * resolves refs against the parent's reconstructed properties overlaid with the partial's own.
 */
function overrideTheme(
  currentModel: ThemeModel,
  partial: Record<string, unknown>,
  engine: ThemeEngine,
): Theme {
  const partialBreakpoints = partial.breakpoints as Record<string, number> | undefined;
  const nextBreakpoints = partialBreakpoints
    ? { ...currentModel.breakpoints, ...partialBreakpoints }
    : currentModel.breakpoints;
  const allowedBreakpoints = Object.keys(nextBreakpoints);
  const media = buildMedia(nextBreakpoints, engine.mediaConfig);

  // Containers (§10.5): a partial `containers` config merges by name into the parent's (like breakpoints).
  const partialContainers = normalizeContainers(partial.containers);
  const nextContainers = partialContainers
    ? { ...(currentModel.containers ?? {}), ...partialContainers }
    : currentModel.containers;
  const allowedContainers = containerSizeSets(nextContainers);

  // Shallow copy of the subsystem map; only the touched keys get a new SubsystemModel (the rest keep
  // their reference → real structural sharing, parent stays byte-identical).
  const nextSubsystems: Record<string, SubsystemModel> = { ...currentModel.subsystems };
  for (const subsystem of SUBSYSTEMS) {
    const rawSlice = partial[subsystem.key] as Record<string, unknown> | undefined;
    if (rawSlice === undefined) continue; // untouched subsystem → shared reference

    const inheritedProperties = reconstructNormalizedProperties(currentModel.subsystems[subsystem.key]);
    const partialInput = buildSubsystemInput(subsystem, rawSlice, {
      breakpoints: nextBreakpoints,
      // Parent externals survive via mergeSubsystemModel; this prefix only resolves a NEW external the
      // override partial itself introduces (partial `extends` wins, else the default `"dt"`).
      extendsPrefix: (partial.extends as { prefix?: string } | undefined)?.prefix ?? "dt",
      media,
      mediaConfig: engine.mediaConfig,
      allowedBreakpoints,
      allowedStates: engine.allowedStates,
      allowedContainers,
      inheritedProperties,
    });
    const partialSubModel = buildSubsystemModel(partialInput);
    if (!partialSubModel) continue; // the delta contributed nothing to this subsystem

    nextSubsystems[subsystem.key] = mergeSubsystemModel(currentModel.subsystems[subsystem.key], partialSubModel);
  }

  const nextModel: ThemeModel = { breakpoints: nextBreakpoints, subsystems: nextSubsystems };
  if (nextContainers && Object.keys(nextContainers).length) nextModel.containers = nextContainers;
  // §21: re-resolve length units on the merged Model. Idempotent — already-resolved parent branches
  // (units baked) are skipped; only the partial's freshly-built fragments get resolved.
  const resolved = resolveModelUnits(nextModel, engine.unitConfig);
  // dec.4 — re-bake cross-property derived values against the MERGED token map, so a child re-derives
  // them when the source property changed (even if the deriving property wasn't in the partial). The
  // pass is immutable, so the parent's shared Refs are never mutated.
  const baked = bakeCrossPropertyDerivations(resolved, engine.derivationRegistry);
  return assembleTheme(baked, engine);
}
