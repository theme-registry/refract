/**
 * Format-neutral component merge (§9c).
 *
 * `mergeComponentRuleSet` flattens one component variant into a single
 * self-contained rule-set: its referenced recipes' declarations + its own `css`
 * delta, unioned. The result is pure Model data — declarations stay as {@link Ref}s
 * carrying `{ ref, value }` — so an adapter renders it as baked values (inline) or
 * `var(--…)` / `theme.…` (referenced) without any format decision leaking in here.
 *
 * This is the ONLY new machinery the `components` emit mode needs, shared by the CSS
 * and future SC adapters. It is **on-demand** (an adapter calls it in `emit()`), never
 * materialized on `ThemeModel` / the runtime `theme`. It does NOT mutate the authored
 * `RuleSet` / declarations — the merged view is freshly derived (Refs shallow-cloned).
 *
 * Precedence (LOCKED, §9): authored **reference order** first (later refs override
 * earlier per property key), then the component's own declarations **last / highest**
 * (`css` delta wins over subsystem recipes). Same rule per condition bucket.
 */
import type {
  Orientation,
  Ref,
  ResponsiveQueryKind,
  RuleSet,
  RuleSetOverride,
  ThemeModel,
} from "./model";
import { RefractError } from "../errors";

/**
 * One flattened conditioned bucket — a distinct `(breakpoint, query, orientation, state, container, size)`
 * key. A **viewport** entry carries `breakpoint`; a **container** entry (§10.5) carries `container` + `size`
 * (and no `breakpoint`). The adapter emits the former as `@media`, the latter as `@container`.
 */
export type MergedResponsiveEntry = {
  breakpoint?: string;
  query?: ResponsiveQueryKind;
  orientation?: Orientation;
  state?: string;
  container?: string;
  size?: string;
  declarations: Record<string, Ref>;
};

/**
 * A component variant flattened into one self-contained rule-set.
 *
 * - `base`            — merged no-condition declarations.
 * - `states`          — merged declarations keyed by `state` (no breakpoint).
 * - `responsive`      — one entry per distinct `(breakpoint, query, orientation, state)` merge key.
 * - `referencedPaths` — every distinct token path (`Ref.ref`) appearing across all buckets,
 *                        first-appearance order. What non-inline rendering tree-shakes the vars file to.
 */
export type MergedRuleSet = {
  base: Record<string, Ref>;
  states: Record<string, Record<string, Ref>>;
  responsive: MergedResponsiveEntry[];
  referencedPaths: string[];
};

/** The address parts of a component reference (`"colors:solid.primary"`). */
export type RuleSetReference = { subsystem: string; group: string; variant: string };

/**
 * Parse a component reference (`"subsystem:group.variant"`) into its address parts.
 * Format-neutral core twin of the CSS adapter's `parseComponentReference` (which stays
 * for the option-C class-list path). Returns `undefined` on a malformed reference.
 */
export const parseRuleSetReference = (reference: string): RuleSetReference | undefined => {
  const [subsystem, rest] = reference.split(":");
  if (!subsystem || !rest) return undefined;
  const dot = rest.indexOf(".");
  if (dot < 0) return undefined;
  return { subsystem, group: rest.slice(0, dot), variant: rest.slice(dot + 1) };
};

/** Resolve a reference to its authored `RuleSet`, or `undefined` if it doesn't address one. */
const resolveReference = (model: ThemeModel, reference: string): RuleSet | undefined => {
  const parsed = parseRuleSetReference(reference);
  if (!parsed) return undefined;
  return model.subsystems[parsed.subsystem]?.ruleSets?.[parsed.group]?.[parsed.variant];
};

/** Fold `source` declarations into `target` (later source wins), shallow-cloning each Ref. */
const mergeDeclarations = (target: Record<string, Ref>, source: Record<string, Ref>): void => {
  for (const [prop, ref] of Object.entries(source)) target[prop] = { ...ref };
};

/** Stable string key for a conditioned bucket — `(breakpoint, query, orientation, state, container, size)`. */
const responsiveKey = (o: RuleSetOverride): string =>
  `${o.breakpoint ?? ""}|${o.query ?? ""}|${o.orientation ?? ""}|${o.state ?? ""}|${o.container ?? ""}|${o.size ?? ""}`;

/**
 * Flatten one component variant into a self-contained {@link MergedRuleSet}.
 *
 * Reads `model.subsystems.components.ruleSets[group][variant]` — its `references`
 * (resolved in authored order), own base `declarations`, and `overrides` — and unions
 * them under the locked precedence. Throws on a missing component or an unresolved reference.
 */
export const mergeComponentRuleSet = (
  model: ThemeModel,
  group: string,
  variant: string,
): MergedRuleSet => {
  const own = model.subsystems.components?.ruleSets?.[group]?.[variant];
  if (!own) {
    throw new RefractError("REFRACT_E_REFERENCE", `mergeComponentRuleSet: no component rule-set "${group}.${variant}"`);
  }

  // Sources in precedence order: referenced rule-sets left-to-right, then the component's own last.
  const sources: RuleSet[] = [];
  for (const reference of own.references ?? []) {
    const resolved = resolveReference(model, reference);
    if (!resolved) {
      throw new RefractError("REFRACT_E_REFERENCE", `mergeComponentRuleSet: unresolved reference "${reference}"`);
    }
    sources.push(resolved);
  }
  sources.push(own);

  const base: Record<string, Ref> = {};
  const states: Record<string, Record<string, Ref>> = {};
  const responsiveByKey = new Map<string, MergedResponsiveEntry>();

  for (const source of sources) {
    mergeDeclarations(base, source.declarations);

    for (const override of source.overrides) {
      if (!override.declarations) continue;
      // A breakpoint OR container condition → a conditioned bucket (viewport → @media, container →
      // @container). Container overrides MUST route here, not fold into base (§10.5 correctness).
      if (override.breakpoint !== undefined || override.container !== undefined) {
        const key = responsiveKey(override);
        let entry = responsiveByKey.get(key);
        if (!entry) {
          entry = {
            ...(override.breakpoint !== undefined ? { breakpoint: override.breakpoint } : {}),
            ...(override.query !== undefined ? { query: override.query } : {}),
            ...(override.orientation !== undefined ? { orientation: override.orientation } : {}),
            ...(override.state !== undefined ? { state: override.state } : {}),
            ...(override.container !== undefined ? { container: override.container } : {}),
            ...(override.size !== undefined ? { size: override.size } : {}),
            declarations: {},
          };
          responsiveByKey.set(key, entry);
        }
        mergeDeclarations(entry.declarations, override.declarations);
      } else if (override.state !== undefined) {
        (states[override.state] ??= {});
        mergeDeclarations(states[override.state], override.declarations);
      } else {
        // Unconditional override (only variant/target, no breakpoint/state) — folds into base.
        mergeDeclarations(base, override.declarations);
      }
    }
  }

  const responsive = [...responsiveByKey.values()];

  // referencedPaths — every distinct token path across all buckets, first-appearance order.
  const seen = new Set<string>();
  const referencedPaths: string[] = [];
  const collect = (decls: Record<string, Ref>): void => {
    for (const ref of Object.values(decls)) {
      if (ref.ref !== undefined && !seen.has(ref.ref)) {
        seen.add(ref.ref);
        referencedPaths.push(ref.ref);
      }
    }
  };
  collect(base);
  for (const decls of Object.values(states)) collect(decls);
  for (const entry of responsive) collect(entry.declarations);

  return { base, states, responsive, referencedPaths };
};
