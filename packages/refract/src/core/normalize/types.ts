/**
 * The normalize-layer vocabulary — the authored-input and normalized-output
 * shapes the normalizer speaks. Distinct from the Model types (`../model`): these
 * describe raw theme config and its normalized form; the Model is the downstream
 * format-neutral representation built from them (Step 0c).
 *
 * Ported verbatim from the proven `core/common/types.ts` (self-contained, no imports).
 */

export type PrimitiveValue = string | number;

export type Breakpoints<TKey extends string = string> = Record<TKey, number>;

export type NormalizedBreakpoints<TKey extends string = string> = Record<TKey, { base: number }>;

// --- Container queries (§10.5) ---

/** `container-type` on a named query container. `inline-size` (default) contains the inline axis only. */
export type ContainerType = "inline-size" | "size";

/**
 * One named container (§10.5) — its `container-type` + its threshold scale (`sizeName → px`). The
 * config key is the CSS `container-name`. Parallel to a breakpoint scale, but a *component-slot*
 * scale, not a device scale. A recipe override references it as `{ container: <name>, size: <sizeName> }`.
 */
export type ContainerDefinition = {
  type?: ContainerType;
  sizes: Record<string, number>;
};

/** The authored `rawTheme.containers` map — `containerName → {@link ContainerDefinition}`. */
export type Containers = Record<string, ContainerDefinition>;

export type ResponsiveQuery = "min" | "max" | "exact";

export type ResponsiveOrientation = "landscape" | "portrait";

export type ResponsiveOverride<
  TValue,
  TExtra extends Record<string, unknown> = {},
  TBreakpoint extends string = string,
> = {
  breakpoint: TBreakpoint;
  query?: ResponsiveQuery;
  /** dec.5 — READ source: at this breakpoint the destination var swaps to this variant's var
   *  (`var(--<prop>-<ref>)`). Replaces the old swap-only `variant`. Composes with `target` (write). */
  ref?: string;
  /** dec.9 — appearance-mode CONDITION: the override applies only in this mode (mirror of a recipe
   *  responsive's `state`). A property-side axis; validated against the `modes` registry (dec.1). */
  mode?: string;
  target?: string;
  orientation?: ResponsiveOrientation;
} & Partial<{ base: TValue } & TExtra>;

export type NormalizedResponsiveOverride<
  TValue,
  TExtra extends Record<string, unknown> = {},
  TBreakpoint extends string = string,
> = Omit<ResponsiveOverride<TValue, TExtra, TBreakpoint>, "query"> & {
  query: ResponsiveQuery;
};

export type VariantValue<
  TValue,
  TExtra extends Record<string, unknown> = {},
  TBreakpoint extends string = string,
> = TValue | ({ base: TValue } & TExtra);

/** dec.2 — one modifier dial in a derivation chain: a single-key object `{ [fn]: args }`
 *  (`{ darken: 10 }`, `{ alpha: 40 }`, `{ adjust: { l, c, h } }`). */
export type DerivationModifier = Record<string, unknown>;

/**
 * A derivation (§10.3, dec.2) — read `ref` (defaults to the property's OWN base), then fold the
 * ordered `modifiers` chain of `{ [fn]: args }` dials over it: `value = modifiers.reduce((v, {fn,arg})
 * => fn(v, arg), resolve(ref))`. The owning subsystem hook (colors) bakes it (mirror of tonal steps).
 * Replaces the old single `{ fn, arg }` shorthand.
 */
export type ModeDerivation = { ref?: string; modifiers: DerivationModifier[] };

/**
 * One authored appearance-mode override (§10.3) — the value payload of a {@link ModeOverride}. A
 * `{ ref?, modifiers }` derivation derives the base; a `{ base?, …extra }` object overrides the base
 * (literal) and/or sibling extras (literal only in v1). Parallel to {@link VariantValue}. (The bare
 * `TValue` shorthand is gone — modes are an array of `{ mode, … }` entries, so the value is spelled
 * with an explicit `base:`.)
 */
export type ModeValue<
  TValue,
  TExtra extends Record<string, unknown> = {},
> =
  | (ModeDerivation & Partial<TExtra>)
  | ({ base?: TValue } & Partial<TExtra>);

/**
 * One entry in a property's `modes` **array** — its `mode` name (the WHEN, validated against the
 * `modes` registry, dec.1), an optional `target` (the WHERE — scope the override into a variant's
 * var), plus the {@link ModeValue} payload (the WHAT). Mirrors a {@link ResponsiveOverride} entry;
 * shares the WHEN/WHERE/WHAT spine with recipe states.
 */
export type ModeOverride<
  TValue,
  TExtra extends Record<string, unknown> = {},
> = { mode: string; target?: string } & ModeValue<TValue, TExtra>;

export type ExtendedProperty<
  TValue,
  TExtra extends Record<string, unknown> = {},
  TBreakpoint extends string = string,
> = {
  base: TValue;
  responsive?: ResponsiveOverride<TValue, TExtra, TBreakpoint>[];
  variants?: Record<string, VariantValue<TValue, TExtra, TBreakpoint>>;
  modes?: ModeOverride<TValue, TExtra>[];
} & TExtra;

/**
 * §W6b — an **external-token** property: a passthrough to a CSS variable a *parent* theme owns.
 * `external` is a refract token path (`"colors.brand"` → `var(--<extends.prefix>-colors-brand)`) or a
 * literal CSS variable (`"--mat-sys-bg"`, leading `--`). The rest of the theme references it like any
 * token, but it is never defined locally and is not tonally derivable.
 */
export type ExternalProperty = { external: string };

export type PropertyValue<
  TValue,
  TExtra extends Record<string, unknown> = {},
  TBreakpoint extends string = string,
> = TValue | ExtendedProperty<TValue, TExtra, TBreakpoint> | ExternalProperty;

export type NormalizedVariantValue<
  TValue,
  TExtra extends Record<string, unknown> = {},
  TBreakpoint extends string = string,
> = {
  /**
   * The variant's primary value. Normally present (a literal, or the cached resolution of a
   * `derive`). **Absent** only for a dec.4 **cross-property** derivation, whose source lives in
   * another property and so cannot be baked during this property's single normalize pass — the
   * post-build `bakeCrossPropertyDerivations` pass fills it (via `derive.ref` + `derive.modifiers`).
   */
  base?: TValue;
  /**
   * Synthesized variants (e.g. colors' `light`/`dark` steps) carry a fully-qualified derivation
   * so the Model can store them as a derived `Ref` (`{ ref, fn, arg }`) instead of an opaque baked
   * value — enabling free override propagation. Set by a subsystem's `normalizeProperty`; the
   * `base` value is retained (it's the cached resolution the CSS lowering still reads) — except for
   * a cross-property `derive`, where `base` is filled post-build (see above).
   */
  derive?: { ref: string; fn?: string; arg?: unknown; modifiers?: Array<{ fn: string; arg?: unknown }> };
} & TExtra;

/**
 * One appearance mode after normalization (§10.3). `base` is the baked literal (core fills it
 * for a literal mode; the colors hook fills it for a derived one) — absent when the mode overrides
 * only extras. `derive` carries a base derivation the colors hook resolves/bakes (`ref` filled by
 * the subsystem that owns the fn). Extra fields are literal siblings (e.g. colors' `text`).
 */
export type NormalizedModeValue<
  TValue,
  TExtra extends Record<string, unknown> = {},
> = {
  base?: TValue;
  derive?: { ref?: string; fn?: string; arg?: unknown; modifiers?: Array<{ fn: string; arg?: unknown }> };
} & Partial<TExtra>;

/** One entry in the normalized `modes` **array** — the mode name + optional target + the normalized
 *  value payload. Mirrors {@link NormalizedResponsiveOverride}. */
export type NormalizedModeOverride<
  TValue,
  TExtra extends Record<string, unknown> = {},
> = { mode: string; target?: string } & NormalizedModeValue<TValue, TExtra>;

export type NormalizedPropertyValue<
  TValue,
  TExtra extends Record<string, unknown> = {},
  TBreakpoint extends string = string,
> = {
  base: TValue;
  responsive: NormalizedResponsiveOverride<TValue, TExtra, TBreakpoint>[];
  variants?: Record<string, NormalizedVariantValue<TValue, TExtra, TBreakpoint>>;
  modes?: NormalizedModeOverride<TValue, TExtra>[];
  /** §W6b — set (to the literal parent var name) when this property is an external-token passthrough. */
  external?: string;
} & TExtra;

export type PropertyNormalizationOptions<
  TValue,
  TBreakpoint extends string = string,
> = {
  propertyPath?: string;
  coerceValue?: (value: TValue) => TValue;
  fallbackBase?: TValue;
  allowedBreakpoints?: ReadonlyArray<TBreakpoint> | ReadonlySet<TBreakpoint>;
  /**
   * §15 object-leaf subsystems (effects shadow / transitions): the set of value-field names that,
   * when present at a property/variant top level WITHOUT an explicit `base` key, are assembled into
   * the base value object. Keys not in this set (and not the structural `variants`/`responsive`/
   * `modes`) are treated as `TExtra` siblings. An explicit `base` key is the escape hatch — it is
   * the base of any shape (object/array/string), bypassing assembly. Absent for scalar subsystems.
   */
  leafFields?: readonly string[];
};

export type RecipeResponsiveOverride<
  TProps extends Record<string, unknown>,
  TBreakpoint extends string = string,
> = {
  /** Present for breakpoint-conditioned overrides; absent for pure-state / container overrides. */
  breakpoint?: TBreakpoint;
  query?: ResponsiveQuery;
  /** Recipe-only condition axis; validated against the adapter's known-state set in normalize. */
  state?: string;
  variant?: string;
  target?: string;
  orientation?: ResponsiveOrientation;
  /** Container-query axis (§10.5): the named container this override responds to (replaces `breakpoint`). */
  container?: string;
  /** The size-name in that container's threshold scale (used with `container`, like `breakpoint`). */
  size?: string;
} & Partial<TProps>;

/**
 * One entry in a recipe / globals-element `states` **array** — its `state` name (WHEN, validated
 * against the adapter's known-state set), an optional `target` (WHERE — scope the override onto the
 * `<item>-<target>` sibling selector, dec.8), plus the flat recipe-prop deltas (WHAT). Mirrors a
 * {@link RecipeResponsiveOverride} entry with no breakpoint; shares the WHEN/WHERE/WHAT spine with a
 * property {@link ModeOverride}. A list (not a `state → delta` map) so two same-state entries can
 * target different siblings.
 */
export type RecipeStateOverride<
  TProps extends Record<string, unknown>,
> = { state: string; target?: string } & Partial<TProps>;

/**
 * The authored `states` value — the canonical **array** of {@link RecipeStateOverride}s (dec.8), or a
 * legacy `{ state: {…delta} }` **map** (no `target`, one entry per state) still accepted for authoring
 * convenience. Both normalize to the same flattened override list; docs teach the array form.
 */
export type RecipeStates<
  TProps extends Record<string, unknown>,
> = RecipeStateOverride<TProps>[] | Record<string, Partial<TProps>>;

/**
 * Strip a string/number index signature from `T`, keeping only its explicitly
 * declared keys. Needed so the reserved `responsive` / `states` keys below aren't
 * clobbered by a recipe-prop index signature like `[property: string]: string`
 * (which would otherwise force them to be `undefined` and reject authoring).
 */
type RemoveIndexSignature<T> = {
  [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K];
};

/**
 * dec.7 — one modifier delta inside a **recipe's** `variants` map (§7A). Layered onto the recipe's
 * own props by `mergeRecipe` to desugar into a flat sibling `<recipe>-<variant>` recipe. **FLAT**: a
 * prop delta (delta wins) or `null` to drop an inherited ref. A variant's conditional behaviour lives
 * in the ITEM's `states`/`responsive` — NOT nested here (no nested `states`/`responsive`/`variants`).
 * (A property variant is a token value → flat; a recipe variant is a sibling recipe → still authored
 * flat here, its states come from the item. Globals is the exception, see {@link GlobalsElementVariantModifier}.)
 */
export type RecipeVariantModifier<
  TProps extends Record<string, unknown>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  TBreakpoint extends string = string,
> = Partial<TProps> & {
  /** A prop delta (delta wins) or `null` to drop an inherited ref. */
  [property: string]: unknown;
};

/**
 * §9 — one modifier delta inside a **globals element's** `variants` map. Unlike a recipe variant
 * (dec.7, flat), a globals element variant KEEPS the conditional axes (`states`/`responsive`) — each
 * desugars into a higher-specificity element variant (`a.subtle`) that can carry its own hover, etc.
 * Globals is the non-generic exception to the flat recipe-variant rule.
 */
export type GlobalsElementVariantModifier<
  TProps extends Record<string, unknown>,
  TBreakpoint extends string = string,
> = {
  responsive?: RecipeResponsiveOverride<TProps, TBreakpoint>[];
  states?: RecipeStates<TProps>;
  /** A prop delta (delta wins) or `null` to drop an inherited ref. */
  [property: string]: unknown;
};

export type RecipeVariantDefinition<
  TProps extends Record<string, unknown>,
  TBreakpoint extends string = string,
  /** dec.7 — the variant-modifier shape. Recipes default to the FLAT modifier; globals pass the rich one. */
  TVariantMod = RecipeVariantModifier<TProps, TBreakpoint>,
> = RemoveIndexSignature<TProps> & {
  responsive?: RecipeResponsiveOverride<TProps, TBreakpoint>[];
  /** Grouped state condition map — `{ hover: {…decls}, disabled: {…decls} }`; flattened into overrides. */
  states?: RecipeStates<TProps>;
  /**
   * §7A — modifier deltas layered on this recipe/element. A pre-pass in `normalizeRecipeGroup` expands
   * each into a flat sibling named `<recipe>-<variant>` (via `mergeRecipe`), then the ordinary
   * normalization runs unchanged. Reserved, like `states` / `responsive`.
   */
  variants?: Record<string, TVariantMod>;
  /** Additional style declarations beyond the named recipe props. */
  [property: string]: unknown;
};

export type RecipeGroupDefinition<
  TProps extends Record<string, unknown>,
  TBreakpoint extends string = string,
> = Record<string, RecipeVariantDefinition<TProps, TBreakpoint>>;

/**
 * The authored `recipes:` block — a map of group name → {@link RecipeGroupDefinition}
 * (`{ solid: { primary: {…}, danger: {…} }, outline: {…} }`). The per-subsystem
 * authoring-input types (`ColorsRaw`/… ) key their `recipes?` on this.
 */
export type RecipeBlock<
  TProps extends Record<string, unknown>,
  TBreakpoint extends string = string,
> = Record<string, RecipeGroupDefinition<TProps, TBreakpoint>>;

export type NormalizedRecipeVariant<
  TProps extends Record<string, unknown>,
  TBreakpoint extends string = string,
> = {
  base: TProps;
  responsive: RecipeResponsiveOverride<TProps, TBreakpoint>[];
};

export type NormalizedRecipeGroup<
  TProps extends Record<string, unknown>,
  TBreakpoint extends string = string,
> = Record<string, NormalizedRecipeVariant<TProps, TBreakpoint>>;
