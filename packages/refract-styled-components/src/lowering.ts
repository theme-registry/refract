/**
 * Shared lowering helpers for the styled-components adapter — the format-neutral bits the recipe IR
 * builder ({@link ../recipe}) and both sinks (emit-source / runtime-live) lean on: the state-selector
 * table the adapter owns, canonical LVHA state ordering, and breakpoint → concrete `@media` string
 * resolution. It imports **only** core (Model + media types), so the adapter stays liftable to its own
 * package (Step 11).
 *
 * The SC target emits TS/JS modules (a literal theme object + `css` recipes), not a stylesheet, so
 * there is no CSS-variable / class-name lowering here — recipe values read straight from the theme
 * (`${({ theme }) => theme.…}`) and the theme object *is* the indirection.
 */
import type { MediaDescriptor, MediaVariant } from "@theme-registry/refract";
import type { Orientation, RuleSetOverride } from "@theme-registry/refract";

// ---------------------------------------------------------------------------
// State selector table (adapter-owned)
// ---------------------------------------------------------------------------

export const SC_STATE_SELECTORS: Record<string, string> = {
  link: ":link",
  visited: ":visited",
  hover: ":hover",
  focus: ":focus",
  active: ":active",
  disabled: "[disabled]",
  pressed: "[aria-pressed]",
};

/** The states the SC adapter can render (the validation set core threads into normalization). */
export const SC_KNOWN_STATES: ReadonlyArray<string> = Object.keys(SC_STATE_SELECTORS);

const STATE_ORDER: Record<string, number> = SC_KNOWN_STATES.reduce<Record<string, number>>(
  (acc, name, index) => {
    acc[name] = index;
    return acc;
  },
  {},
);

/** Order state overrides in canonical LVHA order (breakpoint-scoped ones after the base state). */
export const orderStateOverrides = (overrides: RuleSetOverride[]): RuleSetOverride[] =>
  overrides
    .map((override, index) => ({ override, index }))
    .sort((a, b) => {
      const oa = STATE_ORDER[a.override.state as string] ?? Number.MAX_SAFE_INTEGER;
      const ob = STATE_ORDER[b.override.state as string] ?? Number.MAX_SAFE_INTEGER;
      if (oa !== ob) return oa - ob;
      const bpa = a.override.breakpoint ? 1 : 0;
      const bpb = b.override.breakpoint ? 1 : 0;
      if (bpa !== bpb) return bpa - bpb;
      return a.index - b.index;
    })
    .map(({ override }) => override);

// ---------------------------------------------------------------------------
// Breakpoint → concrete @media query resolution
// ---------------------------------------------------------------------------

export const DEFAULT_MEDIA_QUERY: MediaVariant = "exact";

/** Resolve a breakpoint + query kind (+ orientation) to its concrete `@media (...)` string. */
export const resolveMediaQuery = <TBreakpoint extends string>(
  media: MediaDescriptor<TBreakpoint>,
  breakpoint: TBreakpoint,
  query: MediaVariant,
  orientation?: Orientation,
): string => {
  if (!orientation) return media[breakpoint]?.[query] ?? "";
  const opts = { orientation };
  if (query === "min") return media.min(breakpoint, opts);
  if (query === "max") return media.max(breakpoint, opts);
  return media.exact(breakpoint, opts);
};
