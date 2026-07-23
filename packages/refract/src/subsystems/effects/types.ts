import type { PropertyValue, RecipeBlock } from "../../core/normalize";
import type {
  ShadowInput,
  ShadowLayerInput,
  TransitionInput,
  TransitionPartInput,
} from "./utils";

/**
 * Effects' property + recipe types. A "regular" subsystem — plain property values
 * (no palette-style synthesis). Ported from the old `subsystems/effects/types.ts`,
 * trimmed to the normalize / recipe surface the clean-room pipeline needs.
 */

// --- Property values ---
// NOTE (§14): border/outline geometry (`radius`, `borderWidth`, `outline`) moved OUT to the
// dedicated `borders` subsystem. Effects keeps shadow / blur / opacity / zIndex / transitions.
// NOTE (§15): `shadow` / `transitions` are structured object-leaf properties (see below); the
// scalars (`blur` / `opacity` / `zIndex`) stay plain primitives.

/**
 * A structured object-leaf property (§15, structured-only per the 2026-07-16 amendment). The FLAT
 * authoring shape: the leaf fields (`TLeaf`) sit at the property top level and ARE the (single-layer)
 * base; `variants` / `responsive` / `modes` hold full leaf values (`TInput` = a flat leaf, an array
 * of leaves for a multi-layer variant/mode, or the `"none"` keyword). **No `base` key** — the base is
 * the top-level leaves (or `"none"` when none are authored); there is no multi-layer BASE. A bare
 * `"none"` is also accepted (no shadow / no transition at all). Raw CSS strings are rejected at coerce.
 */
export type StructuredProperty<TInput, TLeaf> =
  | "none"
  | (TLeaf & {
      variants?: Record<string, TInput>;
      responsive?: Array<
        {
          breakpoint: string;
          query?: "min" | "max" | "exact";
          variant?: string;
          target?: string;
          orientation?: "landscape" | "portrait";
        } & TLeaf
      >;
      modes?: Record<string, TInput>;
    });

/** Authored box-shadow property (§15) — structured single-layer base + structured variants/modes. */
export type ShadowValue = StructuredProperty<ShadowInput, ShadowLayerInput>;
/** Authored transition property (§15) — structured single-part base + structured variants/modes. */
export type TransitionValue = StructuredProperty<TransitionInput, TransitionPartInput>;
export type BlurValue = PropertyValue<number | string>;
export type ZIndexValue = PropertyValue<number>;
export type OpacityValue = PropertyValue<number>;

/**
 * An effects recipe declaration block. Each value names a **variant** of the matching
 * effects property; the recipe prop key differs from the token key (`boxShadow` → `shadow`,
 * `transition` → `transitions`) — the interpreter maps it via its resolve-key map. `blur` is
 * a compound: it lowers to `filter: blur(var(--…))` via a `{ ref, wrap: "blur" }` ref.
 */
export type EffectsRecipeProps = {
  boxShadow?: string;
  opacity?: string;
  blur?: string;
  transition?: string;
  zIndex?: string;
  [property: string]: string | undefined;
};

/**
 * An effects property value (§8a, §15). Effects properties span plain scalars (`blur`
 * `number | string`, `opacity`/`zIndex` numbers) AND the structured object-leaf properties
 * `shadow` / `transitions`. An **open** authoring union — the `EffectsRaw` index signature keys
 * every property to it; runtime coercion (`effects/utils.ts`) validates the concrete shape per key.
 */
export type EffectsPropertyValue =
  | PropertyValue<string | number>
  | ShadowValue
  | TransitionValue;

/**
 * The authored `raw.effects` slice (§8a). An **open** map: keys are effects property names
 * (`shadow`, `blur`, `transitions`, …), each an {@link EffectsPropertyValue}; the reserved
 * `recipes` key is a {@link RecipeBlock} of effects recipes. Authoring type only.
 */
export interface EffectsRaw {
  recipes?: RecipeBlock<EffectsRecipeProps>;
  [property: string]: EffectsPropertyValue | RecipeBlock<EffectsRecipeProps> | undefined;
}
