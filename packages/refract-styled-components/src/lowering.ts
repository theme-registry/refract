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
import { KNOWN_STATES, STATE_SELECTORS, orderStateOverrides as orderShared } from "@theme-registry/refract/adapter-kit";
import type { Orientation, RuleSetOverride } from "@theme-registry/refract";

// ---------------------------------------------------------------------------
// State selector table (adapter-owned)
// ---------------------------------------------------------------------------

/** State name → selector suffix (canonical order) — the shared CSS-family table in `adapter-kit`. */
export const SC_STATE_SELECTORS: Readonly<Record<string, string>> = STATE_SELECTORS;

/** The states the SC adapter can render (the validation set core threads into normalization). */
export const SC_KNOWN_STATES: ReadonlyArray<string> = KNOWN_STATES;

/** Order state overrides in canonical order (breakpoint-scoped ones after the base state). */
export const orderStateOverrides = (overrides: RuleSetOverride[]): RuleSetOverride[] => orderShared(overrides);

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
