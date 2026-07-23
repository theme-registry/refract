/**
 * Colors' `interpretRecipe` hook — resolves palette recipe declarations to Refs.
 *
 * A palette recipe prop value either **names a palette reference** (`"primary"`,
 * `"primary.text"`, `"neutral.light"`) or is a literal. This interpreter emits a
 * format-neutral {@link Ref} for each declaration — a **canonical token path**
 * (`{ ref: "colors.primary", value: "#4dabf7" }`) for a reference, or `{ value }` for a
 * literal. It emits refs **directly** (no `var(--…)` strings); the CSS adapter maps the
 * token path to a `var(--…)` at render time. So `theme.model` carries no CSS syntax.
 */
import type { InterpretedRecipeVariant, InterpretedRecipeOverride, Ref } from "../../core/model";
import type { NormalizedRecipeVariant } from "../../core/normalize";
import type { RecipeInterpretContext } from "../../core/subsystem";
import { RefractError } from "../../core/errors";
import { isKnownCssProperty } from "../../core/cssProperties";
import type { NormalizedPaletteValue, PaletteRecipeProps, PaletteRecipeValue } from "./types";

const RESERVED_RECIPE_KEYS: ReadonlySet<string> = new Set([
  "breakpoint",
  "query",
  "state",
  "variant",
  "target",
  "orientation",
]);

/**
 * Interpret one palette recipe variant into base + responsive/state override declarations,
 * each a token-path {@link Ref}. Sibling `variant:` swaps inherit the sibling's base
 * declarations (via `ctx.resolveRecipeVariant`); a `target` may only scope to the variant
 * itself.
 */
export const interpretPaletteRecipeVariant = (
  variantName: string,
  variant: NormalizedRecipeVariant<PaletteRecipeProps, string>,
  ctx: RecipeInterpretContext,
): InterpretedRecipeVariant<string> => {
  const path = `${ctx.groupPath}.${variantName}`;

  const base = interpretProps(variant.base, ctx, path);

  const responsive: InterpretedRecipeOverride<string>[] = variant.responsive.map(entry => {
    const { breakpoint, query, state, variant: swap, target, orientation, container, size, ...rawDecls } =
      entry as PaletteRecipeProps & {
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
    const overrides = interpretProps(rawDecls as PaletteRecipeProps, ctx, `${path}.responsive`);

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
    if (target) override.target = target; // dec.8 — scope this override onto the `<item>-<target>` sibling
    return override;
  });

  return { base, responsive };
};

/** Interpret a flat declaration block → `formattedProperty → Ref`, skipping empty resolves. */
const interpretProps = (
  props: PaletteRecipeProps | undefined,
  ctx: RecipeInterpretContext,
  path: string,
): Record<string, Ref> => {
  const declarations: Record<string, Ref> = {};
  if (!props) return declarations;

  for (const [property, value] of Object.entries(props)) {
    if (value === undefined || RESERVED_RECIPE_KEYS.has(property)) continue;
    // Fail loud on a key that is neither a reserved recipe key nor a real CSS property — otherwise a
    // typo (`ref:` meant as a `variant:` swap, `colr:` for `color`) would pass through as literal CSS
    // and ship silently. See {@link isKnownCssProperty}.
    if (!isKnownCssProperty(property)) {
      throw new RefractError(
        "REFRACT_E_RECIPE_PROPERTY",
        `Unknown recipe property "${property}" in ${path} — expected a CSS property or a reserved key ` +
          `(variant, target, state, breakpoint, query, orientation, container, size).`,
      );
    }
    const ref = resolvePaletteReference(value, ctx, path, property);
    if (ref === undefined) continue;
    declarations[formatPropertyName(property)] = ref;
  }

  return declarations;
};

/**
 * Resolve one palette recipe value to a {@link Ref}. Numbers + non-palette strings pass
 * through as literals; a `<name>[.<variant|text>]` reference resolves to a canonical token
 * path with its baked value alongside (for inline delivery). Throws on an unknown variant.
 */
const resolvePaletteReference = (
  value: PaletteRecipeValue,
  ctx: RecipeInterpretContext,
  path: string,
  property: string,
): Ref | undefined => {
  if (typeof value === "number") return { value };

  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const segments = trimmed.split(".");
  const name = segments[0];
  const palette = ctx.properties[name] as NormalizedPaletteValue | undefined;

  // Not a known palette colour → a literal declaration (passes through unchanged).
  if (!palette) return { value: trimmed };

  const subKey = segments.length > 1 ? segments.slice(1).join(".") : undefined;

  if (!subKey) return { ref: `colors.${name}` };

  if (subKey === "text") {
    return { ref: `colors.${name}.text` };
  }

  if (!palette.variants?.[subKey]) {
    throw new RefractError(
      "REFRACT_E_VARIANT_REF",
      `Unknown palette variant reference "${name}.${subKey}" in ${path}.${property}.`,
    );
  }

  return { ref: `colors.${name}.${subKey}` };
};

/** Format an authored property name to its CSS declaration name (`borderColor` → `border-color`). */
const formatPropertyName = (property: string): string => {
  if (property.startsWith("--")) return property;
  return property
    .replace(/_/g, "-")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();
};
