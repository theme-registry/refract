/**
 * Components' `interpretRecipe` hook — the composition interpreter.
 *
 * A component variant carries cross-subsystem references (`colors: "solid.primary"`) that are
 * NOT declarations (they're extracted separately as Model `references` pointers) plus an own
 * `css` delta. This interpreter emits ONLY the own-delta declarations, each a format-neutral
 * {@link Ref}. The delta is **literal-first**: a bare string / number value is a raw CSS literal
 * → `{ value }`; a `ref("…")` / `{ ref: "…" }` marker is a token path → `{ ref }` (the adapter lowers
 * it to `var(--…)` against the global token union). The
 * referenced recipes' own states ride along on their shared classes (via the `references`
 * pointers), so the component only emits its own delta + own states — which win at equal
 * specificity by later source order.
 */
import type { InterpretedRecipeVariant, InterpretedRecipeOverride, Ref } from "../../core/model";
import type { NormalizedRecipeVariant } from "../../core/normalize";
import type { RecipeInterpretContext } from "../../core/subsystem";
import type { ComponentsRecipeProps, CssDeltaValue } from "./types";

/**
 * Interpret one component variant into base + state/responsive override declarations from its
 * `css` delta. Cross-subsystem references are handled by `extractComponentReferences`, not here.
 */
export const interpretComponentsRecipeVariant = (
  _variantName: string,
  variant: NormalizedRecipeVariant<ComponentsRecipeProps, string>,
  _ctx: RecipeInterpretContext,
): InterpretedRecipeVariant<string> => {
  const base = interpretCssDelta((variant.base as ComponentsRecipeProps).css);

  const responsive: InterpretedRecipeOverride<string>[] = variant.responsive.map(entry => {
    const e = entry as ComponentsRecipeProps & {
      breakpoint?: string;
      query?: "min" | "max" | "exact";
      state?: string;
      orientation?: "landscape" | "portrait";
      container?: string;
      size?: string;
      target?: string;
    };
    const override: InterpretedRecipeOverride<string> = {
      declarations: interpretCssDelta(e.css),
    };
    if (e.breakpoint) {
      override.breakpoint = e.breakpoint;
      override.query = e.query ?? "exact";
    }
    if (e.container) {
      override.container = e.container;
      if (e.size) override.size = e.size;
      override.query = e.query ?? "min";
    }
    if (e.state) override.state = e.state;
    if (e.orientation) override.orientation = e.orientation;
    if (e.target) override.target = e.target; // dec.8 — scope onto the `<item>-<target>` sibling
    return override;
  });

  return { base, responsive };
};

/** A component `css` delta (`{ color, boxShadow }`) → `formattedProperty → Ref` (ref-first, §19). */
const interpretCssDelta = (
  css: Record<string, CssDeltaValue> | undefined,
): Record<string, Ref> => {
  const declarations: Record<string, Ref> = {};
  if (!css) return declarations;
  for (const [property, value] of Object.entries(css)) {
    declarations[formatPropertyName(property)] = cssValueToRef(value);
  }
  return declarations;
};

/**
 * One `css` delta value → a {@link Ref} (literal-first): a bare `string` or `number` is a raw literal
 * → `{ value }`; the `{ ref: "…" }` object (produced by the `ref()` helper or authored directly in JSON)
 * is a token path → `{ ref }`, lowered to `var(--…)` by the adapter.
 */
const cssValueToRef = (value: CssDeltaValue): Ref => {
  if (typeof value === "object") return { ref: value.ref };
  return { value };
};

/** Format an authored CSS property name to its declaration name (`boxShadow` → `box-shadow`). */
const formatPropertyName = (property: string): string => {
  if (property.startsWith("--")) return property;
  return property
    .replace(/_/g, "-")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();
};
