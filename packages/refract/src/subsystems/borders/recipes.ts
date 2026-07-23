/**
 * Borders' `interpretRecipe` hook (§14.2) — resolves recipe declarations to token-path Refs.
 *
 * The novel logic vs a fixed prop→css map: the CSS property is **computed** from
 * `(as, side, aspect)`. `as` (the render target, default `"border"`) + the optional per-side
 * modifier route each geometry aspect to its longhand:
 *   - `border` + `left` + `width`  → `border-left-width`
 *   - `outline` + `width`          → `outline-width`
 *   - `border` + `radius`          → `border-radius`   (radius is border-only edge geometry)
 *   - `outline` + `offset`         → `outline-offset`  (offset is outline-only)
 *   - `outline` + `color`          → `outline-color`
 *
 * Geometry aspects (`width`/`style`/`offset`/`radius`) name a **variant** of the matching borders
 * property by bare name — lowered to a `borders.<aspect>[.<variant>]` {@link Ref}. `color` is the
 * value-level exception (§14.4): its value is already a `colors.*` **token** path, passed straight
 * through as `{ ref: "colors.*" }` — the CSS adapter resolves it against the global path→var map
 * (colors is processed first). No `var(--…)` strings — the adapter maps paths to vars at render.
 */
import type { InterpretedRecipeVariant, InterpretedRecipeOverride, Ref } from "../../core/model";
import type { NormalizedRecipeVariant } from "../../core/normalize";
import type { RecipeInterpretContext } from "../../core/subsystem";
import type { BordersRecipeProps } from "./types";

const RESERVED_KEYS: ReadonlySet<string> = new Set([
  "breakpoint",
  "query",
  "state",
  "variant",
  "target",
  "orientation",
  "container",
  "size",
]);

/** The recipe modifiers (not geometry aspects) — stripped before interpreting declarations. */
const MODIFIER_KEYS: ReadonlySet<string> = new Set(["as", "side"]);

/** The geometry aspects a borders recipe can declare (plus the value-level `color`). */
const ASPECT_KEYS: ReadonlySet<string> = new Set(["width", "style", "offset", "radius", "color"]);

type RenderTarget = "border" | "outline";
type Side = "top" | "right" | "bottom" | "left";

/**
 * Compute the CSS declaration property for one aspect from the render target + side (§14.2).
 * `radius` is always `border-radius` (border-only edge geometry); `offset` is always
 * `outline-offset` (outline-only). The rest fan out per `(as, side)`.
 */
const cssPropertyFor = (as: RenderTarget, side: Side | undefined, aspect: string): string => {
  if (aspect === "radius") return "border-radius";
  if (aspect === "offset") return "outline-offset";
  if (as === "outline") return `outline-${aspect}`;
  return side ? `border-${side}-${aspect}` : `border-${aspect}`;
};

/** The token-path Ref for one aspect value: a `colors.*` passthrough for `color`, else a borders variant path. */
const refFor = (aspect: string, value: string): Ref => {
  if (aspect === "color") return { ref: value }; // value is already a `colors.*` token path
  return { ref: value === "base" ? `borders.${aspect}` : `borders.${aspect}.${value}` };
};

/** Interpret a flat declaration block → `cssProperty → Ref`, given the variant's `as`/`side` modifiers. */
const interpretProps = (
  props: BordersRecipeProps | undefined,
  as: RenderTarget,
  side: Side | undefined,
): Record<string, Ref> => {
  const declarations: Record<string, Ref> = {};
  if (!props) return declarations;

  for (const [key, value] of Object.entries(props)) {
    if (!value || RESERVED_KEYS.has(key) || MODIFIER_KEYS.has(key) || !ASPECT_KEYS.has(key)) continue;
    declarations[cssPropertyFor(as, side, key)] = refFor(key, value);
  }

  return declarations;
};

/**
 * Interpret one borders recipe variant into base + responsive/state override declarations, each a
 * token-path {@link Ref}. `as`/`side` are read from the variant base (the render target is a
 * variant-level identity); a responsive entry may override them, else it inherits the base's. A
 * responsive `variant:` swap inherits the sibling's already-interpreted base declarations.
 */
export const interpretBordersRecipeVariant = (
  variantName: string,
  variant: NormalizedRecipeVariant<BordersRecipeProps, string>,
  ctx: RecipeInterpretContext,
): InterpretedRecipeVariant<string> => {
  const baseAs = (variant.base.as as RenderTarget) ?? "border";
  const baseSide = variant.base.side as Side | undefined;
  const base = interpretProps(variant.base, baseAs, baseSide);

  const responsive: InterpretedRecipeOverride<string>[] = variant.responsive.map(entry => {
    const {
      breakpoint,
      query,
      state,
      variant: swap,
      target,
      orientation,
      container,
      size,
      as: entryAs,
      side: entrySide,
      ...rawDecls
    } = entry as BordersRecipeProps & {
      breakpoint?: string;
      query?: "min" | "max" | "exact";
      state?: string;
      variant?: string;
      target?: string;
      orientation?: "landscape" | "portrait";
      container?: string;
      size?: string;
    };

    const as = (entryAs as RenderTarget) ?? baseAs;
    const side = (entrySide as Side | undefined) ?? baseSide;

    const inherited = swap ? { ...ctx.resolveRecipeVariant(swap).base } : {};
    const overrides = interpretProps(rawDecls as BordersRecipeProps, as, side);

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
    if (orientation) override.orientation = orientation;
    if (target) override.target = target; // dec.8 — scope onto the `<item>-<target>` sibling
    return override;
  });

  return { base, responsive };
};
