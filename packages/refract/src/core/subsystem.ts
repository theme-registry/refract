/**
 * The minimal subsystem descriptor (Step 0d).
 *
 * `createTheme`'s spine loops a `SUBSYSTEMS` list of these — never subsystem-specific
 * control flow. Growing the pipeline = pushing a `Subsystem` (or filling a hook on the
 * type), so the spine's shape is fixed while its coverage grows step by step.
 *
 * Day one carries a single hook — `normalizeProperties` — enough for the colors
 * property slice. Recipe / slice hooks land alongside their steps (recipes: step 1+).
 */

import type { NormalizedPropertyValue, NormalizedRecipeVariant } from "./normalize";
import type { DerivationRegistry } from "./derive";
import type { InterpretedRecipeVariant, Keyframe, PropertyModel, RuleSetGroup } from "./model";
import type { MediaConfig, MediaDescriptor } from "./media";

/** A subsystem's normalized property collection (`name → normalized property`). */
export type NormalizedProperties = Record<
  string,
  NormalizedPropertyValue<unknown, Record<string, unknown>>
>;

/** Context threaded into a subsystem's normalize hooks by the spine. */
export interface SubsystemNormalizeContext {
  /** The theme's breakpoint keys — responsive references are validated against these. */
  readonly allowedBreakpoints: string[];
}

/** Context threaded into a subsystem's `buildStructural` hook by the spine. */
export interface StructuralContext {
  readonly breakpoints: Record<string, number>;
  readonly media: MediaDescriptor<string>;
  /** Media unit config (§10.5) — so breakpoint-DERIVED lengths (fixed-container widths) can format in
   *  the same px/em/rem unit the `@media` thresholds use. Absent → px. */
  readonly mediaConfig?: MediaConfig;
  /**
   * The adapter's known-state set (§9) — a structural subsystem whose rule-sets carry recipe-style
   * condition axes (globals' themed element `states`) validates its `state:` refs against this, the
   * same set the generic recipe path uses. Absent ⇒ no state validation (generator subsystems that
   * emit no conditions, e.g. layout).
   */
  readonly allowedStates?: ReadonlyArray<string>;
  /** Container queries (§10.5) — `name → allowed size-names`, validated on a structural rule-set's
   *  container overrides (globals element `responsive` container entries). */
  readonly allowedContainers?: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * A subsystem's structural (generator-driven) Model contribution — rule-set groups that aren't
 * authored recipes (layout's columns/grids/stacks/container), plus already-built config
 * `PropertyModel`s to merge into the subsystem's tokens (Model `extraProperties`). Declarations
 * carry token-path refs, never CSS — the CSS adapter lowers them.
 */
export interface StructuralOutput {
  readonly ruleSetGroups: Record<string, RuleSetGroup>;
  readonly configProperties: Record<string, PropertyModel>;
  /**
   * Named keyframe definitions (§10.2) — the animation subsystem's contribution. Neither a
   * rule-set nor a config token, so it rides its own slot; threaded into
   * {@link SubsystemModelInput.keyframes} and attached to {@link SubsystemModel.keyframes}. Absent
   * ⇒ no keyframes (the common case — layout/reset return none).
   */
  readonly keyframes?: Record<string, Keyframe>;
}

/**
 * Context threaded into a subsystem's `interpretRecipe` hook by the generic recipe path.
 *
 * The subsystem resolves each recipe declaration against its **own** normalized
 * `properties` (reference-syntax knowledge is subsystem-specific), emitting token-path
 * refs. `resolveRecipeVariant` pulls a sibling's already-interpreted form (cycle-safe).
 */
export interface RecipeInterpretContext {
  readonly breakpoints: Record<string, number>;
  readonly media: MediaDescriptor<string>;
  /** The subsystem's own normalized property collection — the reference resolution source. */
  readonly properties: NormalizedProperties;
  /** Resolve a sibling variant in the same group (for responsive `variant:` swaps). */
  readonly resolveRecipeVariant: (variantName: string) => InterpretedRecipeVariant<string>;
  /** `"<subsystem>.recipes.<group>"` — used for error labels. */
  readonly groupPath: string;
}

/** A subsystem plugged into the `createTheme` spine. */
export interface Subsystem {
  /** The `rawTheme[key]` slice this subsystem owns (also its Model namespace). */
  readonly key: string;
  /**
   * Normalize the subsystem's raw property slice into the canonical shape the Model
   * builder consumes. Reserved sub-keys (e.g. `recipes`) are the subsystem's to skip.
   */
  normalizeProperties(
    rawSlice: Record<string, unknown> | undefined,
    ctx: SubsystemNormalizeContext,
  ): NormalizedProperties;
  /**
   * Interpret one normalized recipe variant into declaration {@link InterpretedRecipeVariant}
   * refs. Required for a subsystem with recipes; the generic recipe path (in `createTheme`)
   * drives it through the shared normalize + cycle-safe resolver, then builds the Model
   * rule-sets from the interpreted output. Absent ⇒ the subsystem contributes no rule-sets.
   */
  interpretRecipe?(
    variantName: string,
    variant: NormalizedRecipeVariant<Record<string, unknown>, string>,
    ctx: RecipeInterpretContext,
  ): InterpretedRecipeVariant<string>;
  /**
   * Extract cross-subsystem recipe references (`"colors:solid.primary"`, …) from a normalized
   * variant's base — the composition (components) subsystem's hook. When present, the generic recipe
   * path builds each rule-set via `buildComponentRuleSetFromInterpreted` (keeping the references as
   * Model pointers, so the referenced recipe's own states ride along on its shared class) instead of
   * the plain `buildRuleSetFromInterpreted`. Absent ⇒ a subsystem contributes no references (the
   * common case). Keeps the spine generic: the recipe path is reference-aware without a
   * components-specific branch.
   */
  extractReferences?(normalizedVariantBase: Record<string, unknown>): string[];
  /**
   * Emit generator-driven rule-sets + config tokens (layout's columns/grids/stacks/container).
   * The spine calls this once per subsystem that provides it, merging the structural rule-set
   * groups **ahead of** the recipe groups and passing the config tokens as `extraProperties`.
   * Absent ⇒ the subsystem has no structural output. Kept generic: no subsystem-specific
   * control flow in the spine — pushing a subsystem with this hook is enough.
   */
  buildStructural?(
    rawSlice: Record<string, unknown>,
    ctx: StructuralContext,
  ): StructuralOutput;
  /**
   * The subsystem's value-derivation fns (`fn name -> DerivationFn`), keeping the spine
   * generic: the spine collects `derivations` across `SUBSYSTEMS` into one registry rather
   * than importing any subsystem's fns. Colors contributes `{ lighten, darken }`; a subsystem
   * with no synthesized steps omits it. Duplicate fn names across subsystems throw.
   */
  readonly derivations?: DerivationRegistry;
}
