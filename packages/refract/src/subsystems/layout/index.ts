/**
 * The layout subsystem — the biggest one, with three parts:
 *  1. Regular property tokens (`spacing` / `gutters` / `aspectRatio`) — like typography/effects,
 *     plus the forced `none` variant on spacing/gutters (`finalizeLayoutNormalization`).
 *  2. Recipes (`padding` / `section`) — ordinary token-path recipes (`interpretRecipe`).
 *  3. Structural generators (`columns` / `grids` / `stacks` / `container`) — emitted as native
 *     Model rule-sets via the `buildStructural` hook (see `structural.ts`), with the columns/
 *     container config knobs riding along as `configProperties` (Model `extraProperties`).
 *
 * It grows the spine's hooks (`interpretRecipe`, `buildStructural`), never the spine's control flow.
 */

import type { Subsystem, NormalizedProperties } from "../../core/subsystem";
import { RefractError } from "../../core/errors";
import type { NormalizedPropertyValue, NormalizedRecipeVariant } from "../../core/normalize";
import {
  normalizePropertyValue,
  validateNormalizedResponsiveRefs,
} from "../../core/normalize";
import type { LayoutRecipeProps } from "./types";
import { LAYOUT_PROPERTY_KEYS } from "./types";
import { finalizeLayoutNormalization, scaleStep } from "./normalize";
import { interpretLayoutRecipeVariant } from "./recipes";
import { buildLayoutStructural } from "./structural";

/** The "regular" property keys layout normalizes (the rest are structural / recipes). */
const PROPERTY_KEYS: ReadonlySet<string> = new Set(LAYOUT_PROPERTY_KEYS);

/** Every key `raw.layout` accepts — layout is closed, so anything else is a mistake, not a property. */
const LAYOUT_KEYS: ReadonlySet<string> = new Set([
  ...LAYOUT_PROPERTY_KEYS,
  "columns",
  "grids",
  "stacks",
  "container",
  "recipes",
]);

export const layoutSubsystem: Subsystem = {
  key: "layout",
  // §10.6 numeric scale synthesis: the fn its synthesized spacing/gutters/sizes steps derive through,
  // so `override()` of a base re-resolves the ramp (mirror colors' `darken`/`lighten`).
  derivations: {
    scaleStep: (value, arg) => scaleStep(value, arg),
  },
  normalizeProperties(rawSlice, ctx): NormalizedProperties {
    const out: NormalizedProperties = {};
    if (!rawSlice) return out;

    const unknown = Object.keys(rawSlice).filter(key => !LAYOUT_KEYS.has(key));
    if (unknown.length) {
      throw new RefractError(
        "REFRACT_E_LAYOUT",
        `Unknown layout key${unknown.length > 1 ? "s" : ""} ${unknown.map(k => `"${k}"`).join(", ")} — layout takes ` +
          `${[...LAYOUT_KEYS].join(", ")}. Padding, margins and other spacing uses go in layout.recipes.`,
      );
    }

    for (const name of LAYOUT_PROPERTY_KEYS) {
      const value = rawSlice[name];
      if (value === undefined || !PROPERTY_KEYS.has(name)) continue;

      const normalized = normalizePropertyValue<unknown, Record<string, unknown>>(value as never, {
        propertyPath: `layout.${name}`,
        allowedBreakpoints: ctx.allowedBreakpoints,
      });
      const finalized = finalizeLayoutNormalization(name, normalized as NormalizedPropertyValue<unknown>);
      validateNormalizedResponsiveRefs(finalized, { propertyPath: `layout.${name}` });

      out[name] = finalized as NormalizedPropertyValue<unknown, Record<string, unknown>>;
    }

    return out;
  },
  interpretRecipe(variantName, variant, ctx) {
    return interpretLayoutRecipeVariant(
      variantName,
      variant as NormalizedRecipeVariant<LayoutRecipeProps, string>,
      ctx,
    );
  },
  buildStructural(rawSlice, ctx) {
    return buildLayoutStructural(rawSlice, ctx.breakpoints, ctx.mediaConfig);
  },
};

export type { LayoutRaw, ContainerRaw, ContainerVariantRaw } from "./types";
