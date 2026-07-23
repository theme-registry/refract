/**
 * Animation's `interpretRecipe` hook (Â§10.2) â resolves an animation recipe variant into the
 * `animation-*` longhand {@link Ref}s the CSS adapter composes into an `animation:` shorthand.
 *
 * `duration`/`easing`/`delay` name a **variant** of the matching motion-token property (mirrors the
 * effects interpreter's variant-path resolution) â `animation.<prop>[.<variant>]` token-path refs.
 * `keyframes` names a keyframe â an `animation.keyframes.<name>` ref the adapter resolves to the bare
 * keyframe identifier. Remaining `animation-*` literals pass through as `{ value }`. No `var(--â¦)`
 * strings â the adapter maps paths to vars (and the keyframe ref to a name) at render time.
 */
import type { InterpretedRecipeVariant, InterpretedRecipeOverride, Ref } from "../../core/model";
import type { NormalizedRecipeVariant } from "../../core/normalize";
import type { RecipeInterpretContext } from "../../core/subsystem";
import type { AnimationRecipeProps } from "./types";

const RESERVED_KEYS: ReadonlySet<string> = new Set([
  "breakpoint",
  "query",
  "state",
  "variant",
  "target",
  "orientation",
]);

/** Recipe prop key â the `animation-*` longhand CSS property it contributes to the shorthand. */
const PROPERTY_CSS_MAP: Record<string, string> = {
  keyframes: "animation-name",
  duration: "animation-duration",
  easing: "animation-timing-function",
  delay: "animation-delay",
  iterationCount: "animation-iteration-count",
  direction: "animation-direction",
  fillMode: "animation-fill-mode",
  playState: "animation-play-state",
};

/** Recipe prop key â the motion-token **property name** whose variant it references. */
const RESOLVE_KEY_MAP: Record<string, string> = {
  duration: "duration",
  easing: "easing",
  delay: "delay",
};

/** The token path for a motion-token variant: `animation.<name>` for `"base"`, else `animation.<name>.<variant>`. */
const variantPath = (propertyName: string, variant: string): string =>
  variant === "base" ? `animation.${propertyName}` : `animation.${propertyName}.${variant}`;

/** Interpret a flat animation-recipe declaration block â `animation-* â Ref`, skipping empty/unknown keys. */
const interpretProps = (props: AnimationRecipeProps | undefined): Record<string, Ref> => {
  const declarations: Record<string, Ref> = {};
  if (!props) return declarations;

  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === "" || RESERVED_KEYS.has(key)) continue;
    const cssProperty = PROPERTY_CSS_MAP[key];
    if (!cssProperty) continue;

    if (key === "keyframes") {
      declarations[cssProperty] = { ref: `animation.keyframes.${value}` };
    } else if (RESOLVE_KEY_MAP[key]) {
      declarations[cssProperty] = { ref: variantPath(RESOLVE_KEY_MAP[key], String(value)) };
    } else {
      // Literal `animation-*` sub-property (iteration-count / direction / fill-mode / play-state).
      declarations[cssProperty] = { value: value as string | number };
    }
  }

  return declarations;
};

/**
 * Interpret one animation recipe variant into base + responsive/state override declarations, each an
 * `animation-*` longhand {@link Ref}. A responsive `variant:` swap inherits the sibling's base
 * declarations (via `ctx.resolveRecipeVariant`), exactly like the effects interpreter.
 */
export const interpretAnimationRecipeVariant = (
  variantName: string,
  variant: NormalizedRecipeVariant<AnimationRecipeProps, string>,
  ctx: RecipeInterpretContext,
): InterpretedRecipeVariant<string> => {
  const base = interpretProps(variant.base);

  const responsive: InterpretedRecipeOverride<string>[] = variant.responsive.map(entry => {
    const { breakpoint, query, state, variant: swap, target, orientation, container, size, ...rawDecls } =
      entry as AnimationRecipeProps & {
        breakpoint?: string;
        query?: "min" | "max" | "exact";
        state?: string;
        variant?: string;
        target?: string;
        orientation?: "landscape" | "portrait";
        container?: string;
        size?: string;
      };

    const inherited = swap ? { ...ctx.resolveRecipeVariant(swap).base } : {};
    const overrides = interpretProps(rawDecls as AnimationRecipeProps);

    const override: InterpretedRecipeOverride<string> = {
      declarations: { ...inherited, ...overrides },
    };
    if (breakpoint) {
      override.breakpoint = breakpoint;
      override.query = query ?? "exact";
    }
    if (container) {
      override.container = container;
      if (size) override.size = size;
      override.query = query ?? "min";
    }
    if (state) override.state = state;
    if (target) override.target = target; // dec.8 — scope onto the `<item>-<target>` sibling
    if (orientation) override.orientation = orientation;
    return override;
  });

  return { base, responsive };
};
