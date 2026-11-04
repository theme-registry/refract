/**
 * Recipe state vocabulary for the CSS-family adapters (CSS, SCSS, styled-components).
 *
 * A state name is one of two forms, and nothing else (an unknown name fails the build, so a typo
 * never becomes a silent selector):
 *  - a CSS state from this list → its pseudo-class (`hover` → `:hover`; `disabled` → `[disabled]`);
 *  - `aria-<name>` from {@link ARIA_STATES} → `[aria-<name>="true"]`.
 * `pressed` (0.1.x) is an alias of `aria-pressed`.
 *
 * A recipe state entry can also carry `has: "<state>"` — a condition on what the element CONTAINS,
 * not a state of its own: `:has(<that state's selector>)`. {@link conditionSuffix} composes both.
 *
 * Key order is the canonical cascade order (later wins by source order): link → visited → hover →
 * focus … → disabled. Adapters sort overrides with {@link orderStateOverrides}.
 */

/** The WAI-ARIA states (plus the boolean `aria-readonly` / `aria-required`) usable as a recipe state. */
export const ARIA_STATES = [
  "aria-selected",
  "aria-expanded",
  "aria-invalid",
  "aria-checked",
  "aria-current",
  "aria-busy",
  "aria-hidden",
  "aria-readonly",
  "aria-required",
  "aria-disabled",
  "aria-pressed",
] as const;

const aria = (name: string): string => `[${name}="true"]`;

/** State name → selector suffix, in canonical order. */
export const STATE_SELECTORS: Readonly<Record<string, string>> = {
  link: ":link",
  visited: ":visited",
  hover: ":hover",
  focus: ":focus",
  "focus-visible": ":focus-visible",
  "focus-within": ":focus-within",
  active: ":active",
  checked: ":checked",
  indeterminate: ":indeterminate",
  "aria-selected": aria("aria-selected"),
  "aria-expanded": aria("aria-expanded"),
  "placeholder-shown": ":placeholder-shown",
  "aria-invalid": aria("aria-invalid"),
  "aria-checked": aria("aria-checked"),
  "aria-current": aria("aria-current"),
  "aria-busy": aria("aria-busy"),
  "aria-hidden": aria("aria-hidden"),
  "aria-readonly": aria("aria-readonly"),
  "aria-required": aria("aria-required"),
  "aria-disabled": aria("aria-disabled"),
  disabled: "[disabled]",
  pressed: aria("aria-pressed"),
  "aria-pressed": aria("aria-pressed"),
};

/** Every valid state name — the adapters' `allowedStates`, which core validates `state` / `has` against. */
export const KNOWN_STATES: ReadonlyArray<string> = Object.keys(STATE_SELECTORS);

const ORDER: Record<string, number> = Object.fromEntries(KNOWN_STATES.map((name, i) => [name, i]));
const LAST = Number.MAX_SAFE_INTEGER;

/** The condition part of a state override — what {@link conditionSuffix} reads. */
export type StateCondition = { state?: string; has?: string };

/**
 * The selector suffix for a state override: its own state, then its `has` condition.
 * `{ state: "hover" }` → `:hover`; `{ has: "checked" }` → `:has(:checked)`;
 * `{ state: "hover", has: "aria-invalid" }` → `:hover:has([aria-invalid="true"])`.
 * `undefined` when a name is unknown (core has already rejected it for the CSS-family adapters).
 */
export const conditionSuffix = (condition: StateCondition): string | undefined => {
  let suffix = "";
  if (condition.state !== undefined) {
    const own = STATE_SELECTORS[condition.state];
    if (!own) return undefined;
    suffix += own;
  }
  if (condition.has !== undefined) {
    const inner = STATE_SELECTORS[condition.has];
    if (!inner) return undefined;
    suffix += `:has(${inner})`;
  }
  return suffix || undefined;
};

/** True for an override conditioned on a state or a `has` (the state rules, not base / responsive). */
export const isStateCondition = (condition: StateCondition): boolean =>
  condition.state !== undefined || condition.has !== undefined;

/**
 * Sort state overrides into canonical cascade order. A `has` entry sorts right after its state's own
 * entry (`checked`, then `has: "checked"`), and a `state` + `has` entry right after that state; at
 * equal condition, breakpoint-less before breakpointed, then authored order.
 */
export const orderStateOverrides = <T extends StateCondition & { breakpoint?: unknown }>(overrides: T[]): T[] =>
  overrides
    .map((override, index) => ({ override, index }))
    .sort((a, b) => {
      const ka = sortKey(a.override);
      const kb = sortKey(b.override);
      for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
      const bpA = a.override.breakpoint ? 1 : 0;
      const bpB = b.override.breakpoint ? 1 : 0;
      if (bpA !== bpB) return bpA - bpB;
      return a.index - b.index;
    })
    .map(({ override }) => override);

const sortKey = (o: StateCondition): number[] => [
  ORDER[(o.state ?? o.has) as string] ?? LAST,
  o.state === undefined ? 1 : 0,
  o.has === undefined ? -1 : (ORDER[o.has] ?? LAST),
];
