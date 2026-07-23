/**
 * Format-neutral Model types (clean-room port of `core/common/model.ts`).
 *
 * The representation every subsystem produces. The Model has just two kinds of
 * thing — **tokens** (`PropertyModel`) and **rule-sets** (`RuleSet`) — and one
 * shared reference node (`Ref`) for every leaf. Adapters lower the Model to
 * CSS / SCSS / styled-components / JSON; the Model itself commits to no format.
 *
 * See `.notes/reference/model-first-pipeline-plan.md` for the full design.
 */

/** A resolved literal value a `Ref` can carry (unit-less, no `var()` / `$`). */
export type Literal = string | number;

export type ResponsiveQueryKind = "min" | "max" | "exact";
export type Orientation = "landscape" | "portrait";

// The length-unit types live in `../units` (which owns the CSS unit set + resolution); imported
// type-only so the Model stays runtime-independent of the resolver. `Unit` tags a resolved length
// leaf (§21); `ShadowDimension` is a shadow geometry field after the §21 widening.
import type { Unit, ShadowDimension } from "../units";

// ---------------------------------------------------------------------------
// Structured leaf values (§15) — format-neutral compound token values
// ---------------------------------------------------------------------------

/**
 * A structured box-shadow layer (§15) — geometry as unit-less px numbers, `color` a **token-path
 * ref** (`"colors.shadow"`) the adapter resolves late (CSS `var(--…)`, RN `shadowColor`). Kept
 * structured (not a pre-serialized CSS string) so non-CSS adapters can lower each field; the CSS
 * adapter composes `<offsetX> <offsetY> <blur> <spread> var(--color)`. A box-shadow value is one
 * or more layers ({@link StructuredValue}).
 */
export type ShadowLayer = {
  offsetX?: ShadowDimension;
  offsetY?: ShadowDimension;
  blur?: ShadowDimension;
  spread?: ShadowDimension;
  /** Canonical `colors.*` token path (never an embedded literal — §15.1). Translucency comes from
   * the referenced colour itself — an `alpha` colour variant (§13.3) — not a shadow-level field. */
  color?: string;
  inset?: boolean;
};

/**
 * A structured transition part (§15) — `property` + `duration`/`delay` in **ms** (numbers) +
 * `timingFunction` (keyword or `cubic-bezier(…)` string, not a ref in v1 — §15.5). Kept structured
 * so RN/JSON can lower it; the CSS adapter composes `<property> <duration>ms <timing> <delay>ms`.
 * A transition value is one or more parts ({@link StructuredValue}).
 */
export type TransitionPart = {
  property: string;
  duration?: number;
  timingFunction?: string;
  delay?: number;
};

/**
 * A structured compound leaf value (§15) — the Model's format-neutral carriage for shadow /
 * transition tokens whose value is not a single {@link Literal}. Always an **array** (canonicalized
 * in the owning subsystem's coerce step): a single-layer/part token is a one-element array, so
 * adapters map+join uniformly. Carried on {@link Ref.struct}; `Ref.value` stays a `Literal` cache.
 */
export type StructuredValue = ShadowLayer[] | TransitionPart[];

/**
 * The one shared reference node — every leaf in both the property and rule-set
 * models is a `Ref`. At least one of `ref` / `value` is present.
 *
 * - `ref`   — canonical token path in the model namespace, e.g. `"color.primary.dark"`.
 *             A property leaf's `ref` is its own address; a rule-set declaration's
 *             `ref` points into that namespace. The adapter turns it into
 *             `var(--…)` / `$…` / `theme.…` / the inlined value.
 * - `value` — the resolved literal (for inlining, or when there is no token).
 * - `fn`    — value-derivation fn name (run by the derivation registry), e.g. `"darken"`:
 *             the token's value = `fn(resolve(ref), arg)`. Requires `ref`.
 * - `arg`   — argument passed to the derivation `fn` (also where synthesis config is retained).
 * - `wrap`  — adapter OUTPUT wrap on a rule-set declaration, e.g. `"blur"` → CSS `blur(<value>)`.
 *             Distinct from `fn`; never appears on a token.
 * - `struct`— a structured compound value (§15) for shadow / transition tokens whose value is not a
 *             single `Literal` (an array of {@link ShadowLayer} / {@link TransitionPart}). Additive:
 *             adapters that understand the structure compose it; `value` remains the `Literal` cache
 *             (undefined for a purely-structured token). Never appears on a rule-set declaration ref.
 * - `unit`  — the resolved length unit on a length leaf (§21). Present only after unit resolution has
 *             tagged this leaf (`{ value: 24, unit: "rem" }`); absent means unit-less (opacity/zIndex)
 *             or a raw-string value. Adapters stringify a length leaf as `value + (unit ?? "")`.
 */
export type Ref = {
  ref?: string;
  value?: Literal;
  fn?: string;
  arg?: unknown;
  /**
   * dec.2 — an ordered derivation CHAIN applied to the resolved `ref` (folded left-to-right by
   * `resolveToken`: `value = modifiers.reduce((v, {fn,arg}) => registry[fn](v, arg), resolve(ref))`).
   * Set by the `{ ref, modifiers }` authoring grammar; single-step synthesized derivations
   * (tonal steps / harmony) still use the flat `fn`/`arg`. Present ⇒ `fn`/`arg` are absent.
   */
  modifiers?: Array<{ fn: string; arg?: unknown }>;
  wrap?: string;
  struct?: StructuredValue;
  unit?: Unit;
  /**
   * §W6b — an **external** token: a passthrough to a CSS variable a *parent* theme defines. The
   * string is the literal parent var name (`--dt-colors-brand` / `--mat-sys-bg`). When present the
   * token is never emitted as a definition (the parent owns it); references lower to `var(<external>)`
   * verbatim, `resolveToken` yields that `var(…)` string, and colour synthesis is skipped.
   */
  external?: string;
};

// ---------------------------------------------------------------------------
// Property model (tokens)
// ---------------------------------------------------------------------------

/**
 * A property (token) after `buildPropertyModel`: resolved values kept as `Ref`s,
 * variants, and responsive as structured data. Subsystem-specific sibling nodes
 * (e.g. colors' `text`) live in `extras`. ({@link PropertyOverride} + {@link OverrideCondition}
 * are defined below, in the shared rule-set section — modes/responsive/states share that spine.)
 */
/**
 * dec.3 — one property variant in the Model. `base` is the variant's primary value (a literal or
 * derived `Ref`, or an alias to the property base when the author omitted it — base optional + inherit).
 * `extras` are the variant's own sibling values (e.g. colours' `text`), each lowered to
 * `--<prop>-<variant>-<extra>`, exactly like the property-level {@link PropertyModel.extras}.
 */
export type VariantModel = {
  base: Ref;
  extras?: Record<string, Ref>;
};

export type PropertyModel = {
  base: Ref;
  variants?: Record<string, VariantModel>;
  /**
   * Appearance-mode overrides (§10.3) — a **list** of {@link PropertyOverride}s, each carrying its
   * `mode` (+ optional `target` to scope into a variant's var) and an `overrides` field-map (`base`
   * + subsystem extras like colours' `text`, each a literal or derived `Ref`). A list (not a
   * `mode → fields` map) so one mode can carry several targeted entries. Adapters group by `mode`
   * and realize each as conditional blocks (CSS: `prefers-color-scheme` media + `[data-theme]`).
   */
  modes?: PropertyOverride[];
  responsive?: PropertyOverride[];
  extras?: Record<string, Ref>;
};

// ---------------------------------------------------------------------------
// Rule-sets (recipes + layout presets + columns)
// ---------------------------------------------------------------------------

/**
 * The **shared override spine** — the one condition/target structure every override array entry
 * carries (property `modes` / `responsive`, recipe `states` / `responsive`). Each array fills only
 * the axes meaningful to it; all are optional here. Three axes of intent:
 *  - **WHEN** — `mode` (appearance mode) · `state` (recipe pseudo-state) · `breakpoint` (+`query` /
 *    `orientation`) · `container` + `size` (container-query, in place of `breakpoint`).
 *  - **WHERE** — `target`: scope the override into a variant's var / a `<item>-<variant>` sibling
 *    rule (omit → the base var / base rule).
 *  - **READ** — `ref` (dec.5 read-source: the destination swaps to this variant's var) · `variant`
 *    (recipe swap to a sibling rule-set of the same group).
 * `PropertyOverride` and `RuleSetOverride` extend this with their respective payload record.
 */
export type OverrideCondition = {
  /** appearance-mode condition (property modes; property responsive via dec.9). */
  mode?: string;
  /** recipe pseudo-state condition (recipe states + responsive). */
  state?: string;
  breakpoint?: string;
  query?: ResponsiveQueryKind;
  orientation?: Orientation;
  /** Container-query axis (§10.5): the named container this override responds to (in place of `breakpoint`). */
  container?: string;
  /** The size-name in that container's threshold scale (used with `container`). */
  size?: string;
  /** dec.5 READ source: the destination var swaps to this variant's var (`var(--<prop>-<ref>)`). */
  ref?: string;
  /** swap to a sibling rule-set of the same group (recipe responsive). */
  variant?: string;
  /** WHERE — scope the override into a variant's var / a sibling rule-set's rule. */
  target?: string;
};

/**
 * One conditioned override on a **property's tokens** (a `modes` or `responsive` entry). The payload
 * is `field → Ref` (`base` + subsystem extras like colours' `text`), each a literal or derived `Ref`.
 * Shares {@link OverrideCondition} with recipe overrides; a mode entry carries `mode`, a responsive
 * entry carries `breakpoint` (+ optionally `mode`), either may carry `target`.
 */
export type PropertyOverride = OverrideCondition & {
  overrides?: Record<string, Ref>;
};

/**
 * @deprecated Use {@link PropertyOverride}. Retained as an alias during the unified-override-array
 * migration; a property `responsive` entry is a `PropertyOverride`.
 */
export type PropertyResponsiveOverride = PropertyOverride;

/** One conditioned override on a rule-set — `state` and/or `breakpoint` + its declarations. */
export type RuleSetOverride = OverrideCondition & {
  declarations?: Record<string, Ref>;
};

/**
 * One `globals` element variant (§9) — a named, delta-only modifier on a themed element rule-set.
 * Carries just what it changes (its own `declarations` + condition `overrides`); the cascade
 * supplies the base. Adapters render it as a higher-specificity selector — the CSS adapter as a
 * self-scoped class (`a.subtle`), the styled-components / SCSS adapters as a nested `&.<name>`
 * block. Kept structural (a base selector + this named-variant map) so each adapter builds its own
 * idiom, rather than a pre-joined selector baked into the Model.
 */
export type GlobalsVariant = {
  declarations: Record<string, Ref>;
  overrides: RuleSetOverride[];
};

/**
 * A named `{ declarations, overrides }` block — the one shape for everything on the
 * non-token side. Recipes are the authored flavor; layout grids/stacks/container/columns
 * are presets/generated; reset/base rule-sets target raw element selectors. Keyed by real
 * kebab-case CSS properties (`"box-sizing"`, `"font-size"`).
 *
 * - `kind`         — `"recipe"` (composable; default), `"utility"` (apply-in-markup, e.g. columns),
 *                    `"reset"` (the `globals` normalization preset layer — targets an explicit
 *                    `selector` at specificity-0 `:where(sel)`), or `"globals"` (a themed element
 *                    rule — targets a bare `selector` at a higher tier, carrying `variants`).
 * - `selector`     — `kind:"reset"` / `kind:"globals"` only: the raw selector this rule-set targets
 *                    (element `h1` / grouped `h1,h2` / universal `*` / attribute `[hidden]` / pseudo
 *                    `::placeholder`). `reset` wraps it for specificity-0 (`:where(sel)`); `globals`
 *                    emits it bare; absent for minted classes.
 * - `references`   — components only: `"subsystem:group.variant"` recipe-level refs (composition).
 * - `declarations` — base (no condition).
 * - `overrides`    — the unified state/breakpoint condition list.
 * - `variants`     — `kind:"globals"` only: named delta modifiers (§9), each an adapter-scoped
 *                    higher-specificity variant of the element (`a.subtle` / `&.subtle`).
 */
export type RuleSet = {
  kind?: "recipe" | "utility" | "reset" | "globals";
  selector?: string;
  references?: string[];
  declarations: Record<string, Ref>;
  overrides: RuleSetOverride[];
  variants?: Record<string, GlobalsVariant>;
};

/** A named group of rule-sets: variant/name → `RuleSet` (e.g. `solid`, `grids`, `columns`). */
export type RuleSetGroup = Record<string, RuleSet>;

// ---------------------------------------------------------------------------
// Keyframes (§10.2)
// ---------------------------------------------------------------------------

/**
 * One step of a keyframe — its stop position + the declarations at that stop. The `stop` is the
 * authored key kept **verbatim** (`"from"`, `"to"`, `"0%"`, `"50%"`, even a grouped `"0%, 100%"`),
 * so the representation commits to no format — a CSS adapter renders `<stop> { … }`, an SC adapter
 * feeds its `keyframes` helper, an RN adapter maps stops to `Animated` interpolation points.
 * Declarations are `Ref`s: a literal geometric value (`{ value: 0 }`) or a token-path reference
 * (`{ ref: "colors.surface" }`) resolved late by the adapter, so a keyframe can animate a themed value.
 */
export type KeyframeStep = {
  stop: string;
  declarations: Record<string, Ref>;
};

/**
 * A named keyframe definition — an **ordered** list of steps (authoring order preserved). The first
 * Model member that is neither a token ({@link PropertyModel}) nor a class/selector rule-set
 * ({@link RuleSet}): an `@keyframes`-shaped at-rule with nested step selectors. Adapters realize it
 * (CSS: an `@keyframes name { … }` at-rule).
 */
export type Keyframe = {
  steps: KeyframeStep[];
};

// ---------------------------------------------------------------------------
// Theme model
// ---------------------------------------------------------------------------

/** One subsystem's slice of the Model: its tokens, its rule-set groups, and its keyframes. */
export type SubsystemModel = {
  properties?: Record<string, PropertyModel>;
  ruleSets?: Record<string, RuleSetGroup>;
  /** Named keyframe definitions (§10.2) — `name → {@link Keyframe}`. Present only for the animation subsystem. */
  keyframes?: Record<string, Keyframe>;
};

/** One named query container (§10.5) — its `container-type` + `sizeName → px` threshold scale. */
export type ContainerModel = {
  type: "inline-size" | "size";
  sizes: Record<string, number>;
};

/** The whole theme as format-neutral data — serializable as-is (build-time emit). */
export type ThemeModel = {
  breakpoints: Record<string, number>;
  /** Named query containers (§10.5) — present only when the theme authors `containers`. Additive. */
  containers?: Record<string, ContainerModel>;
  subsystems: Record<string, SubsystemModel>;
};
