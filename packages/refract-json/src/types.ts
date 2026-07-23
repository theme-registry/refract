/**
 * The JSON adapter's output IR — a format-neutral **document fragment**.
 *
 * A JSON-specific lowering artifact, derived inside the adapter from the format-neutral
 * {@link ThemeModel}. Where the CSS adapter's `TUnit` is `string`, the JSON adapter's is
 * this {@link JsonDoc} object; `join` shallow-merges fragments per bucket (the buckets are
 * flat, full-address-keyed maps, so keys never collide across fragments).
 *
 * The doc mirrors the Model's two kinds of thing plus its config: **tokens** (property
 * leaves), **ruleSets** (recipes / layout presets / composition / reset), **keyframes**,
 * and the theme-global `breakpoints` / `containers`. Each leaf is the JSON mirror of the
 * Model's `Ref` — carrying the token `ref` path AND the resolved `value` (the parts a
 * tokens-only DTCG export cannot represent: recipes, states, responsive rule overrides,
 * and composition-by-reference all survive as data here).
 */

import type { Literal, Orientation, ResponsiveQueryKind, StructuredValue } from "@theme-registry/refract";

/**
 * A rendered leaf — the JSON mirror of the Model's `Ref`.
 *
 * - `value` — the resolved literal (present in `both` / `value` ref modes; and in `path`
 *   mode only for a pure literal that has no `ref`).
 * - `ref`   — the token path this leaf references (`"colors.primary.dark"`), or — on a
 *   derived token leaf — its derivation source. Present in `both` / `path` modes.
 * - `fn` / `arg` — the derivation carried on a derived token (`darken(colors.primary, 20)`).
 * - `wrap`  — an adapter output-wrap hint (e.g. `blur`) kept as data.
 * - `struct`— a structured compound value (§15) for shadow / transition tokens — an array of
 *   layers/parts kept as data; each layer's `color` is a `colors.*` token-path ref (the RN/JSON
 *   consumer resolves it). Present whenever the Model `Ref` carries structure, in any ref mode.
 */
export type JsonLeaf = {
  ref?: string;
  fn?: string;
  arg?: unknown;
  wrap?: string;
  value?: Literal;
  struct?: StructuredValue;
  /** §W6b — set (to the parent var name) when this token is an external passthrough; `value` is the `var(…)`. */
  external?: string;
};

/** One conditioned override on a rule-set — the Model's condition axes + its declarations. */
export type JsonOverride = {
  state?: string;
  breakpoint?: string;
  query?: ResponsiveQueryKind;
  orientation?: Orientation;
  container?: string;
  size?: string;
  variant?: string;
  target?: string;
  declarations: Record<string, JsonLeaf>;
};

/** One globals element variant (§9) as data — a delta-only modifier's declarations + overrides. */
export type JsonGlobalsVariant = {
  declarations: Record<string, JsonLeaf>;
  overrides: JsonOverride[];
};

/**
 * A rule-set as data — recipes / layout presets / composition (`references`) / globals
 * (`selector` + `kind:"reset"` preset layer or `kind:"globals"` themed element with `variants`).
 */
export type JsonRuleSet = {
  kind?: "recipe" | "utility" | "reset" | "globals";
  selector?: string;
  references?: string[];
  declarations: Record<string, JsonLeaf>;
  overrides: JsonOverride[];
  /** `kind:"globals"` only (§9): named delta-only element variants, kept as data. */
  variants?: Record<string, JsonGlobalsVariant>;
};

/** One keyframe step — its verbatim stop + the declarations at that stop. */
export type JsonKeyframeStep = { stop: string; declarations: Record<string, JsonLeaf> };

/** A named keyframe definition — an ordered list of steps. */
export type JsonKeyframe = { steps: JsonKeyframeStep[] };

/** One named query container (§10.5) as data. */
export type JsonContainer = { type: "inline-size" | "size"; sizes: Record<string, number> };

/**
 * The JSON adapter's output unit — a document fragment. Every bucket is a flat map keyed by
 * a full Model address (`"colors.primary.dark"`, `"colors.solid.primary"`), so `join` is a
 * shallow per-bucket merge. A whole theme is one {@link JsonDoc} with every bucket populated.
 */
export type JsonDoc = {
  breakpoints?: Record<string, number>;
  containers?: Record<string, JsonContainer>;
  tokens?: Record<string, JsonLeaf>;
  ruleSets?: Record<string, JsonRuleSet>;
  keyframes?: Record<string, JsonKeyframe>;
};

/**
 * How a leaf renders its reference:
 * - `both`  — `ref` (+ `fn`/`arg`/`wrap`) AND the resolved `value` (default; strongest proof + most useful).
 * - `path`  — the `ref` only (a literal with no ref still emits its `value`).
 * - `value` — the resolved `value` only (DTCG-like literals, but with recipes/states/composition).
 */
export type RefsMode = "both" | "path" | "value";

/** Per-adapter knobs. JSON keys are Model addresses, so there are no CSS-style prefix options. */
export type JsonAdapterOptions = {
  /** How referenced leaves render (default `both`). */
  refs?: RefsMode;
  /** Pretty-print indent (spaces) for emitted files. Default `2`; `0` = minified. */
  indent?: number;
};
