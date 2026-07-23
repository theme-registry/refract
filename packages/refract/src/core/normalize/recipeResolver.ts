/**
 * Lazy, memoized, cycle-safe recipe-variant resolver (clean-room port of
 * `core/common/recipeResolver.ts`).
 *
 * A recipe variant may reference a sibling variant (responsive `variant:` swaps). The
 * resolver interprets each variant on demand, caches the result, and detects cycles
 * (throwing with the offending chain). The interpret callback receives a `resolve`
 * function so it can pull a sibling's already-interpreted form.
 */
import type { NormalizedRecipeGroup, NormalizedRecipeVariant } from "./types";
import { RefractError } from "../errors";

export type RecipeInterpreter<
  TProps extends Record<string, unknown>,
  TBreakpoint extends string,
  TInterpreted,
> = (
  variantName: string,
  variant: NormalizedRecipeVariant<TProps, TBreakpoint>,
  resolve: (variantName: string) => TInterpreted,
) => TInterpreted;

export type RecipeVariantResolver<TInterpreted> = {
  resolve: (variantName: string) => TInterpreted;
  resolveAll: () => Record<string, TInterpreted>;
};

export type CreateRecipeVariantResolverOptions = {
  groupPath?: string;
};

export const createRecipeVariantResolver = <
  TProps extends Record<string, unknown>,
  TBreakpoint extends string,
  TInterpreted,
>(
  group: NormalizedRecipeGroup<TProps, TBreakpoint>,
  interpret: RecipeInterpreter<TProps, TBreakpoint, TInterpreted>,
  options: CreateRecipeVariantResolverOptions = {},
): RecipeVariantResolver<TInterpreted> => {
  const cache = new Map<string, TInterpreted>();
  const inProgress: string[] = [];
  const groupPath = options.groupPath ?? "recipes";

  const resolve = (variantName: string): TInterpreted => {
    if (cache.has(variantName)) {
      return cache.get(variantName) as TInterpreted;
    }

    if (inProgress.includes(variantName)) {
      const cycle = [...inProgress, variantName].join(" -> ");
      throw new RefractError("REFRACT_E_CYCLE", `Cyclic recipe reference in "${groupPath}": ${cycle}`);
    }

    const variant = group[variantName];
    if (!variant) {
      throw new RefractError("REFRACT_E_REFERENCE", `Recipe variant "${variantName}" is not defined in "${groupPath}".`);
    }

    inProgress.push(variantName);
    try {
      const result = interpret(variantName, variant, resolve);
      cache.set(variantName, result);
      return result;
    } finally {
      inProgress.pop();
    }
  };

  const resolveAll = (): Record<string, TInterpreted> => {
    const out: Record<string, TInterpreted> = {};
    for (const name of Object.keys(group)) {
      out[name] = resolve(name);
    }
    return out;
  };

  return { resolve, resolveAll };
};
