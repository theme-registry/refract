/**
 * Layout's `interpretRecipe` hook â resolves recipe declarations to token-path Refs.
 *
 * A layout recipe prop names a **spacing variant** (`paddingY: "xl"`, `gap: "relaxed"`),
 * which this interpreter emits as a `layout.spacing.<variant>` token-path {@link Ref}
 * (`layout.spacing` for the base). `background` passes through as a literal. One recipe prop
 * can fan out to several CSS declarations (`paddingY` â `padding-top` + `padding-bottom`).
 * Emits refs **directly** â no `var(--â¦)` strings; the CSS adapter maps each path to a
 * `var(--â¦)` at render time. Ported + reshaped from the old `subsystems/layout/recipes.ts`.
 */
import type { InterpretedRecipeVariant, InterpretedRecipeOverride, Ref } from "../../core/model";
import type { NormalizedRecipeVariant } from "../../core/normalize";
import type { RecipeInterpretContext } from "../../core/subsystem";
import type { LayoutRecipeProps } from "./types";
import { RefractError } from "../../core/errors";

const RESERVED_KEYS: ReadonlySet<string> = new Set([
  "breakpoint",
  "query",
  "state",
  "variant",
  "target",
  "orientation",
]);

/** Recipe verb â the CSS declaration property names it expands to. Spacing verbs fan out (Y â top+bottom);
 *  sizing verbs (Â§22) are 1:1 with their longhand; `background` is the one literal verb. */
const PROPERTY_CSS_MAP: Record<string, string[]> = {
  paddingY: ["padding-top", "padding-bottom"],
  paddingX: ["padding-left", "padding-right"],
  marginY: ["margin-top", "margin-bottom"],
  marginX: ["margin-left", "margin-right"],
  gap: ["gap"],
  background: ["background"],
  // Â§22 sizing verbs â resolve against `layout.sizes`, one longhand each.
  width: ["width"],
  minWidth: ["min-width"],
  maxWidth: ["max-width"],
  height: ["height"],
  minHeight: ["min-height"],
  maxHeight: ["max-height"],
};

/**
 * Which themed scale a verb's value names (Â§22 governing principle: a verb exists because it consumes a
 * themed scale). Spacing verbs â `layout.spacing`, sizing verbs â `layout.sizes`; `background` is the one
 * `"literal"` verb (a raw CSS value, no scale).
 */
const PROPERTY_DOMAIN: Record<string, "spacing" | "sizes" | "literal"> = {
  paddingY: "spacing", paddingX: "spacing", marginY: "spacing", marginX: "spacing", gap: "spacing",
  width: "sizes", minWidth: "sizes", maxWidth: "sizes", height: "sizes", minHeight: "sizes", maxHeight: "sizes",
  background: "literal",
};

/** A `layout.<domain>` token path for a variant: the base token for `"base"`, else `.<variant>`. */
const tokenPath = (domain: "spacing" | "sizes", variant: string): string =>
  variant === "base" ? `layout.${domain}` : `layout.${domain}.${variant}`;

/**
 * Interpret one flat declaration block â `cssProperty â Ref`. Each verb resolves against its themed
 * scale ({@link PROPERTY_DOMAIN}); `background` stays a literal. An **unknown** verb throws (Â§22 D5) â
 * the map used to silently drop it, so a typo (`pading`) or an unsupported property vanished with no error.
 */
const interpretProps = (props: LayoutRecipeProps | undefined, label: string): Record<string, Ref> => {
  const declarations: Record<string, Ref> = {};
  if (!props) return declarations;

  for (const [key, value] of Object.entries(props)) {
    if (RESERVED_KEYS.has(key)) continue;
    if (!value) continue;
    const cssProperties = PROPERTY_CSS_MAP[key];
    if (!cssProperties) {
      throw new RefractError(
        "REFRACT_E_LAYOUT",
        `Unknown layout recipe property "${key}" in ${label}. Known verbs: ` +
          `${Object.keys(PROPERTY_CSS_MAP).join(", ")}. For arbitrary CSS use a component \`css\` delta.`,
      );
    }
    const domain = PROPERTY_DOMAIN[key];
    for (const cssProperty of cssProperties) {
      declarations[cssProperty] = domain === "literal" ? { value } : { ref: tokenPath(domain, value) };
    }
  }

  return declarations;
};

/** Interpret one layout recipe variant into base + responsive/state override declarations. */
export const interpretLayoutRecipeVariant = (
  variantName: string,
  variant: NormalizedRecipeVariant<LayoutRecipeProps, string>,
  ctx: RecipeInterpretContext,
): InterpretedRecipeVariant<string> => {
  const label = `${ctx.groupPath ?? "layout.recipes"}.${variantName}`;
  const base = interpretProps(variant.base, label);

  const responsive: InterpretedRecipeOverride<string>[] = variant.responsive.map(entry => {
    const { breakpoint, query, state, variant: swap, target, orientation, container, size, ...rawDecls } =
      entry as LayoutRecipeProps & {
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
    const overrides = interpretProps(rawDecls as LayoutRecipeProps, label);

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
