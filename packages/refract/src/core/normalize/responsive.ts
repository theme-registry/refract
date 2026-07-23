/**
 * Responsive-override normalization + reference validation.
 *
 * Normalizes a property's `responsive[]` entries (defaulting each `query`) and
 * validates their `breakpoint` / `variant` / `target` references against the
 * allowed sets threaded in via the normalization context.
 */

import type {
  NormalizedPropertyValue,
  NormalizedResponsiveOverride,
  PropertyNormalizationOptions,
  ResponsiveOverride,
  ResponsiveQuery,
} from "./types";
import { RefractError } from "../errors";

/** The `query` a responsive entry gets when none is authored — an exact-width media match. */
export const DEFAULT_RESPONSIVE_QUERY: ResponsiveQuery = "exact";

type AllowedValues<T> = ReadonlyArray<T> | ReadonlySet<T>;

type ResponsiveNormalizationContext<TBreakpoint extends string> = Pick<
  PropertyNormalizationOptions<unknown, TBreakpoint>,
  "propertyPath" | "allowedBreakpoints"
> & {
  allowedTargets?: AllowedValues<string>;
  allowedVariants?: AllowedValues<string>;
};

/** Build the ` for "<path>"` suffix used in error messages (empty when no path is known). */
const formatContextLabel = (context?: { propertyPath?: string }): string =>
  context?.propertyPath ? ` for "${context.propertyPath}"` : "";

/** Membership test that treats a missing `allowed` set as "anything goes". */
const isAllowedValue = <T>(value: T, allowed?: AllowedValues<T>): boolean => {
  if (!allowed) {
    return true;
  }

  if (Array.isArray(allowed)) {
    return allowed.includes(value);
  }

  return (allowed as ReadonlySet<T>).has(value);
};

/**
 * Normalize a property's `responsive[]` list: default each entry's `query` and
 * validate its references against the context's allowed sets.
 *
 * @param overrides The authored responsive entries (or `undefined` / empty → `[]`).
 * @param context   Optional allowed sets — `allowedBreakpoints` / `allowedVariants`
 *   / `allowedTargets` — plus `propertyPath` for error labels.
 * @throws If an entry is missing a `breakpoint`, or references an unknown
 *   breakpoint / variant / target.
 */
export function normalizeResponsiveOverrides<
  TValue,
  TExtra extends Record<string, unknown> = Record<string, never>,
  TBreakpoint extends string = string,
>(
  overrides: ResponsiveOverride<TValue, TExtra, TBreakpoint>[] | undefined,
  context?: ResponsiveNormalizationContext<TBreakpoint>,
): NormalizedResponsiveOverride<TValue, TExtra, TBreakpoint>[] {
  if (!overrides?.length) {
    return [];
  }

  return overrides.map(override => {
    if (!override.breakpoint) {
      throw new RefractError(
        "REFRACT_E_BREAKPOINT",
        `Responsive entry${formatContextLabel(context)} is missing a "breakpoint" value.`,
      );
    }

    if (
      context?.allowedBreakpoints &&
      !isAllowedValue(override.breakpoint, context.allowedBreakpoints)
    ) {
      throw new RefractError(
        "REFRACT_E_BREAKPOINT",
        `Responsive entry${formatContextLabel(context)} references unknown breakpoint "${override.breakpoint}".`,
      );
    }

    // NB: on the PROPERTY side, `ref` + `target` is a supported *compose* (read a variant's value,
    // write it into another variant's token — see responsive-ref.test.ts), NOT a conflict. The
    // variant/target mutual-exclusion applies only to a RECIPE entry (a whole-recipe swap vs a scope),
    // enforced in normalizeRecipeResponsive.
    if (override.ref && !isAllowedValue(override.ref, context?.allowedVariants)) {
      throw new RefractError(
        "REFRACT_E_RESPONSIVE",
        `Responsive entry${formatContextLabel(context)} references unknown variant "${override.ref}" (ref).`,
      );
    }

    if (override.target && !isAllowedValue(override.target, context?.allowedTargets)) {
      throw new RefractError(
        "REFRACT_E_RESPONSIVE",
        `Responsive entry${formatContextLabel(context)} references unknown target "${override.target}".`,
      );
    }

    const { query, ...rest } = override;

    return {
      ...rest,
      query: query ?? DEFAULT_RESPONSIVE_QUERY,
    };
  });
}

/**
 * Second-pass validation: once a property is fully normalized, confirm every
 * responsive `variant` / `target` names a variant that actually exists on it.
 *
 * Complements {@link normalizeResponsiveOverrides}, which can't see the property's
 * own variant set during the first pass (variants are normalized in parallel).
 * A no-op when the property declares no variants.
 *
 * @throws If a responsive entry references a variant/target with no matching definition.
 */
export function validateNormalizedResponsiveRefs<
  TValue,
  TExtra extends Record<string, unknown> = Record<string, never>,
  TBreakpoint extends string = string,
>(
  normalized: NormalizedPropertyValue<TValue, TExtra, TBreakpoint>,
  options?: { propertyPath?: string },
): void {
  const variantNames = normalized.variants ? Object.keys(normalized.variants) : [];
  if (!variantNames.length) return;

  const allowed = new Set(variantNames);
  const label = options?.propertyPath ? ` for "${options.propertyPath}"` : "";

  for (const entry of normalized.responsive) {
    if (entry.ref && !allowed.has(entry.ref)) {
      throw new RefractError(
        "REFRACT_E_RESPONSIVE",
        `Responsive entry${label} references unknown variant "${entry.ref}" (ref).`,
      );
    }
    if (entry.target && !allowed.has(entry.target)) {
      throw new RefractError(
        "REFRACT_E_RESPONSIVE",
        `Responsive entry${label} references unknown target "${entry.target}".`,
      );
    }
  }
}
