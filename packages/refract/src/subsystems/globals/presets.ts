/**
 * The globals preset library (§9, formerly §10.1 reset) — the single, format-neutral source for the
 * static normalization rule-sets and the default `h1`–`h6` → type-scale map.
 *
 * These produce Model {@link RuleSet}s (declarations are `{ value }` literals for the static
 * layer, `{ ref }` token paths for the default heading map), so every web adapter shares one
 * source (à la `color-math`) and lowers them itself. No CSS strings here — the adapter wraps
 * each `selector` in `:where(…)` (specificity-0) and orders reset ahead of recipes.
 *
 * Layers:
 *  - **static** — literal-declaration rule-sets that strip UA opinions (box model, margins,
 *    heading sizing, list markers, form typography, media block/max-width, anchor colour).
 *  - **default headings** — themed rule-sets binding `h1`–`h6` to typography's ratio-generated
 *    `fontSize` scale variants (`typography.fontSize.4xl` …). Opportunistic: the adapter drops a
 *    heading whose scale step wasn't generated (a theme with a ratio-less `fontSize`).
 */

import { RefractError } from "../../core/errors";
import type { Ref, RuleSet, RuleSetGroup } from "../../core/model";
import type { GlobalsPreset } from "./types";

const literal = (value: string | number): Ref => ({ value });
const tokenRef = (path: string): Ref => ({ ref: path });

/** A preset rule-set: an explicit raw `selector` + literal/ref declarations, no overrides. Stays
 *  `kind:"reset"` — the normalization layer renders at specificity-0 `:where(sel)`, unlike the themed
 *  `kind:"globals"` element rules. */
const resetRuleSet = (selector: string, declarations: Record<string, Ref>): RuleSet => ({
  kind: "reset",
  selector,
  declarations,
  overrides: [],
});

/** Build a `RuleSetGroup` (variant key → rule-set) from an ordered `[key, selector, decls]` list. */
const staticGroup = (
  entries: ReadonlyArray<readonly [string, string, Record<string, string | number>]>,
): RuleSetGroup => {
  const group: RuleSetGroup = {};
  for (const [key, selector, decls] of entries) {
    const declarations: Record<string, Ref> = {};
    for (const [property, value] of Object.entries(decls)) declarations[property] = literal(value);
    group[key] = resetRuleSet(selector, declarations);
  }
  return group;
};

// ---------------------------------------------------------------------------
// Static layers (literal declarations, kebab-case CSS keys)
// ---------------------------------------------------------------------------

/** Preflight — opinionated, token-first: strip UA styling so the design tokens are the sole source. */
const PREFLIGHT_STATIC: ReadonlyArray<readonly [string, string, Record<string, string | number>]> = [
  ["box", "*,::before,::after", { "box-sizing": "border-box", "border-width": "0", "border-style": "solid" }],
  ["body", "body", { margin: "0", "line-height": "inherit" }],
  ["headings", "h1,h2,h3,h4,h5,h6", { "font-size": "inherit", "font-weight": "inherit", margin: "0" }],
  ["blocks", "p,figure,blockquote,dl,dd", { margin: "0" }],
  ["lists", "ul,ol", { "list-style": "none", margin: "0", padding: "0" }],
  ["media", "img,picture,video,canvas,svg", { display: "block", "max-width": "100%" }],
  ["forms", "button,input,select,textarea", { font: "inherit", color: "inherit" }],
  ["anchors", "a", { color: "inherit", "text-decoration": "inherit" }],
];

/** Normalize — light: fix cross-browser bugs, preserve UA defaults (no margin zeroing / heading strip). */
const NORMALIZE_STATIC: ReadonlyArray<readonly [string, string, Record<string, string | number>]> = [
  ["box", "*,::before,::after", { "box-sizing": "border-box" }],
  ["body", "body", { margin: "0" }],
  ["media", "img,picture,video,canvas,svg", { "max-width": "100%" }],
];

/** Reset — aggressive classic reset: zero the box on everything, unstyle headings and lists. */
const RESET_STATIC: ReadonlyArray<readonly [string, string, Record<string, string | number>]> = [
  ["box", "*,::before,::after", { "box-sizing": "border-box" }],
  ["all", "*", { margin: "0", padding: "0", border: "0", font: "inherit", "vertical-align": "baseline" }],
  ["headings", "h1,h2,h3,h4,h5,h6", { "font-size": "inherit", "font-weight": "inherit" }],
  ["lists", "ul,ol", { "list-style": "none" }],
  ["media", "img,picture,video,canvas,svg", { display: "block", "max-width": "100%" }],
];

// ---------------------------------------------------------------------------
// Default themed heading map (h1–h6 → typography's ratio-generated scale variants)
// ---------------------------------------------------------------------------

/** `h<n>` → the `fontSize` scale variant it binds to (largest heading = top of the scale). */
const DEFAULT_HEADINGS: ReadonlyArray<readonly [string, string]> = [
  ["h1", "4xl"],
  ["h2", "3xl"],
  ["h3", "2xl"],
  ["h4", "xl"],
  ["h5", "lg"],
  ["h6", "md"],
];

/** The default `h1`–`h6` themed group — each binds `font-size` to `typography.fontSize.<step>`. */
export const buildDefaultHeadingGroup = (): RuleSetGroup => {
  const group: RuleSetGroup = {};
  for (const [tag, step] of DEFAULT_HEADINGS) {
    group[tag] = resetRuleSet(tag, { "font-size": tokenRef(`typography.fontSize.${step}`) });
  }
  return group;
};

// ---------------------------------------------------------------------------
// Preset resolution
// ---------------------------------------------------------------------------

type PresetConfig = {
  static: ReadonlyArray<readonly [string, string, Record<string, string | number>]>;
  /** Whether the preset also emits the default `h1`–`h6` themed map. */
  headings: boolean;
};

const PRESETS: Record<Exclude<GlobalsPreset, false>, PresetConfig> = {
  preflight: { static: PREFLIGHT_STATIC, headings: true },
  normalize: { static: NORMALIZE_STATIC, headings: false },
  reset: { static: RESET_STATIC, headings: true },
};

/** The recommended default preset (what `refract init` scaffolds). */
export const DEFAULT_GLOBALS_PRESET: Exclude<GlobalsPreset, false> = "preflight";

/** The known preset names — for validation / error messages. */
export const GLOBALS_PRESET_NAMES = Object.keys(PRESETS) as ReadonlyArray<Exclude<GlobalsPreset, false>>;

/**
 * Expand a preset name into its `{ static, defaults? }` rule-set groups. `false` yields no groups
 * (elements-only). An unknown name throws (typo detection). The default heading group is included
 * only when the preset opts into it (`preflight` / `reset`, not `normalize`).
 */
export const expandPreset = (preset: GlobalsPreset): { static?: RuleSetGroup; defaults?: RuleSetGroup } => {
  if (preset === false) return {};
  const config = PRESETS[preset];
  if (!config) {
    throw new RefractError(
      "REFRACT_E_PRESET",
      `globals: unknown preset "${preset}" — expected one of ${GLOBALS_PRESET_NAMES.join(", ")} or false`,
    );
  }
  const groups: { static?: RuleSetGroup; defaults?: RuleSetGroup } = {
    static: staticGroup(config.static),
  };
  if (config.headings) groups.defaults = buildDefaultHeadingGroup();
  return groups;
};
