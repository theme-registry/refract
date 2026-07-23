/**
 * The components (composition) subsystem.
 *
 * Owns **no primitive properties** (the property pipeline never runs — `normalizeProperties`
 * returns empty). It contributes only recipes that reference other subsystems' recipes plus an
 * own `css` delta. The generic recipe path drives `interpretRecipe` (own delta → refs) and, via
 * the `extractReferences` hook, keeps each variant's cross-subsystem references as Model pointers
 * (`"colors:solid.primary"`) so the referenced recipe's states ride along on its shared class.
 * It grows a hook, never the spine.
 */

import type { Subsystem, NormalizedProperties } from "../../core/subsystem";
import type { NormalizedRecipeVariant } from "../../core/normalize";
import { extractComponentReferences } from "../../core/model";
import type { ComponentsRecipeProps } from "./types";
import { interpretComponentsRecipeVariant } from "./recipes";

export const componentsSubsystem: Subsystem = {
  key: "components",
  // No property pipeline — components own no primitive tokens.
  normalizeProperties(): NormalizedProperties {
    return {};
  },
  interpretRecipe(variantName, variant, ctx) {
    return interpretComponentsRecipeVariant(
      variantName,
      variant as NormalizedRecipeVariant<ComponentsRecipeProps, string>,
      ctx,
    );
  },
  extractReferences(normalizedVariantBase) {
    return extractComponentReferences(normalizedVariantBase);
  },
};

export type { ComponentsRecipeProps, ResolvedComponentClass, ComponentsRaw } from "./types";
