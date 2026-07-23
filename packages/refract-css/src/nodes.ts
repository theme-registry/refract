/**
 * The CSS adapter's internal IR — `CssNode[]`.
 *
 * A CSS-specific lowering artifact, derived **inside** the adapter from the format-neutral
 * {@link ThemeModel}. Core never speaks this shape. Ported verbatim from the proven
 * `core/common/cssNodes.ts`.
 */

export type CssDeclaration = {
  property: string;
  value: string | number;
  /** CSS variable name this value references (e.g. "--dt-colors-primary"). */
  ref?: string;
  /** Resolved raw value (e.g. "#4dabf7"). Available when the declaration references a variable. */
  resolved?: string | number;
};

export type CssVariablesNode = {
  kind: "variables";
  selector: string;
  media?: string;
  variables: Record<string, string>;
};

export type CssRuleNode = {
  kind: "rule";
  selector: string;
  media?: string;
  declarations: CssDeclaration[];
};

/** One step of a rendered keyframe — its verbatim stop + the resolved declarations at that stop. */
export type CssKeyframesStep = {
  stop: string;
  declarations: CssDeclaration[];
};

/**
 * A keyframes at-rule (§10.2) — the CSS lowering of a Model {@link Keyframe}. Renders to
 * `@keyframes <name> { <stop> { … } … }`. Neither a variables block nor a class rule, so it is a
 * distinct node kind; it rides the rules stream (never the variables file).
 */
export type CssKeyframesNode = {
  kind: "keyframes";
  name: string;
  steps: CssKeyframesStep[];
};

export type CssNode = CssVariablesNode | CssRuleNode | CssKeyframesNode;
