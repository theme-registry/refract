/**
 * Effects' `interpretRecipe` hook â resolves recipe declarations to token-path Refs.
 *
 * An effects recipe prop names a **variant** of the matching property, but the recipe key
 * differs from the token key (`boxShadow` â `shadow`, `transition` â `transitions`) â the
 * resolve-key map bridges them. Each declaration lowers to a format-neutral {@link Ref}
 * carrying the canonical token path (`effects.shadow.lg`, `effects.shadow` for the base) â
 * **no `var(--â¦)` strings**; the CSS adapter maps the path to a `var(--â¦)` at render time.
 *
 * The `blur` compound is the notable reshape: the old `effects/recipes.ts` baked
 * `filter: blur(var(--â¦))` as a `{ value }` literal that **embedded** `var()` â not format-
 * neutral. Here it emits `{ ref: "effects.blur", wrap: "blur" }`; the adapter's `refToStyleValue`
 * renders `ref.wrap` â `blur(var(--â¦))`, so the wrap lives in the adapter, not the Model.
 */
import type { InterpretedRecipeVariant, InterpretedRecipeOverride, Ref } from "../../core/model";
import type { NormalizedRecipeVariant } from "../../core/normalize";
import type { RecipeInterpretContext } from "../../core/subsystem";
import type { EffectsRecipeProps } from "./types";

const RESERVED_KEYS: ReadonlySet<string> = new Set([
  "breakpoint",
  "query",
  "state",
  "variant",
  "target",
  "orientation",
]);

/** Recipe prop key â CSS declaration property name. `blur` â `filter` (rendered via a wrap). */
const PROPERTY_CSS_MAP: Record<string, string> = {
  boxShadow: "box-shadow",
  opacity: "opacity",
  blur: "filter",
  transition: "transition",
  zIndex: "z-index",
};

/** Recipe prop key â the effects **property name** (token key) it references. */
const RESOLVE_KEY_MAP: Record<string, string> = {
  boxShadow: "shadow",
  opacity: "opacity",
  blur: "blur",
  transition: "transitions",
  zIndex: "zIndex",
};

/**
 * Interpret one effects recipe variant into base + responsive/state override declarations,
 * each a token-path {@link Ref}. A responsive `variant:` swap inherits the sibling's base
 * declarations (via `ctx.resolveRecipeVariant`).
 */
export const interpretEffectsRecipeVariant = (
  variantName: string,
  variant: NormalizedRecipeVariant<EffectsRecipeProps, string>,
  ctx: RecipeInterpretContext,
): InterpretedRecipeVariant<string> => {
  const base = interpretProps(variant.base);

  const responsive: InterpretedRecipeOverride<string>[] = variant.responsive.map(entry => {
    const { breakpoint, query, state, variant: swap, target, orientation, container, size, ...rawDecls } =
      entry as EffectsRecipeProps & {
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
    const overrides = interpretProps(rawDecls as EffectsRecipeProps);

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

/** Interpret a flat declaration block â `cssProperty â Ref`, skipping empty / unknown keys. */
const interpretProps = (props: EffectsRecipeProps | undefined): Record<string, Ref> => {
  const declarations: Record<string, Ref> = {};
  if (!props) return declarations;

  for (const [key, value] of Object.entries(props)) {
    if (!value || RESERVED_KEYS.has(key)) continue;
    const cssProperty = PROPERTY_CSS_MAP[key];
    const propertyName = RESOLVE_KEY_MAP[key];
    if (!cssProperty || !propertyName) continue;

    const ref: Ref = { ref: variantPath(propertyName, value) };
    // The `blur` compound renders as `filter: blur(var(--â¦))` â carried as an adapter wrap,
    // never an embedded `var()` literal (the format-neutrality constraint).
    if (key === "blur") ref.wrap = "blur";
    declarations[cssProperty] = ref;
  }

  return declarations;
};

/** The token path for a property variant: `effects.<name>` for `"base"`, else `effects.<name>.<variant>`. */
const variantPath = (propertyName: string, variant: string): string =>
  variant === "base" ? `effects.${propertyName}` : `effects.${propertyName}.${variant}`;
