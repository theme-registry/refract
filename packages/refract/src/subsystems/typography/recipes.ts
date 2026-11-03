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
import { RefractError } from "../../core/errors";
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
  const path = `${ctx.groupPath}.${variantName}`;
  const base = interpretProps(variant.base, ctx, path);

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
    const overrides = interpretProps(rawDecls as TypographyRecipeProps, ctx, `${path}.responsive`);

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

/**
 * Interpret a flat declaration block → `cssProperty → { ref }`, skipping empty values. Fails loud on
 * anything it can't lower — a key outside {@link PROPERTY_CSS_MAP} (incl. a `css` block, which
 * typography recipes don't take), a non-string value, or a value naming no variant of the property —
 * instead of dropping it or emitting a `var()` to a token that doesn't exist.
 */
const interpretProps = (
  props: TypographyRecipeProps | undefined,
  ctx: RecipeInterpretContext,
  path: string,
): Record<string, Ref> => {
  const declarations: Record<string, Ref> = {};
  if (!props) return declarations;

  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === "" || RESERVED_KEYS.has(key)) continue;
    const cssProperty = PROPERTY_CSS_MAP[key];
    if (!cssProperty) {
      throw new RefractError(
        "REFRACT_E_RECIPE_PROPERTY",
        `Unknown typography recipe property "${key}" in ${path} — expected one of ` +
          `${Object.keys(PROPERTY_CSS_MAP).join(", ")} or a reserved key ` +
          `(variant, target, state, breakpoint, query, orientation, container, size).` +
          (key === "css" ? ` Typography recipes take no "css" block; put literal CSS in a components recipe.` : ""),
      );
    }
    if (typeof value !== "string") {
      throw new RefractError(
        "REFRACT_E_VARIANT_REF",
        `Typography recipe ${path}.${key} must name a variant of typography.${key} (or "base"); got ${JSON.stringify(value)}.`,
      );
    }
    assertVariantExists(key, value, ctx, path);
    declarations[cssProperty] = { ref: variantPath(key, value) };
  }

  return declarations;
};

/** Throw unless `typography.<key>` exists and, for a non-`"base"` value, has that variant. */
const assertVariantExists = (key: string, value: string, ctx: RecipeInterpretContext, path: string): void => {
  const property = ctx.properties[key] as { variants?: Record<string, unknown> } | undefined;
  if (!property) {
    throw new RefractError(
      "REFRACT_E_VARIANT_REF",
      `Typography recipe ${path}.${key} references typography.${key}, which the theme doesn't define.`,
    );
  }
  if (value === "base" || property.variants?.[value]) return;
  const known = Object.keys(property.variants ?? {});
  throw new RefractError(
    "REFRACT_E_VARIANT_REF",
    `Typography recipe ${path}.${key} names "${value}", which is not a variant of typography.${key} ` +
      `(known: base${known.length ? ", " + known.join(", ") : ""}).`,
  );
};

/** The token path for a property variant: `typography.<key>` for `"base"`, else `typography.<key>.<variant>`. */
const variantPath = (propertyKey: string, variant: string): string =>
  variant === "base" ? `typography.${propertyKey}` : `typography.${propertyKey}.${variant}`;
