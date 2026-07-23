/**
 * The animation subsystem (§10.2).
 *
 * Owns three things: **motion tokens** (`duration`/`easing`/`delay`) via the shared property
 * normalize (like effects — no finalize hook), **animation-shorthand recipes** via `interpretRecipe`,
 * and **keyframes** via the generic `buildStructural` hook (the third `buildStructural` user, after
 * layout + reset). Keyframes are the new Model primitive: a named, ordered `{ stop, declarations }`
 * step list carried on `SubsystemModel.keyframes` — neither a token nor a rule-set. It grows a hook,
 * never the spine. Transitions stay in `effects` (golden-locked).
 */
import type { NormalizedProperties, StructuralOutput, Subsystem } from "../../core/subsystem";
import type { NormalizedPropertyValue, NormalizedRecipeVariant } from "../../core/normalize";
import {
  normalizePropertyValue,
  validateNormalizedResponsiveRefs,
} from "../../core/normalize";
import type { Keyframe, KeyframeStep, Ref } from "../../core/model";
import type { AnimationRecipeProps, KeyframeDefinition, KeyframeStepDeclarations } from "./types";
import { interpretAnimationRecipeVariant } from "./recipes";

/** Sub-keys of `raw.animation` that are not motion-token properties. */
const RESERVED_KEYS: ReadonlySet<string> = new Set(["keyframes", "recipes"]);

/** A keyframe step declaration value → a {@link Ref}: `{ ref }` for a token reference, else a literal. */
const declarationRef = (value: unknown): Ref | undefined => {
  if (value && typeof value === "object" && "ref" in (value as Record<string, unknown>)) {
    return { ref: String((value as { ref: unknown }).ref) };
  }
  if (typeof value === "string" || typeof value === "number") return { value };
  return undefined;
};

/** Parse one step's declarations (`property → literal | { ref }`) into `property → Ref`. */
const parseStepDeclarations = (raw: KeyframeStepDeclarations): Record<string, Ref> => {
  const out: Record<string, Ref> = {};
  for (const [property, value] of Object.entries(raw)) {
    const ref = declarationRef(value);
    if (ref) out[property] = ref;
  }
  return out;
};

/** Parse one keyframe definition (stop → declarations) into an ordered {@link Keyframe}. */
const parseKeyframe = (raw: KeyframeDefinition): Keyframe => {
  const steps: KeyframeStep[] = [];
  for (const [stop, declarations] of Object.entries(raw)) {
    steps.push({ stop, declarations: parseStepDeclarations(declarations) });
  }
  return { steps };
};

/** The `animation.keyframes` slice → `name → {@link Keyframe}`. */
const buildKeyframes = (raw: unknown): Record<string, Keyframe> => {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, Keyframe> = {};
  for (const [name, definition] of Object.entries(raw as Record<string, KeyframeDefinition>)) {
    if (definition && typeof definition === "object") out[name] = parseKeyframe(definition);
  }
  return out;
};

export const animationSubsystem: Subsystem = {
  key: "animation",
  normalizeProperties(rawSlice, ctx): NormalizedProperties {
    const out: NormalizedProperties = {};
    if (!rawSlice) return out;

    for (const [name, value] of Object.entries(rawSlice)) {
      if (RESERVED_KEYS.has(name)) continue;

      const normalized = normalizePropertyValue<unknown>(value as never, {
        propertyPath: `animation.${name}`,
        allowedBreakpoints: ctx.allowedBreakpoints,
      });
      validateNormalizedResponsiveRefs(normalized, { propertyPath: `animation.${name}` });

      out[name] = normalized as NormalizedPropertyValue<unknown, Record<string, unknown>>;
    }

    return out;
  },
  interpretRecipe(variantName, variant, ctx) {
    return interpretAnimationRecipeVariant(
      variantName,
      variant as NormalizedRecipeVariant<AnimationRecipeProps, string>,
      ctx,
    );
  },
  buildStructural(rawSlice): StructuralOutput {
    return {
      ruleSetGroups: {},
      configProperties: {},
      keyframes: buildKeyframes((rawSlice as { keyframes?: unknown }).keyframes),
    };
  },
};

export type { AnimationRaw } from "./types";
