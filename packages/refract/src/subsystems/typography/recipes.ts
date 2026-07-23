/**
 * Typography's `interpretRecipe` hook â resolves recipe declarations to token-path Refs.
 *
 * A typography recipe prop value names a **variant** of the matching property (`fontSize:
 * "3xl"`, `fontWeight: "bold"`), or the base value (`fontSize: "base"`). This interpreter
 * emits a format-neutral {@link Ref} carrying the canonical token path â `typography.fontSize.3xl`
 * for a variant, `typography.fontSize` for the base. It emits refs **directly** (no `var(--â¦)`
 * strings); the CSS adapter maps each path to a `var(--â¦)` at render time, so `theme.model`
 * carries no CSS syntax. Ported + reshaped from the old `subsystems/typography/recipes.ts`
 * (which produced `var(--â¦)` strings via a prefix resolver).
 */
import type { InterpretedRecipeVariant, InterpretedRecipeOverride, Ref } from "../../core/model";
import type { NormalizedRecipeVariant } from "../../core/normalize";
import type { RecipeInterpretContext } from "../../core/subsystem";
import type { TypographyRecipeProps } from "./types";

const RESERVED_KEYS: ReadonlySet<string> = new Set([
  "breakpoint",
  "query",
  "state",
  "variant",
  "target",
  "orientation",
]);

/** Recipe prop key â CSS declaration property name. Only these keys are lowered. */
const PROPERTY_CSS_MAP: Record<string, string> = {
  fontFamily: "font-family",
  fontSize: "font-size",
  fontWeight: "font-weight",
  lineHeight: "line-height",
  letterSpacing: "letter-spacing",
  fontStyle: "font-style",
  textTransform: "text-transform",
  textDecoration: "text-decoration",
  textAlign: "text-align",
};

/**
 * Interpret one typography recipe variant into base + responsive/state override declarations,
 * each a token-path {@link Ref}. A responsive `variant:` swap inherits the sibling's base
 * declarations (via `ctx.resolveRecipeVariant`).
 */
export const interpretTypographyRecipeVariant = (
  variantName: string,
  variant: NormalizedRecipeVariant<TypographyRecipeProps, string>,
  ctx: RecipeInterpretContext,
): InterpretedRecipeVariant<string> => {
  const base = interpretProps(variant.base);

  const responsive: InterpretedRecipeOverride<string>[] = variant.responsive.map(entry => {
    const { breakpoint, query, state, variant: swap, target, orientation, container, size, ...rawDecls } =
      entry as TypographyRecipeProps & {
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
    const overrides = interpretProps(rawDecls as TypographyRecipeProps);

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

/** Interpret a flat declaration block â `cssProperty â { ref }`, skipping empty / unknown keys. */
const interpretProps = (props: TypographyRecipeProps | undefined): Record<string, Ref> => {
  const declarations: Record<string, Ref> = {};
  if (!props) return declarations;

  for (const [key, value] of Object.entries(props)) {
    if (!value || RESERVED_KEYS.has(key)) continue;
    const cssProperty = PROPERTY_CSS_MAP[key];
    if (!cssProperty) continue;
    declarations[cssProperty] = { ref: variantPath(key, value) };
  }

  return declarations;
};

/** The token path for a property variant: `typography.<key>` for `"base"`, else `typography.<key>.<variant>`. */
const variantPath = (propertyKey: string, variant: string): string =>
  variant === "base" ? `typography.${propertyKey}` : `typography.${propertyKey}.${variant}`;
