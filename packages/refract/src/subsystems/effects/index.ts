/**
 * The effects subsystem — a "regular" subsystem with no property finalize hook (values
 * pass straight through the shared normalize). Iterates `raw.effects` (skipping the
 * reserved `recipes` key) and interprets recipes into token-path refs (incl. the `blur`
 * compound as a `{ ref, wrap: "blur" }` ref). It grows a hook, never the spine.
 */

import type { Subsystem, NormalizedProperties } from "../../core/subsystem";
import type { NormalizedPropertyValue, NormalizedRecipeVariant } from "../../core/normalize";
import {
  normalizePropertyValue,
  validateNormalizedResponsiveRefs,
} from "../../core/normalize";
import type { EffectsRecipeProps } from "./types";
import { interpretEffectsRecipeVariant } from "./recipes";
import { coerceShadowValue, coerceTransitionValue } from "./utils";
import type { ShadowInput, TransitionInput } from "./utils";

/** Sub-keys of `raw.effects` that are not properties. */
const RESERVED_KEYS: ReadonlySet<string> = new Set(["recipes"]);

/**
 * §15 object-leaf properties: the value-field set the core assembles into the base (vs `TExtra`
 * siblings), plus a per-property `coerceValue` that canonicalizes each leaf into the Model's
 * structured form (or passes a raw string through). Scalar properties (blur/opacity/zIndex) appear
 * here NOT at all → they take the plain primitive path (no `leafFields`, no coerce).
 */
const SHADOW_LEAF_FIELDS = ["offsetX", "offsetY", "blur", "spread", "color", "inset"] as const;
const TRANSITION_LEAF_FIELDS = ["property", "duration", "timingFunction", "delay"] as const;

const LEAF_FIELDS: Record<string, readonly string[]> = {
  shadow: SHADOW_LEAF_FIELDS,
  transitions: TRANSITION_LEAF_FIELDS,
};

/** Per-property value coercion (§15). A property absent here is a plain scalar (no coercion). */
const coerceFor = (name: string): ((value: unknown) => unknown) | undefined => {
  if (name === "shadow") return value => coerceShadowValue(value as ShadowInput, `effects.${name}`);
  if (name === "transitions") return value => coerceTransitionValue(value as TransitionInput, `effects.${name}`);
  return undefined;
};

export const effectsSubsystem: Subsystem = {
  key: "effects",
  normalizeProperties(rawSlice, ctx): NormalizedProperties {
    const out: NormalizedProperties = {};
    if (!rawSlice) return out;

    for (const [name, value] of Object.entries(rawSlice)) {
      if (RESERVED_KEYS.has(name)) continue;

      const leafFields = LEAF_FIELDS[name];
      const coerceValue = coerceFor(name);
      const normalized = normalizePropertyValue<unknown>(value as never, {
        propertyPath: `effects.${name}`,
        allowedBreakpoints: ctx.allowedBreakpoints,
        ...(leafFields ? { leafFields } : {}),
        ...(coerceValue ? { coerceValue } : {}),
        // §15.2 (amended): no `base` key — a property with only variants/modes (no top-level leaves)
        // has an implicit `"none"` base (the coerce keyword), instead of failing base resolution.
        ...(leafFields ? { fallbackBase: "none" } : {}),
      });
      validateNormalizedResponsiveRefs(normalized, { propertyPath: `effects.${name}` });

      out[name] = normalized as NormalizedPropertyValue<unknown, Record<string, unknown>>;
    }

    return out;
  },
  interpretRecipe(variantName, variant, ctx) {
    return interpretEffectsRecipeVariant(
      variantName,
      variant as NormalizedRecipeVariant<EffectsRecipeProps, string>,
      ctx,
    );
  },
};

export type { EffectsRaw, EffectsPropertyValue } from "./types";
