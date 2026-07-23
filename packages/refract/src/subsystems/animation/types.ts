/**
 * The animation subsystem's authoring types (§10.2).
 *
 * `animation` owns **motion tokens** (`duration` / `easing` / `delay`, each a regular property with
 * a base + variants, exactly like effects' `transitions`), **keyframes** (the new Model primitive —
 * a named, ordered `@keyframes`-shaped definition), and **animation-shorthand recipes** (a recipe
 * that names a keyframe + motion tokens and lowers to one class carrying an `animation:` shorthand).
 * Transitions stay in `effects` (golden-locked). Authoring type only.
 */
import type { PropertyValue, RecipeBlock } from "../../core/normalize";

// --- Motion tokens ---

/** A motion token value — `duration`/`delay` are numbers (ms), `easing` is a string. Base + variants. */
export type AnimationTokenValue = PropertyValue<string | number>;

// --- Keyframes ---

/**
 * One step's declarations — kebab-case CSS property → a **literal** geometric value (`opacity: 0`,
 * `transform: "translateY(20px)"`) or a **token reference** (`{ ref: "colors.surface" }`) resolved
 * late by the adapter, so a keyframe can animate a themed value.
 */
export type KeyframeStepDeclarations = Record<string, string | number | { ref: string }>;

/**
 * A keyframe definition — step selector (`from` / `to` / `"0%"` / `"50%"` / grouped `"0%, 100%"`) →
 * that step's declarations. Authoring order is preserved into the Model's ordered step list.
 */
export type KeyframeDefinition = Record<string, KeyframeStepDeclarations>;

// --- Recipes ---

/**
 * An animation recipe declaration block. `keyframes` names a keyframe; `duration`/`easing`/`delay`
 * name a **variant** of the matching motion-token property (`"base"` → the base, `"fast"` → the
 * `fast` variant). The remaining keys are literal `animation-*` sub-properties passed through to the
 * composed shorthand.
 */
export type AnimationRecipeProps = {
  keyframes?: string;
  duration?: string;
  easing?: string;
  delay?: string;
  iterationCount?: string | number;
  direction?: string;
  fillMode?: string;
  playState?: string;
  [property: string]: string | number | undefined;
};

/**
 * The authored `rawTheme.animation` slice. An **open** map: keys are motion-token names
 * (`duration`, `easing`, `delay`), each an {@link AnimationTokenValue}; the reserved `keyframes` key
 * holds the keyframe definitions and the reserved `recipes` key an animation-recipe block.
 */
export interface AnimationRaw {
  keyframes?: Record<string, KeyframeDefinition>;
  recipes?: RecipeBlock<AnimationRecipeProps>;
  [property: string]: AnimationTokenValue | Record<string, KeyframeDefinition> | RecipeBlock<AnimationRecipeProps> | undefined;
}
