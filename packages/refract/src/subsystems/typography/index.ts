/**
 * The typography subsystem — a "regular" subsystem (no synthesized-ref derivations,
 * unlike colors' tonal steps). Iterates `raw.typography` (skipping the reserved `recipes`
 * key), runs the shared property normalize + the fontSize modular-scale synthesis per
 * property, and interprets recipes into token-path refs. It grows a hook, never the spine.
 */

import type { Subsystem, NormalizedProperties } from "../../core/subsystem";
import type { NormalizedPropertyValue, NormalizedRecipeVariant } from "../../core/normalize";
import {
  normalizePropertyValue,
  validateNormalizedResponsiveRefs,
} from "../../core/normalize";
import type { FontSizeExtras, TypographyRecipeProps } from "./types";
import { finalizeTypographyNormalization } from "./normalize";
import { interpretTypographyRecipeVariant } from "./recipes";

/** Sub-keys of `raw.typography` that are not properties. */
const RESERVED_KEYS: ReadonlySet<string> = new Set(["recipes"]);

export const typographySubsystem: Subsystem = {
  key: "typography",
  normalizeProperties(rawSlice, ctx): NormalizedProperties {
    const out: NormalizedProperties = {};
    if (!rawSlice) return out;

    for (const [name, value] of Object.entries(rawSlice)) {
      if (RESERVED_KEYS.has(name)) continue;

      const normalized = normalizePropertyValue<unknown, FontSizeExtras>(
        value as never,
        { propertyPath: `typography.${name}`, allowedBreakpoints: ctx.allowedBreakpoints },
      );
      const finalized = finalizeTypographyNormalization(
        name,
        normalized as NormalizedPropertyValue<unknown>,
      );
      validateNormalizedResponsiveRefs(finalized, { propertyPath: `typography.${name}` });

      out[name] = finalized as NormalizedPropertyValue<unknown, Record<string, unknown>>;
    }

    return out;
  },
  interpretRecipe(variantName, variant, ctx) {
    return interpretTypographyRecipeVariant(
      variantName,
      variant as NormalizedRecipeVariant<TypographyRecipeProps, string>,
      ctx,
    );
  },
};

export type { TypographyRaw, TypographyPropertyValue } from "./types";
