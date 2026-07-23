/**
 * Model builder (clean-room port of `core/common/buildModel.ts`).
 *
 * Pure functions that assemble the format-neutral {@link ThemeModel} from data the
 * pipeline computes — the normalized property collections and the interpreted recipe
 * groups. `buildThemeModel` consumes each subsystem's already-interpreted rule-set
 * groups (see `buildRuleSetGroupFromInterpreted`), whose declarations already carry
 * format-neutral {@link Ref}s (`{ ref: "colors.primary" }` for a token-path reference,
 * `{ value }` for a literal). The builder is a structural copy — it never string-parses
 * `var(--…)`; the interpreter emits canonical token paths directly.
 *
 * `pathify*` rewrites refs via a supplied map (used by later subsystems that still emit
 * var-name refs); `buildTokenMap` flattens the property tokens into a `path -> Ref` map.
 */
import type { NormalizedPropertyValue } from "../normalize";
import type { InterpretedRecipeGroup, InterpretedRecipeVariant } from "./interpreted";
import type {
  ContainerModel,
  Keyframe,
  Literal,
  PropertyModel,
  PropertyOverride,
  Ref,
  RuleSet,
  RuleSetGroup,
  RuleSetOverride,
  StructuredValue,
  SubsystemModel,
  ThemeModel,
  VariantModel,
} from "./model";
import { RefractError } from "../errors";

const isLiteral = (value: unknown): value is Literal =>
  typeof value === "string" || typeof value === "number";

/**
 * A structured compound value (§15) reaches the Model as an **array** of layers/parts (the owning
 * subsystem canonicalizes it in `coerceValue`). Colors serialize to a string before the Model, so
 * an array base here is unambiguously a §15 effects value → carried on `Ref.struct`.
 */
const isStructuredValue = (value: unknown): value is StructuredValue => Array.isArray(value);

const toRef = (value: Literal): Ref => ({ value });

/**
 * A base/variant value → its `Ref`: a `Literal` becomes the `value` cache; a structured compound
 * value (§15 shadow/transition) is carried on `struct` (no single literal to cache). Used wherever
 * a value may now be structured rather than scalar.
 */
const valueToRef = (value: unknown): Ref =>
  isStructuredValue(value) ? { struct: value } : toRef(value as Literal);

/** Build a variant `Ref`: a derived `{ ref, fn?, arg?, value }` when the normalized variant carries
 *  a `derive`, else a plain literal. `value` is kept as the cached resolution (the lowering reads it). */
const variantToRef = (
  value: Literal | undefined,
  derive?: { ref: string; fn?: string; arg?: unknown; modifiers?: Array<{ fn: string; arg?: unknown }> },
): Ref => {
  if (!derive) return toRef(value as Literal);
  const ref: Ref = { ref: derive.ref };
  if (derive.fn !== undefined) ref.fn = derive.fn;
  if (derive.arg !== undefined) ref.arg = derive.arg;
  if (derive.modifiers !== undefined) ref.modifiers = derive.modifiers; // dec.2 — carry the chain
  // dec.4 — a cross-property derivation arrives UNBAKED (`value` undefined); the post-build
  // `bakeCrossPropertyDerivations` pass fills it. Omit the key rather than set `value: undefined`.
  if (value !== undefined) ref.value = value;
  return ref;
};

/** Structural keys of a normalized appearance-mode override entry (`{ mode, target, base, derive,
 *  …literalExtras }`) — the condition/target keys + base/derive are NOT extras. */
const MODE_STRUCTURAL_KEYS: ReadonlySet<string> = new Set(["mode", "target", "base", "derive"]);

/**
 * One normalized appearance mode (`{ base?, derive?, …literalExtras }`) → its `field → Ref` map
 * (§10.3). `base` becomes a literal or derived `Ref` (a derived base must have been baked by the
 * owning subsystem hook — colors — so `base` and `derive.ref` are present); literal extras (e.g.
 * colors' `text`) each become a literal `Ref`. Field-keyed, mirroring a responsive override.
 */
const buildModeFields = (
  mode: Record<string, unknown>,
  propertyName: string,
  modeName: string,
): Record<string, Ref> => {
  const fields: Record<string, Ref> = {};
  const derive = mode.derive as
    | { ref?: string; fn?: string; arg?: unknown; modifiers?: Array<{ fn: string; arg?: unknown }> }
    | undefined;
  const base = mode.base;

  if (derive) {
    // A derived mode must name a source (`derive.ref`) so it can be baked — by the owning subsystem
    // (colors) for a same-property source, or by the post-build cross-property pass for a dotted one.
    // A derive WITHOUT a ref never got a baker (e.g. a non-colors subsystem) → fail loud.
    if (derive.ref === undefined) {
      throw new RefractError(
        "REFRACT_E_REFERENCE",
        `Derived appearance mode "${propertyName}.modes.${modeName}" was not baked — derived ` +
          `modes require a subsystem that resolves them (colors). Use a literal value instead.`,
      );
    }
    // `base` is the cached resolution for a same-property source; ABSENT for a dec.4 cross-property
    // source (filled post-build by `bakeCrossPropertyDerivations`). `variantToRef` omits the value key.
    fields.base = variantToRef(
      isLiteral(base) ? base : undefined,
      derive as { ref: string; fn?: string; arg?: unknown; modifiers?: Array<{ fn: string; arg?: unknown }> },
    );
  } else if (isLiteral(base)) {
    fields.base = toRef(base);
  } else if (isStructuredValue(base)) {
    fields.base = { struct: base };
  }

  for (const [key, value] of Object.entries(mode)) {
    if (MODE_STRUCTURAL_KEYS.has(key)) continue;
    if (isLiteral(value)) fields[key] = toRef(value);
  }
  return fields;
};

/** Own scalar (string/number) properties of `obj`, minus `exclude`, each wrapped as a `Ref`. */
const collectScalarRefs = (
  obj: Record<string, unknown>,
  exclude: ReadonlySet<string>,
): Record<string, Ref> => {
  const out: Record<string, Ref> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (exclude.has(key)) continue;
    if (isLiteral(value)) out[key] = toRef(value);
  }
  return out;
};

/**
 * Like {@link collectScalarRefs} but also carries a structured field value (§15) onto `Ref.struct`.
 * Used for responsive override fields, where a `base` may now be a structured shadow/transition value
 * (whole-value replacement) rather than a scalar.
 */
const collectFieldRefs = (
  obj: Record<string, unknown>,
  exclude: ReadonlySet<string>,
): Record<string, Ref> => {
  const out: Record<string, Ref> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (exclude.has(key)) continue;
    if (isLiteral(value)) out[key] = toRef(value);
    else if (isStructuredValue(value)) out[key] = { struct: value };
  }
  return out;
};

// ---------------------------------------------------------------------------
// Properties → PropertyModel
// ---------------------------------------------------------------------------

/** dec.3 — keys of a normalized variant that are NOT extras (the base value + its derivation meta). */
const VARIANT_STRUCTURAL_KEYS: ReadonlySet<string> = new Set(["base", "derive"]);

const PROPERTY_STRUCTURAL_KEYS: ReadonlySet<string> = new Set([
  "base",
  "responsive",
  "variants",
  "modes",
  // §W6b — an external property's `external` (the parent var name) rides on the base Ref, not as a
  // token extra; excluding it here prevents a spurious `<prop>.external` token leaking into the map.
  "external",
]);

const RESPONSIVE_CONDITION_KEYS: ReadonlySet<string> = new Set([
  "breakpoint",
  "query",
  "state",
  "orientation",
  "ref", // dec.5 — property-responsive swap source
  "modifiers", // dec.5 — derivation chain on `ref` (subsystem-baked; never a field)
  "mode", // dec.9 — property-responsive appearance-mode condition
  "variant", // recipe-responsive scope (recipe path still uses `variant`)
  "target",
  // §10.6 D6: a synthesized responsive ramp step carries derivation metadata (`derive`) alongside its
  // baked `base` value — excluded from plain field collection; the `base` override is rebuilt as a
  // derived Ref below. Ramp-config keys (`ratio`/`step`/`steps`) never reach here — the layout hook
  // expands a ramp entry into per-step `target` overrides during normalize.
  "derive",
  "ratio",
  "step",
  "steps",
]);

/**
 * One normalized property (`{ base, responsive, variants?, ...extras }`) → a
 * {@link PropertyModel}. `base` and each variant become value refs; scalar sibling
 * extras (e.g. colors' `text`) go in `extras`; the responsive list maps entry-for-entry.
 */
export const buildPropertyModel = (
  normalized: NormalizedPropertyValue<unknown, Record<string, unknown>>,
  propertyName = "property",
): PropertyModel => {
  const model: PropertyModel = {
    // §W6b — an external property carries the literal parent var name on its base Ref; the `value`
    // is the resolved `var(…)` string so raw `.value` readers (JSON, SC) stay happy.
    base:
      normalized.external !== undefined
        ? { value: `var(${normalized.external})`, external: normalized.external }
        : valueToRef(normalized.base),
  };

  const extras = collectScalarRefs(
    normalized as Record<string, unknown>,
    PROPERTY_STRUCTURAL_KEYS,
  );
  if (Object.keys(extras).length) model.extras = extras;

  if (normalized.variants && Object.keys(normalized.variants).length) {
    const variants: Record<string, VariantModel> = {};
    for (const [name, variant] of Object.entries(normalized.variants)) {
      let base: Ref | undefined;
      const variantDerive = (variant as {
        derive?: { ref: string; fn?: string; arg?: unknown; modifiers?: Array<{ fn: string; arg?: unknown }> };
      }).derive;
      if (isLiteral(variant.base)) {
        base = variantToRef(variant.base, variantDerive);
      } else if (isStructuredValue(variant.base)) {
        // §15: a structured shadow/transition variant (no derivation — those are colors-only).
        base = { struct: variant.base };
      } else if (variantDerive?.ref !== undefined) {
        // dec.4 — an UNBAKED cross-property derivation (base absent): carry the derived Ref with no
        // cached value; `bakeCrossPropertyDerivations` fills `.value` against the full token map.
        base = variantToRef(undefined, variantDerive);
      }
      if (!base) continue;
      // dec.3 — collect the variant's OWN extras (any non-structural leaf, e.g. colours' `text`) →
      // `--<prop>-<variant>-<extra>`, exactly like the property-level extras above.
      const variantExtras = collectScalarRefs(variant as Record<string, unknown>, VARIANT_STRUCTURAL_KEYS);
      variants[name] = Object.keys(variantExtras).length ? { base, extras: variantExtras } : { base };
    }
    if (Object.keys(variants).length) model.variants = variants;
  }

  // Appearance modes — a LIST of `PropertyOverride`s (each `{ mode, target?, overrides }`), so one
  // mode can carry several targeted entries. `buildModeFields` builds the field-map; `mode`/`target`
  // are structural (excluded from the extras it collects).
  const normalizedModes = (normalized as { modes?: Array<Record<string, unknown>> }).modes;
  if (normalizedModes && normalizedModes.length) {
    const modes: PropertyOverride[] = [];
    for (const entry of normalizedModes) {
      const modeName = entry.mode as string;
      const fields = buildModeFields(entry, propertyName, modeName);
      if (!Object.keys(fields).length) continue;
      const override: PropertyOverride = { mode: modeName, overrides: fields };
      if (typeof entry.target === "string") override.target = entry.target;
      modes.push(override);
    }
    if (modes.length) model.modes = modes;
  }

  if (normalized.responsive?.length) {
    const responsive: PropertyOverride[] = normalized.responsive.map(entry => {
      const e = entry as Record<string, unknown>;
      const override: PropertyOverride = { breakpoint: e.breakpoint as string };
      if (typeof e.query === "string") override.query = e.query as PropertyOverride["query"];
      if (typeof e.orientation === "string") override.orientation = e.orientation as PropertyOverride["orientation"];
      if (typeof e.ref === "string") override.ref = e.ref; // dec.5 — swap source (was `variant`)
      if (typeof e.mode === "string") override.mode = e.mode; // dec.9 — appearance-mode condition
      if (typeof e.target === "string") override.target = e.target;
      const overrides = collectFieldRefs(e, RESPONSIVE_CONDITION_KEYS);
      // §10.6 D6: a synthesized ramp step's `base` is a derived Ref (`{ ref, fn:"scaleStep", arg }`),
      // so `theme.tokens` / adapters carry the recipe just like a variant step. `value` stays the
      // cached resolution the lowering reads.
      const derive = e.derive as
        | { ref: string; fn?: string; arg?: unknown; modifiers?: Array<{ fn: string; arg?: unknown }> }
        | undefined;
      if (derive && overrides.base && overrides.base.value !== undefined) {
        overrides.base = variantToRef(overrides.base.value as Literal, derive);
      }
      if (Object.keys(overrides).length) override.overrides = overrides;
      return override;
    });
    model.responsive = responsive;
  }

  return model;
};

/** A whole normalized collection (`name → normalized property`) → `name → PropertyModel`. */
export const buildPropertiesModel = (
  collection: Record<string, NormalizedPropertyValue<unknown, Record<string, unknown>>>,
): Record<string, PropertyModel> => {
  const out: Record<string, PropertyModel> = {};
  for (const [name, normalized] of Object.entries(collection)) {
    out[name] = buildPropertyModel(normalized, name);
  }
  return out;
};

// ---------------------------------------------------------------------------
// Interpreted recipes → RuleSet (declarations carry refs)
// ---------------------------------------------------------------------------

/**
 * One *interpreted* recipe variant → a {@link RuleSet}. The interpreter has already
 * resolved every declaration to a {@link Ref} (`{ ref }` for token references, `{ value }`
 * for literals) and separated the condition axes from the declarations, so this is a
 * structural copy — **no string-parsing of `var(…)`**. Format-neutral by construction:
 * refs are token paths, not var names.
 */
export const buildRuleSetFromInterpreted = (
  variant: InterpretedRecipeVariant<string>,
): RuleSet => {
  const declarations = { ...variant.base };

  const overrides: RuleSetOverride[] = variant.responsive.map(entry => {
    const override: RuleSetOverride = {};
    if (entry.state !== undefined) override.state = entry.state;
    if (entry.breakpoint !== undefined) override.breakpoint = entry.breakpoint;
    if (entry.query !== undefined) override.query = entry.query;
    if (entry.orientation !== undefined) override.orientation = entry.orientation;
    if (entry.container !== undefined) override.container = entry.container;
    if (entry.size !== undefined) override.size = entry.size;
    if (entry.variant !== undefined) override.variant = entry.variant;
    if (entry.target !== undefined) override.target = entry.target;
    if (Object.keys(entry.declarations).length) override.declarations = { ...entry.declarations };
    return override;
  });

  return { kind: "recipe", declarations, overrides };
};

/** An interpreted recipe group (`variant → interpreted`) → a {@link RuleSetGroup} with refs. */
export const buildRuleSetGroupFromInterpreted = (
  group: InterpretedRecipeGroup<string>,
): RuleSetGroup => {
  const out: RuleSetGroup = {};
  for (const [name, variant] of Object.entries(group)) {
    out[name] = buildRuleSetFromInterpreted(variant);
  }
  return out;
};

/**
 * Rewrite a rule-set group's declaration refs from CSS var names to canonical **token paths**
 * (e.g. `--dt-color--primary` → `colors.primary`) using `varToPath`. Refs already absent from the
 * map are left untouched (var name preserved). Pure — returns a new group. Applied to the Model
 * copy so `theme.model` is format-neutral; the CSS adapter's own lowering is unaffected.
 */
export const pathifyRuleSetGroup = (
  group: RuleSetGroup,
  varToPath: Record<string, string>,
): RuleSetGroup => {
  const mapRef = (ref: Ref): Ref =>
    ref.ref !== undefined && varToPath[ref.ref] !== undefined
      ? { ...ref, ref: varToPath[ref.ref] }
      : ref;
  const mapDecls = (decls: Record<string, Ref>): Record<string, Ref> => {
    const out: Record<string, Ref> = {};
    for (const [prop, ref] of Object.entries(decls)) out[prop] = mapRef(ref);
    return out;
  };
  const out: RuleSetGroup = {};
  for (const [name, ruleSet] of Object.entries(group)) {
    out[name] = {
      ...ruleSet,
      declarations: mapDecls(ruleSet.declarations),
      overrides: ruleSet.overrides.map(override =>
        override.declarations
          ? { ...override, declarations: mapDecls(override.declarations) }
          : override,
      ),
    };
  }
  return out;
};

/**
 * Rewrite property tokens' refs from CSS var names to canonical token paths using `varToPath`
 * (base / variants / extras). Refs absent from the map are left untouched. Pure — returns a new
 * map. Used to pathify layout's structural-config `extraProperties` in the Model.
 */
export const pathifyProperties = (
  properties: Record<string, PropertyModel>,
  varToPath: Record<string, string>,
): Record<string, PropertyModel> => {
  const mapRef = (ref: Ref): Ref =>
    ref.ref !== undefined && varToPath[ref.ref] !== undefined
      ? { ...ref, ref: varToPath[ref.ref] }
      : ref;
  const mapRecord = (rec: Record<string, Ref>): Record<string, Ref> => {
    const out: Record<string, Ref> = {};
    for (const [key, ref] of Object.entries(rec)) out[key] = mapRef(ref);
    return out;
  };
  // dec.3 — a variant carries a base Ref + its own extras; map each.
  const mapVariants = (rec: Record<string, VariantModel>): Record<string, VariantModel> => {
    const out: Record<string, VariantModel> = {};
    for (const [key, v] of Object.entries(rec)) {
      out[key] = v.extras ? { base: mapRef(v.base), extras: mapRecord(v.extras) } : { base: mapRef(v.base) };
    }
    return out;
  };
  const out: Record<string, PropertyModel> = {};
  for (const [name, model] of Object.entries(properties)) {
    out[name] = {
      ...model,
      base: mapRef(model.base),
      ...(model.variants ? { variants: mapVariants(model.variants) } : {}),
      ...(model.extras ? { extras: mapRecord(model.extras) } : {}),
    };
  }
  return out;
};

/**
 * Extract `"subsystem:group.variant"` references from a component variant's normalized base, in
 * **authored order** — the order the composition references were written (`{ effects, layout }` →
 * `["effects:…", "layout:…"]`). The CSS adapter renders this ordered list into the className, so the
 * Model `references` array IS the canonical composition order (the referenced recipe classes precede
 * the component's own delta class). Only the cross-subsystem keys are recognised; other base keys
 * (`css`, literals) are skipped.
 */
export const extractComponentReferences = (
  rawVariantBase: Record<string, unknown>,
): string[] => {
  const references: string[] = [];
  for (const [key, value] of Object.entries(rawVariantBase)) {
    if (!COMPONENT_SUBSYSTEM_KEYS.has(key)) continue;
    if (typeof value === "string" && value.includes(".")) references.push(`${key}:${value}`);
  }
  return references;
};

/**
 * An interpreted component variant (its `css` delta) + its cross-subsystem `references`
 * → a component {@link RuleSet} (`kind: "recipe"`, own delta declarations carry refs,
 * cross-subsystem pointers kept as `references`).
 */
export const buildComponentRuleSetFromInterpreted = (
  variant: InterpretedRecipeVariant<string>,
  references: string[],
): RuleSet => {
  const ruleSet = buildRuleSetFromInterpreted(variant);
  ruleSet.kind = "recipe";
  if (references.length) ruleSet.references = references;
  return ruleSet;
};

// ---------------------------------------------------------------------------
// Components → RuleSet (cross-subsystem references + css delta)
// ---------------------------------------------------------------------------

const COMPONENT_SUBSYSTEM_KEYS: ReadonlySet<string> = new Set([
  "colors",
  "typography",
  "layout",
  "effects",
  "borders",
]);

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/**
 * One subsystem's Model input. `ruleSetGroups` carries the already-interpreted rule-sets
 * (declarations with refs) that `createTheme` produces.
 */
export type SubsystemModelInput = {
  properties?: Record<string, NormalizedPropertyValue<unknown, Record<string, unknown>>>;
  ruleSetGroups?: Record<string, RuleSetGroup>;
  /**
   * Already-built {@link PropertyModel}s to merge into `properties` (after the normalized ones).
   * Layout uses this to carry its structural config knobs (columns/container size, gutter, inset)
   * as tokens — the subsystem's `buildStructural` hook emits them (see `subsystems/layout/structural.ts`).
   */
  extraProperties?: Record<string, PropertyModel>;
  /**
   * Named keyframe definitions (§10.2) — the animation subsystem's `buildStructural` output. Neither
   * property nor rule-set; attached to {@link SubsystemModel.keyframes} verbatim.
   */
  keyframes?: Record<string, Keyframe>;
};

/** Everything `buildThemeModel` needs — read from `createTheme`'s live caches/sources. */
export type BuildThemeModelInput = {
  breakpoints: Record<string, number>;
  /** Named query containers (§10.5) — carried onto the Model verbatim. Additive (absent → no field). */
  containers?: Record<string, ContainerModel>;
  colors?: SubsystemModelInput;
  typography?: SubsystemModelInput;
  layout?: SubsystemModelInput;
  effects?: SubsystemModelInput;
  /** Borders (§14): stroke geometry (width/style/offset/radius) + border/outline recipes. */
  borders?: SubsystemModelInput;
  animation?: SubsystemModelInput;
  components?: {
    ruleSetGroups?: Record<string, RuleSetGroup>;
  };
  globals?: SubsystemModelInput;
};

const hasEntries = (obj: Record<string, unknown> | undefined): boolean =>
  !!obj && Object.keys(obj).length > 0;

/**
 * One subsystem's Model input → a {@link SubsystemModel} (normalized properties built into
 * {@link PropertyModel}s, `extraProperties` merged in, rule-set groups attached). Returns
 * `undefined` when the slice contributes nothing. Exported so `override` can turn a *partial*
 * subsystem input into a Model fragment with the exact same shape the initial build produces.
 */
export const buildSubsystemModel = (
  slice: SubsystemModelInput | undefined,
): SubsystemModel | undefined => {
  if (!slice) return undefined;
  const model: SubsystemModel = {};
  if (slice.properties && Object.keys(slice.properties).length) {
    model.properties = buildPropertiesModel(slice.properties);
  }
  if (slice.extraProperties && Object.keys(slice.extraProperties).length) {
    model.properties = { ...(model.properties ?? {}), ...slice.extraProperties };
  }
  if (hasEntries(slice.ruleSetGroups)) model.ruleSets = slice.ruleSetGroups;
  if (hasEntries(slice.keyframes)) model.keyframes = slice.keyframes;
  return Object.keys(model).length ? model : undefined;
};

/** Assemble the whole {@link ThemeModel} from the pipeline's normalized data + rule-set groups. */
export const buildThemeModel = (input: BuildThemeModelInput): ThemeModel => {
  const subsystems: Record<string, SubsystemModel> = {};

  const colors = buildSubsystemModel(input.colors);
  if (colors) subsystems.colors = colors;

  const typography = buildSubsystemModel(input.typography);
  if (typography) subsystems.typography = typography;

  const layout = buildSubsystemModel(input.layout);
  if (layout) subsystems.layout = layout;

  const effects = buildSubsystemModel(input.effects);
  if (effects) subsystems.effects = effects;

  // Borders (§14): stroke geometry + border/outline recipes. Positioned after effects (matching the
  // SUBSYSTEMS order); a theme with no `borders` slice yields none → byte-identical for such themes.
  const borders = buildSubsystemModel(input.borders);
  if (borders) subsystems.borders = borders;

  // Animation (§10.2): motion tokens (duration/easing/delay) + keyframes + animation-shorthand
  // recipes. Positioned after effects; a theme with no `animation` slice yields none → byte-identical.
  const animation = buildSubsystemModel(input.animation);
  if (animation) subsystems.animation = animation;

  if (hasEntries(input.components?.ruleSetGroups)) {
    subsystems.components = { ruleSets: input.components!.ruleSetGroups };
  }

  // Globals is last (§9): a selector-targeting rule-set subsystem (no properties) — the `kind:"reset"`
  // preset layers + `kind:"globals"` themed elements. Its refs resolve late in the adapter, so its
  // Model position is immaterial — the adapter hoists the preset layer ahead.
  const globals = buildSubsystemModel(input.globals);
  if (globals) subsystems.globals = globals;

  const model: ThemeModel = { breakpoints: input.breakpoints, subsystems };
  if (input.containers && Object.keys(input.containers).length) model.containers = input.containers;
  return model;
};

// ---------------------------------------------------------------------------
// Token map (flat `path -> Ref` view of the Model's property tokens)
// ---------------------------------------------------------------------------

/**
 * Flatten a {@link ThemeModel} into one `path -> Ref` map — one entry per property token:
 * `"<subsystem>.<property>"` (base), `"<subsystem>.<property>.<variant>"`, and
 * `"<subsystem>.<property>.<extra>"`. Rule-sets are not tokens and are excluded. Each entry is
 * the Model's own `Ref` — `{ value }` for a literal, `{ ref }` for a reference. Additive source
 * for `theme.tokens`; the flat, format-neutral replacement for the per-subsystem `tokens` shape.
 */
export const buildTokenMap = (model: ThemeModel): Record<string, Ref> => {
  const out: Record<string, Ref> = {};
  for (const [subsystem, subModel] of Object.entries(model.subsystems)) {
    for (const [property, propertyModel] of Object.entries(subModel.properties ?? {})) {
      const base = `${subsystem}.${property}`;
      out[base] = propertyModel.base;
      for (const [variant, v] of Object.entries(propertyModel.variants ?? {})) {
        out[`${base}.${variant}`] = v.base;
        // dec.3 — a variant's extras are addressable tokens too: `<prop>.<variant>.<extra>`.
        for (const [field, ref] of Object.entries(v.extras ?? {})) {
          out[`${base}.${variant}.${field}`] = ref;
        }
      }
      for (const [field, ref] of Object.entries(propertyModel.extras ?? {})) {
        out[`${base}.${field}`] = ref;
      }
    }
  }
  return out;
};
