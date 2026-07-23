/**
 * `defineAdapter` — turns an `AdapterSpec` (identity + a `bind` returning the four
 * required primitives) into a full `ThemeAdapter` whose `bind` yields a complete
 * `BoundAdapter` with the DEFAULTED aggregators supplied.
 *
 * The defaults are pure Model walks: the Model enumerates every subsystem and every
 * (group, variant), so core loops it, calls the author's per-unit renderers, and
 * `join`s the results. Model/ctx are already bound, so the aggregators take no args.
 * An author can still override any aggregator (a format whose full document isn't a
 * flat concatenation).
 */

import type { ThemeModel } from "./model";
import type {
  AdapterSpec,
  ThemeAdapter,
  BoundAdapter,
  RenderContext,
  UsageDescriptor,
} from "./ThemeAdapter";

/** Every rule-set address in the Model — `(subsystem, group, variant)` triples. */
function eachRuleSet(model: ThemeModel): Array<{ subsystem: string; group: string; variant: string }> {
  const out: Array<{ subsystem: string; group: string; variant: string }> = [];
  for (const [subsystem, sub] of Object.entries(model.subsystems)) {
    for (const [group, ruleSet] of Object.entries(sub.ruleSets ?? {})) {
      for (const variant of Object.keys(ruleSet)) {
        out.push({ subsystem, group, variant });
      }
    }
  }
  return out;
}

/**
 * Complete an `AdapterSpec` into a `ThemeAdapter`.
 *
 * Wraps the author's `bind` so the returned `BoundAdapter` gains the defaulted
 * aggregators (`renderAllRecipes` / `renderAllVariables` / `renderAll`) built from
 * the required primitives — unless the spec already provides its own override.
 * `name` / `version` pass through unchanged.
 *
 * @param spec identity (`name`/`version`) + a `bind(model, ctx)` returning the
 *   required render primitives (and any optional overrides).
 * @returns a full adapter whose `bind(model, ctx)` yields a complete `BoundAdapter`.
 */
export function defineAdapter<TUnit>(spec: AdapterSpec<TUnit>): ThemeAdapter<TUnit> {
  return {
    name: spec.name,
    version: spec.version,
    allowedStates: spec.allowedStates,
    bind(model: ThemeModel, ctx: RenderContext): BoundAdapter<TUnit> {
      const b = spec.bind(model, ctx);

      const renderAllRecipes =
        b.renderAllRecipes ??
        ((): TUnit =>
          b.join(
            eachRuleSet(model).map(({ subsystem, group, variant }) =>
              b.renderRecipe(subsystem, group, variant),
            ),
          ));

      const renderAllVariables =
        b.renderAllVariables ??
        ((): TUnit => b.join(Object.keys(model.subsystems).map(subsystem => b.renderVariables(subsystem))));

      const renderAll =
        b.renderAll ?? ((): TUnit => b.join([renderAllVariables(), renderAllRecipes()]));

      // Generic self-documentation: the recipe identities are format-correct via `recipeName`; an
      // adapter overrides `describeUsage` to add format-specific import prose to `summary`.
      const describeUsage =
        b.describeUsage ??
        ((): UsageDescriptor => ({
          format: spec.name,
          summary: [`This theme was built with the "${spec.name}" refract adapter.`],
          recipes: eachRuleSet(model).map(({ subsystem, group, variant }) => ({
            subsystem,
            group,
            variant,
            name: b.recipeName(subsystem, group, variant),
          })),
        }));

      return { ...b, renderAllRecipes, renderAllVariables, renderAll, describeUsage };
    },
  };
}
