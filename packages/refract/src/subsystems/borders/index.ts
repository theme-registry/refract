/**
 * The borders subsystem (§14) — a "regular" subsystem (no property finalize hook; values pass
 * straight through the shared normalize) carved out of effects. Owns the stroke geometry
 * vocabulary (width / style / offset / radius) and interprets border/outline recipes via the
 * `(as, side, aspect)` → css-property computation, with `color` a value-level `colors.*` ref.
 * It grows a hook, never the spine.
 */

import type { Subsystem, NormalizedProperties } from "../../core/subsystem";
import type { NormalizedPropertyValue, NormalizedRecipeVariant } from "../../core/normalize";
import {
  normalizePropertyValue,
  validateNormalizedResponsiveRefs,
} from "../../core/normalize";
import type { BordersRecipeProps } from "./types";
import { interpretBordersRecipeVariant } from "./recipes";

/** Sub-keys of `raw.borders` that are not properties. */
const RESERVED_KEYS: ReadonlySet<string> = new Set(["recipes"]);

export const bordersSubsystem: Subsystem = {
  key: "borders",
  normalizeProperties(rawSlice, ctx): NormalizedProperties {
    const out: NormalizedProperties = {};
    if (!rawSlice) return out;

    for (const [name, value] of Object.entries(rawSlice)) {
      if (RESERVED_KEYS.has(name)) continue;

      const normalized = normalizePropertyValue<unknown>(value as never, {
        propertyPath: `borders.${name}`,
        allowedBreakpoints: ctx.allowedBreakpoints,
      });
      validateNormalizedResponsiveRefs(normalized, { propertyPath: `borders.${name}` });

      out[name] = normalized as NormalizedPropertyValue<unknown, Record<string, unknown>>;
    }

    return out;
  },
  interpretRecipe(variantName, variant, ctx) {
    return interpretBordersRecipeVariant(
      variantName,
      variant as NormalizedRecipeVariant<BordersRecipeProps, string>,
      ctx,
    );
  },
};

export type { BordersRaw, BordersPropertyValue } from "./types";
