/**
 * The styled-components adapter (§8) — lowers the format-neutral {@link ThemeModel} to **TS/JS
 * modules**, not a stylesheet. Worked reference: `src/adapters/css/`; imports only core (+ the
 * `styled-components` peer) so it can be lifted to its own package (Step 11).
 *
 * One renderer, two sinks (see `./recipe`): the same recipe lowering feeds `emit()` (serialize to
 * `css\`…\`` source on disk) and the runtime surface (`createTheme(raw, { adapter })` → a live `css`
 * block per recipe, lowered on first access and cached). Both project the SAME shapes:
 *
 *  - **theme** — a literal object (`theme.colors.primary`, `theme.modes.dark.…`, `theme.media`,
 *    `theme.scheme`, opted-in color-math fns). No `var()`; the object IS the indirection. This is
 *    what a consumer passes to `<ThemeProvider>`.
 *  - **recipes** — flat, tree-shakeable `css` blocks reading values off the theme (`${({ theme }) =>
 *    theme.…}`); composition = a `css` spread of the referenced siblings. Grouped `recipes` barrel too.
 *  - **GlobalStyle** — the globals subsystem as a `createGlobalStyle` (present iff the raw defines `globals`).
 *  - **media** / **scheme** — SC tagged templates (breakpoints / `prefers-color-scheme`).
 */
import type { RuleSet as ModelRuleSet, ThemeModel } from "@theme-registry/refract";
import type { AdapterSpec, RenderContext, ThemeAdapter, NormalizedEmit, EmitOutput } from "@theme-registry/refract";
import type { PreviewDescriptor, UsageDescriptor } from "@theme-registry/refract";
import type { MediaDescriptor } from "@theme-registry/refract";
import { defineAdapter } from "@theme-registry/refract";
import { css, createGlobalStyle } from "styled-components";
import type { RuleSet } from "styled-components";
import type { NamingOverrides } from "@theme-registry/refract/adapter-kit";
import { SC_KNOWN_STATES } from "./lowering";
import { createIdentifiers } from "./identifiers";
import { buildThemeData, buildRuntimeThemeObject, serializeThemeObject } from "./theme-object";
import {
  buildRecipeIR,
  buildGlobalsIR,
  recipeSource,
  recipePlainCss,
  type RecipeContext,
  type SchemeOption,
  type SpreadRenderer,
} from "./recipe";
import { wrapMediaDescriptor } from "./media";
import { wrapSchemeHelper, vendorSchemeHelper, mediaEligibleModes, PREFERS } from "./scheme";
import { vendorMediaHelper, buildScEmit, COLOR_MATH_ATTACH, type RecipeEmit, type ScEmitInputs } from "./emit";

/** The output unit for this adapter — the return of the styled-components `css` tagged template. */
export type StyledComponentsUnit = RuleSet<object>;

/** styled-components adapter options (§8). */
export type StyledComponentsAdapterOptions = {
  /**
   * Emit `.ts` (default) or `.js` modules. `ts` additionally emits `theme.d.ts` augmenting
   * styled-components' `DefaultTheme` from `typeof theme`, so `props.theme.…` is typed.
   */
  language?: "ts" | "js";
  /**
   * How appearance modes (§10.3) are realized in recipes: `"media"` (default) →
   * `@media (prefers-color-scheme: dark)` (follows the OS); `"attribute"` → `[data-theme="dark"] &`
   * (a manual toggle overrides the OS); `"both"` → both blocks.
   */
  scheme?: SchemeOption;
  /**
   * Shared vendorable helpers surfaced on `theme` — `["color-math"]` wires the `lighten`/`darken`/`alpha`
   * import (the module itself is materialized by the build plumbing, `emitTheme` + `VENDOR_HELPERS`).
   */
  helpers?: readonly string[];
  /** Accepted for parity with the CSS adapter's namer. SC identifiers carry no prefix (the literal
   *  theme object is the isolation boundary), so these do not alter identifiers in v1. */
  prefix?: string;
  classPrefix?: string;
  /**
   * §7B — swap how names are generated (shared type with the CSS adapter). `className` remaps a
   * recipe's export identity (camelCased); `variableName` has no coherent target on the nested theme
   * object and is accepted-but-structural (theme keys stay derived from the token address).
   */
  naming?: NamingOverrides;
};

const isValidIdentifier = (name: string): boolean => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
const objectKey = (name: string): string => (isValidIdentifier(name) ? name : JSON.stringify(name));

/** Memoize an object property: build the value on first access, then replace the getter with it. */
const lazy = (obj: Record<string, unknown>, key: string, compute: () => unknown): void => {
  Object.defineProperty(obj, key, {
    configurable: true,
    enumerable: true,
    get() {
      const value = compute();
      Object.defineProperty(obj, key, { value, enumerable: true, configurable: true });
      return value;
    },
  });
};

export const createStyledComponentsAdapter = (
  options: StyledComponentsAdapterOptions = {},
): ThemeAdapter<StyledComponentsUnit> => {
  const language = options.language ?? "ts";
  const scheme: SchemeOption = options.scheme ?? "media";
  const helpers = options.helpers ?? [];

  const spec: AdapterSpec<StyledComponentsUnit> = {
    name: "styled-components",
    version: 1,
    allowedStates: SC_KNOWN_STATES,
    bind(model: ThemeModel, ctx: RenderContext) {
      const media = ctx.media as MediaDescriptor<string>;
      const ids = createIdentifiers(options.naming);

      // The literal theme object data (tokens + modes) — the shared source for both sinks.
      const data = buildThemeData(model, ctx.resolve);
      const recipeCtx: RecipeContext = { model, media, data, scheme, prefers: PREFERS };

      // Do any recipes reference `theme.scheme`? (Only dark/light under media/both do.)
      const usesScheme = (scheme === "media" || scheme === "both") && mediaEligibleModes(data.modeNames).length > 0;

      // ── Recipe IR registry (every rule-set except globals), addressed by "subsystem.group.variant". ──
      const addressKey = (subsystem: string, group: string, variant: string): string =>
        `${subsystem}.${group}.${variant}`;
      const registry = new Map<string, ReturnType<typeof buildRecipeIR>>();
      const recipeAddresses: Array<{ subsystem: string; group: string; variant: string }> = [];
      for (const [subsystem, sub] of Object.entries(model.subsystems)) {
        if (subsystem === "globals") continue;
        for (const [group, ruleSetGroup] of Object.entries(sub.ruleSets ?? {})) {
          for (const [variant, ruleSet] of Object.entries(ruleSetGroup)) {
            registry.set(addressKey(subsystem, group, variant), buildRecipeIR(ruleSet, recipeCtx));
            recipeAddresses.push({ subsystem, group, variant });
          }
        }
      }

      const ruleSetOf = (subsystem: string, group: string, variant: string): ModelRuleSet | undefined =>
        model.subsystems[subsystem]?.ruleSets?.[group]?.[variant];

      // ── Runtime sinks ──
      // Composition spreads inline the referenced recipe's live CSS (recursively).
      const spreadRenderer: SpreadRenderer = (subsystem, group, variant, theme) => {
        const nodes = registry.get(addressKey(subsystem, group, variant));
        return nodes ? recipePlainCss(nodes, theme, recipeCtx, spreadRenderer) : "";
      };

      const buildLiveRecipe = (subsystem: string, group: string, variant: string): RuleSet<object> => {
        const nodes = registry.get(addressKey(subsystem, group, variant)) ?? [];
        return css`${({ theme }: { theme: Record<string, any> }) => recipePlainCss(nodes, theme, recipeCtx, spreadRenderer)}`;
      };

      const wrappedMedia = wrapMediaDescriptor(media);
      const wrappedScheme = usesScheme ? wrapSchemeHelper(data.modeNames) : undefined;

      // The live theme object put on `theme` (recipes read it from styled-components context).
      const attach: Record<string, unknown> = { media: wrappedMedia };
      if (wrappedScheme) attach.scheme = wrappedScheme;
      const runtimeTheme = buildRuntimeThemeObject(data, attach);

      // Lazy + cached `recipes.<subsystem>.<group>.<variant>` — each lowered on first access.
      const buildRecipesTree = (): Record<string, unknown> => {
        const tree: Record<string, unknown> = {};
        for (const { subsystem, group, variant } of recipeAddresses) {
          const groups = (tree[subsystem] ??= {}) as Record<string, Record<string, unknown>>;
          const variants = (groups[group] ??= {});
          lazy(variants, variant, () => buildLiveRecipe(subsystem, group, variant));
        }
        return tree;
      };

      // Globals → a live GlobalStyle (present iff the raw defines the globals subsystem).
      const resetNodes = buildGlobalsIR(model.subsystems.globals?.ruleSets, recipeCtx);
      const GlobalStyle = resetNodes.length
        ? createGlobalStyle`${({ theme }: { theme: Record<string, any> }) => recipePlainCss(resetNodes, theme, recipeCtx, spreadRenderer)}`
        : undefined;

      // ── Emit sink ──
      const emit = (plan?: NormalizedEmit): EmitOutput => {
        const type = plan?.type ?? "single";
        if (type !== "single" && type !== "split") {
          throw new Error(
            `styled-components adapter: emit mode '${type}' is not supported — the TS/JS target ` +
              `emits 'single' or 'split' (ES modules tree-shake per export; 'subsystem'/'components' ` +
              `are CSS-only concerns).`,
          );
        }

        const spreadName = (subsystem: string, group: string, variant: string): string =>
          ids.recipeExportName(subsystem, group, variant);

        // Recipes in dependency-safe order (a composed component's references precede it in the list).
        const recipes: RecipeEmit[] = recipeAddresses.map(({ subsystem, group, variant }) => ({
          exportName: ids.recipeExportName(subsystem, group, variant),
          body: recipeSource(registry.get(addressKey(subsystem, group, variant)) ?? [], { spreadName }),
        }));

        // Grouped barrel referencing the flat consts.
        const barrelLines: string[] = ["{"];
        const bySubsystem = new Map<string, Array<{ group: string; variant: string }>>();
        for (const addr of recipeAddresses) {
          (bySubsystem.get(addr.subsystem) ?? bySubsystem.set(addr.subsystem, []).get(addr.subsystem)!).push(addr);
        }
        for (const [subsystem, addrs] of bySubsystem) {
          barrelLines.push(`  ${subsystem}: {`);
          const byGroup = new Map<string, string[]>();
          for (const { group, variant } of addrs) {
            (byGroup.get(group) ?? byGroup.set(group, []).get(group)!).push(variant);
          }
          for (const [group, variants] of byGroup) {
            barrelLines.push(`    ${objectKey(group)}: {`);
            for (const variant of variants) {
              barrelLines.push(`      ${objectKey(variant)}: ${ids.recipeExportName(subsystem, group, variant)},`);
            }
            barrelLines.push(`    },`);
          }
          barrelLines.push(`  },`);
        }
        barrelLines.push("}");

        const trailingRefs = [
          "media",
          ...(usesScheme ? ["scheme"] : []),
          ...(helpers.includes("color-math") ? COLOR_MATH_ATTACH : []),
        ];

        const inputs: ScEmitInputs = {
          language,
          emitMode: type,
          helpers,
          usesScheme,
          themeObjectBody: serializeThemeObject(data, trailingRefs),
          recipes,
          recipesBarrelBody: barrelLines.join("\n"),
          resetBody: resetNodes.length ? recipeSource(resetNodes, { spreadName }) : undefined,
          vendorMedia: vendorMediaHelper(model.breakpoints, media),
          vendorScheme: usesScheme ? vendorSchemeHelper(data.modeNames) : undefined,
        };
        return buildScEmit(inputs);
      };

      return {
        recipeName(subsystem, group, variant) {
          return ids.recipeExportName(subsystem, group, variant);
        },

        // Preview (§20): the output is JS modules that need React + styled-components to render, so
        // there is no stylesheet to load. Token plates still work; for a live design-review page add a
        // CSS target to the same config — same recipes through the same core IR, so it's faithful.
        describePreview(): PreviewDescriptor {
          return {
            stylesheets: [],
            unavailable:
              "This target emits JavaScript modules that render through React + styled-components, " +
              "so there is no stylesheet a browser can load. Token values below are exact. For a live " +
              "render, add a CSS target to the same config — it compiles the same recipes.",
          };
        },

        // Self-documentation: the REAL export identifiers (the tree-shakeable `css` consts) plus
        // SC-specific wiring prose for the emitted guide (llms.txt).
        describeUsage(): UsageDescriptor {
          return {
            format: "styled-components",
            summary: [
              "This theme is emitted as TypeScript/JavaScript modules: a literal `theme` object plus tree-shakeable `css` recipe exports (and a `GlobalStyle` if the theme defines globals).",
              'Wrap your app once in styled-components\' `ThemeProvider` with the exported `theme`: `import { theme } from "./theme";` then `<ThemeProvider theme={theme}>`.',
              "Apply a recipe by spreading its `css` export into a styled component: ``styled.button`${componentsButtonsPrimary}` ``. Recipes read their values from `props.theme`, so there is no `var()` and no separate stylesheet.",
              "If the theme defines globals, render `<GlobalStyle />` once inside the provider.",
            ],
            recipes: recipeAddresses.map(({ subsystem, group, variant }) => ({
              subsystem,
              group,
              variant,
              name: ids.recipeExportName(subsystem, group, variant),
            })),
          };
        },
        renderRecipe(subsystem, group, variant) {
          return ruleSetOf(subsystem, group, variant)
            ? buildLiveRecipe(subsystem, group, variant)
            : css``;
        },
        // The SC target has no CSS variables (the theme object is the indirection).
        renderVariables() {
          return css``;
        },
        join(parts) {
          return parts.flat() as RuleSet<object>;
        },

        // The runtime surface: the literal theme object + lazy recipes + GlobalStyle + media/scheme.
        extend() {
          const surface: Record<string, unknown> = {
            theme: runtimeTheme,
            recipes: buildRecipesTree(),
            media: wrappedMedia,
          };
          if (wrappedScheme) surface.scheme = wrappedScheme;
          if (GlobalStyle) surface.GlobalStyle = GlobalStyle;
          return surface;
        },

        emit,
      };
    },
  };
  return defineAdapter(spec);
};

// Public glue re-exports.
export { wrapMediaDescriptor } from "./media";
export type {
  WrappedMediaDescriptor,
  WrappedMediaGroup,
  MediaTemplateWithQuery,
} from "./media";
export type { SchemeHelper, SchemeTemplateWithQuery } from "./scheme";
