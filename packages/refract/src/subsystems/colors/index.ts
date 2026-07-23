/**
 * The colors subsystem (Step 0d — properties only).
 *
 * Iterates `raw.colors` (skipping the reserved `recipes` key), running the shared
 * property normalize + colors' palette-step synthesis per colour. Recipes / CSS
 * lowering land in Step 1; this file grows a hook, never the spine.
 */

import type { Subsystem, NormalizedProperties } from "../../core/subsystem";
import type {
  NormalizedPropertyValue,
  NormalizedRecipeVariant,
  PropertyValue,
} from "../../core/normalize";
import {
  normalizePropertyValue,
  validateNormalizedResponsiveRefs,
} from "../../core/normalize";
import type {
  NormalizedPaletteValue,
  PaletteDerivationSpec,
  PalettePropertyExtras,
  PaletteRecipeProps,
} from "./types";
import { finalizePaletteNormalization } from "./normalize";
import { interpretPaletteRecipeVariant } from "./recipes";
import type { AdjustDials } from "./utils";
import { lighten, darken, alpha, setL, rotateHue, adjust } from "./utils";
import { coerceColorInput } from "./colorInput";

/** Sub-keys of `raw.colors` that are not palette properties. */
const RESERVED_KEYS: ReadonlySet<string> = new Set(["recipes"]);

/** dec.2 — a `{ ref?, modifiers }` variant spec — must be split out before core normalize (no `base`). */
const isDerivationSpec = (value: unknown): value is PaletteDerivationSpec =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  !("base" in value) &&
  Array.isArray((value as { modifiers?: unknown }).modifiers);

/**
 * Peel derivation-spec variants (`{ darken|lighten|alpha, ref? }`) out of an authored colour so
 * core normalize sees only literal/extended variants (it can't interpret a spec — it has no `base`).
 * Returns the colour with those variants removed, plus the extracted specs for colors to bake.
 */
const splitDerivationVariants = (
  value: unknown,
): { value: unknown; specs: Record<string, PaletteDerivationSpec> } => {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !(value as { variants?: unknown }).variants
  ) {
    return { value, specs: {} };
  }

  const variants = (value as { variants: Record<string, unknown> }).variants;
  const specs: Record<string, PaletteDerivationSpec> = {};
  const plain: Record<string, unknown> = {};
  for (const [key, variant] of Object.entries(variants)) {
    if (isDerivationSpec(variant)) specs[key] = variant;
    else plain[key] = variant;
  }

  if (!Object.keys(specs).length) return { value, specs };

  const nextVariants = Object.keys(plain).length ? plain : undefined;
  return { value: { ...(value as object), variants: nextVariants }, specs };
};

export const colorsSubsystem: Subsystem = {
  key: "colors",
  // The derivation fns colors records on its synthesized variants (`light`/`dark`/`ghost`/…). The
  // resolver hands each `(literal, arg)`; adapt to the colour-math `(value, percent)` signature.
  derivations: {
    lighten: (value, arg) => lighten(String(value), Number(arg)),
    darken: (value, arg) => darken(String(value), Number(arg)),
    alpha: (value, arg) => alpha(String(value), Number(arg)),
    setL: (value, arg) => setL(String(value), Number(arg)),
    rotateHue: (value, arg) => rotateHue(String(value), Number(arg)),
    adjust: (value, arg) => adjust(String(value), arg as AdjustDials),
  },
  normalizeProperties(rawSlice, ctx): NormalizedProperties {
    const out: NormalizedProperties = {};
    if (!rawSlice) return out;

    for (const [name, value] of Object.entries(rawSlice)) {
      if (RESERVED_KEYS.has(name)) continue;

      const { value: plainValue, specs } = splitDerivationVariants(value);
      // Specs are stripped above and a tuple base is coerced by `coerceValue`, so the residual is
      // core-shaped — cast to the core authoring type at this boundary.
      const normalized = normalizePropertyValue<string, PalettePropertyExtras>(
        plainValue as PropertyValue<string, PalettePropertyExtras>,
        {
          propertyPath: `colors.${name}`,
          allowedBreakpoints: ctx.allowedBreakpoints,
          coerceValue: coerceColorInput,
        },
      );
      const finalized = finalizePaletteNormalization(
        name,
        normalized as NormalizedPaletteValue,
        specs,
      );
      validateNormalizedResponsiveRefs(finalized as NormalizedPropertyValue<unknown>, {
        propertyPath: `colors.${name}`,
      });

      out[name] = finalized as NormalizedPropertyValue<unknown, Record<string, unknown>>;
    }

    return out;
  },
  interpretRecipe(variantName, variant, ctx) {
    return interpretPaletteRecipeVariant(
      variantName,
      variant as NormalizedRecipeVariant<PaletteRecipeProps, string>,
      ctx,
    );
  },
};

export type { ColorsRaw } from "./types";
export { audit } from "./audit";
export type { AuditResult, AuditOptions, PairingScore, PairingKind, WcagLevel } from "./audit";
