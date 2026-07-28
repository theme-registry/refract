/**
 * The CSS adapter — lowers the format-neutral {@link ThemeModel} to CSS.
 *
 * `bind(model, ctx)` curries the Model + context once, precomputes the per-subsystem
 * `CssNode[]` lowering (variables + recipe rules + class minting), and returns the render
 * surface (`recipeName` / `renderRecipe` / `renderVariables` / `join`) plus the aggregate
 * outputs the theme surfaces (`css` / `variablesCss` / `recipesCss` / `nodes` / `classes`)
 * via `extend`. Core stays CSS-independent; all naming, the node IR, state selectors, and
 * class minting live here.
 */
import type { ThemeModel } from "@theme-registry/refract";
import { mergeComponentRuleSet } from "@theme-registry/refract";
import { toHexColor, toOklchColor } from "@theme-registry/refract/color-math";
import type { AdapterSpec, PreviewDescriptor, RenderContext, ThemeAdapter, UsageRecipe } from "@theme-registry/refract";
import { defineAdapter } from "@theme-registry/refract";
import type { CssDeclaration, CssNode, CssRuleNode, CssVariablesNode } from "./nodes";
import {
  deriveColorsVariableNodes,
  buildColorsPathToVar,
  deriveTypographyVariableNodes,
  buildTypographyPathToVar,
  deriveEffectsVariableNodes,
  buildEffectsPathToVar,
  deriveBordersVariableNodes,
  buildBordersPathToVar,
  deriveAnimationVariableNodes,
  buildAnimationPathToVar,
  deriveLayoutVariableNodes,
  deriveLayoutConfigVariableNodes,
  buildLayoutPathToVar,
  splitLayoutProperties,
  lowerRecipeGroup,
  lowerContainerGroup,
  lowerMergedRuleSet,
  lowerGlobalsGroups,
  lowerKeyframes,
  lowerAnimationRecipeGroup,
  deriveContainerContextNodes,
  CSS_KNOWN_STATES,
  CSS_STATE_SELECTORS,
} from "./lowering";
import { resolveNaming, createNamer } from "./naming";
import type { NamingOverrides } from "./naming";
import {
  renderToCssString,
  renderVariablesCss,
  renderRulesCss,
  enrichDeclarationsWithRefs,
  buildVariableValueMap,
} from "./render";

/** CSS adapter options — two naming knobs (variables + classes) + value/delivery knobs (§18). */
export type CssAdapterOptions = {
  /**
   * Identifier prefix for every CSS **variable** name (`--<prefix>-colors-primary`). Default `dt`.
   * Subsystems are namespaced by the token path, not by separate options. For MFE isolation (two
   * bundles on one page), give each build a distinct `prefix` — that renames its variables without
   * touching another bundle's.
   */
  prefix?: string;
  /**
   * Class-name prefix for every **class** the adapter emits — recipe classes
   * (`.<classPrefix>-colors-solid-primary`) AND the container-query context classes
   * (`.<classPrefix>-cq-<name>`). Defaults to `prefix`.
   */
  classPrefix?: string;
  /** Inline resolved values instead of `var(--…)` references (drops the variable blocks). */
  inline?: boolean;
  /**
   * Output format for **palette colour** values in the emitted CSS (§20) — the `:root` colour
   * variables (base / `text` / variants / responsive / modes). `"rgb"` (default) emits
   * `rgb()`/`rgba()`; `"hex"` emits `#rrggbb`/`#rrggbbaa`; `"oklch"` emits CSS Color 4
   * `oklch(L% C H)`. The colour is identical — this is presentation only. Colours typed literally
   * into a recipe declaration pass through as authored; this applies to the synthesized tokens.
   */
  colorFormat?: "rgb" | "hex" | "oklch";
  /**
   * §7B — swap how class + variable names are generated. Two optional formatters (`className` /
   * `variableName`), each receiving the structured address + the built-in default (decorate or
   * replace). Omit it and naming is byte-identical to the default. The adapter enforces the contract:
   * deterministic (a pure fn of the address), collision-free (a duplicate output throws), and a valid
   * identifier (run through the segment sanitizer). Covers recipe classes AND the `-cq-<name>`
   * container-context utilities (via the `kind` discriminator).
   */
  naming?: NamingOverrides;
  /**
   * §W9 — wrap all emitted CSS in a named cascade `@layer`. `true` uses the layer name `"refract"`; a
   * string sets a custom name (e.g. `"refract.recipes"`). Off by default (byte-identical output). A
   * cascade layer gives refract's rules **deterministic precedence** below any unlayered app CSS or
   * utility framework, regardless of load order — the modern answer to source-order fragility. All
   * output (variables, globals, recipes) rides one layer; author your app CSS unlayered (or in a
   * later-declared layer) to win. Applies to single-file emit and the runtime `theme.css` surface.
   */
  layer?: string | boolean;
  /**
   * §W-motion — append a `@media (prefers-reduced-motion: reduce)` block that neutralizes animation +
   * transition durations for users who ask for less motion (the well-known global reset). Off by
   * default (byte-identical); opt in for an accessible default. Emitted outside any `layer` so its
   * `!important` behaves predictably. Applies to single-file emit and the runtime `theme.css` surface.
   */
  reducedMotion?: boolean;
};

/**
 * §W-motion — the standard "kill motion" block for `prefers-reduced-motion: reduce`. Appended to the
 * full document when the `reducedMotion` option is on.
 */
const REDUCED_MOTION_BLOCK =
  "@media (prefers-reduced-motion: reduce) {\n" +
  "  *, *::before, *::after {\n" +
  "    animation-duration: 0.01ms !important;\n" +
  "    animation-iteration-count: 1 !important;\n" +
  "    transition-duration: 0.01ms !important;\n" +
  "    scroll-behavior: auto !important;\n" +
  "  }\n" +
  "}\n";

/** `.cls`, `.cls:state`, `.cls[attr]` all belong to the recipe whose base selector is `.cls`. */
const selectorBelongsToRecipe = (nodeSelector: string, base: string): boolean =>
  nodeSelector === base || nodeSelector.startsWith(`${base}:`) || nodeSelector.startsWith(`${base}[`);

type SubsystemLowering = {
  variableNodes: CssVariablesNode[];
  /** Class rules — plus, for animation, its `@keyframes` at-rule nodes (they ride the rules stream). */
  recipeNodes: CssNode[];
  /** group → variant → selector (`.dt-color-solid-primary`). */
  selectors: Record<string, Record<string, string>>;
};

/** The resolved composition class for one component variant (referenced classes + own delta). */
type ResolvedComponentClass = { className: string; classList: string[] };

/** Parse a component reference (`"colors:solid.primary"`) into its address parts. */
const parseComponentReference = (
  reference: string,
): { subsystem: string; group: string; variant: string } | undefined => {
  const [subsystem, rest] = reference.split(":");
  if (!subsystem || !rest) return undefined;
  const dot = rest.indexOf(".");
  if (dot < 0) return undefined;
  return { subsystem, group: rest.slice(0, dot), variant: rest.slice(dot + 1) };
};

export const createCssAdapter = (options: CssAdapterOptions = {}): ThemeAdapter<string> => {
  const spec: AdapterSpec<string> = {
    name: "css",
    version: 1,
    // The CSS adapter owns the known-state set; core threads it into recipe normalization.
    allowedStates: CSS_KNOWN_STATES,
    bind(model: ThemeModel, ctx: RenderContext) {
      const media = ctx.media;
      const inline = options.inline ?? false;
      // §21: length units are resolved format-neutrally in core (`createTheme({ units })`) and baked
      // onto the Model's length leaves — the adapter only stringifies `value + unit`. No `length` here.
      // §17: the single adapter-wide naming pair. `varToken` leads every variable, `naming` drives
      // every recipe class (`.<classToken>-<subsystem>-<group>-<variant>`).
      const naming = resolveNaming({ prefix: options.prefix, classPrefix: options.classPrefix });
      // §7B: the override-aware namer owns the two pure choke points (var + class naming) plus the
      // collision Set. `varName` (a token path → its var name) threads through the variable lowering
      // in place of the raw `varToken`; `namer.className` mints every recipe + container-context class.
      const namer = createNamer(naming, options.naming);
      const varName = namer.variableName;

      // §20: palette-colour output format. `rgb` (default) passes the Model's canonical value
      // through unchanged; `hex` / `oklch` re-serialize the same colour for the emitted CSS vars.
      const colorFormat = options.colorFormat ?? "rgb";
      const formatColor = (value: unknown): string => {
        const s = value == null ? "" : String(value);
        if (!s || colorFormat === "rgb") return s;
        return colorFormat === "hex" ? toHexColor(s) : toOklchColor(s);
      };

      // ── Per-subsystem lowering (colors / typography / effects / layout / components) ──
      const lowered: Record<string, SubsystemLowering> = {};
      // Global token-path → var union (all subsystems): a component `css` delta can reference any
      // subsystem's token, so its refs must resolve against every subsystem's naming.
      const globalPathToVar: Record<string, string> = {};

      // Shared recipe loop: every subsystem lowers its rule-set groups the same way — the recipe
      // class name is uniform (`<classToken>-<subsystem>-<group>-<variant>`); only the token-path→var
      // map differs (some subsystems resolve refs against the global union).
      const lowerRecipes = (
        subsystem: string,
        ruleSets: NonNullable<ThemeModel["subsystems"][string]["ruleSets"]>,
        pathToVar: Record<string, string>,
      ): { recipeNodes: CssRuleNode[]; selectors: Record<string, Record<string, string>> } => {
        const recipeNodes: CssRuleNode[] = [];
        const selectors: Record<string, Record<string, string>> = {};
        for (const [group, ruleSetGroup] of Object.entries(ruleSets)) {
          const { nodes, variants } = lowerRecipeGroup(ruleSetGroup, {
            media,
            selectorBuilder: variant => `.${namer.className("recipe", subsystem, group, variant)}`,
            pathToVar,
            containers: ctx.containers,
          });
          recipeNodes.push(...nodes);
          selectors[group] = variants;
        }
        return { recipeNodes, selectors };
      };

      const colors = model.subsystems.colors;
      if (colors) {
        const props = colors.properties ?? {};
        const pathToVar = buildColorsPathToVar(props, varName);
        Object.assign(globalPathToVar, pathToVar);
        const variableNodes = deriveColorsVariableNodes(props, { varName, media, formatColor });
        const { recipeNodes, selectors } = lowerRecipes("colors", colors.ruleSets ?? {}, pathToVar);
        lowered.colors = { variableNodes, recipeNodes, selectors };
      }

      const typography = model.subsystems.typography;
      if (typography) {
        const props = typography.properties ?? {};
        const pathToVar = buildTypographyPathToVar(props, varName);
        Object.assign(globalPathToVar, pathToVar);
        const variableNodes = deriveTypographyVariableNodes(props, { varName, media });
        const { recipeNodes, selectors } = lowerRecipes("typography", typography.ruleSets ?? {}, pathToVar);
        lowered.typography = { variableNodes, recipeNodes, selectors };
      }

      const effects = model.subsystems.effects;
      if (effects) {
        const props = effects.properties ?? {};
        const pathToVar = buildEffectsPathToVar(props, varName);
        Object.assign(globalPathToVar, pathToVar);
        // §15: shadow/transition tokens compose from structure; a layer's `colors.*` color ref
        // resolves via the global map (colors processed first — the §14.4 cross-subsystem rule).
        const variableNodes = deriveEffectsVariableNodes(props, { varName, media, pathToVar: globalPathToVar });
        const { recipeNodes, selectors } = lowerRecipes("effects", effects.ruleSets ?? {}, pathToVar);
        lowered.effects = { variableNodes, recipeNodes, selectors };
      }

      // ── Borders (§14): stroke geometry tokens (width/style/offset/radius) → `:root` vars, and
      //    border/outline recipes → classes. A borders recipe declaration may carry a value-level
      //    `colors.*` ref (border-color/outline-color, §14.4) — so its declarations resolve against
      //    `globalPathToVar` (colors is processed first, its path→var already merged) rather than the
      //    subsystem-local map, which only knows `borders.*`. ──
      const borders = model.subsystems.borders;
      if (borders) {
        const props = borders.properties ?? {};
        const pathToVar = buildBordersPathToVar(props, varName);
        Object.assign(globalPathToVar, pathToVar);
        const variableNodes = deriveBordersVariableNodes(props, { varName, media });
        const { recipeNodes, selectors } = lowerRecipes("borders", borders.ruleSets ?? {}, globalPathToVar);
        lowered.borders = { variableNodes, recipeNodes, selectors };
      }

      // ── Layout: regular vars + config `:root` vars, structural rule-sets (columns/grids/stacks
      //    via lowerRecipeGroup, container via the two-pass lowerContainerGroup) + padding recipes ──
      const layout = model.subsystems.layout;
      if (layout) {
        const props = layout.properties ?? {};
        const pathToVar = buildLayoutPathToVar(props, varName);
        Object.assign(globalPathToVar, pathToVar);
        const { regular, config } = splitLayoutProperties(props);

        const variableNodes = [
          ...deriveLayoutVariableNodes(regular, { varName, media }),
          ...deriveLayoutConfigVariableNodes(config, { varName, pathToVar }),
        ];

        const recipeNodes: CssRuleNode[] = [];
        const selectors: Record<string, Record<string, string>> = {};
        for (const [group, ruleSetGroup] of Object.entries(layout.ruleSets ?? {})) {
          // Structural groups (columns/grids/stacks/container) + padding recipes all take the uniform
          // recipe class `.<ct>-layout-<group>-<variant>` (§17).
          const selectorBuilder = (variant: string) =>
            `.${namer.className("recipe", "layout", group, variant)}`;
          const lower = group === "container" ? lowerContainerGroup : lowerRecipeGroup;
          const { nodes, variants } = lower(ruleSetGroup, { media, selectorBuilder, pathToVar, containers: ctx.containers });
          recipeNodes.push(...nodes);
          selectors[group] = variants;
        }
        lowered.layout = { variableNodes, recipeNodes, selectors };
      }

      // ── Animation (§10.2): motion tokens (duration/easing/delay) → `:root` vars, keyframes →
      //    `@keyframes` at-rules, animation recipes → a class with the composed `animation:`
      //    shorthand. Processed after the base subsystems so keyframe step refs (e.g. `colors.*`)
      //    resolve against the global path→var union. ──
      const animation = model.subsystems.animation;
      if (animation) {
        const props = animation.properties ?? {};
        const pathToVar = buildAnimationPathToVar(props, varName);
        Object.assign(globalPathToVar, pathToVar);
        const variableNodes = deriveAnimationVariableNodes(props, { varName, media });

        const keyframes = animation.keyframes ?? {};
        const keyframeNodes = lowerKeyframes(keyframes, globalPathToVar);
        const keyframeNames = new Set(Object.keys(keyframes));

        const recipeNodes: CssNode[] = [...keyframeNodes];
        const selectors: Record<string, Record<string, string>> = {};
        for (const [group, ruleSetGroup] of Object.entries(animation.ruleSets ?? {})) {
          const { nodes, variants } = lowerAnimationRecipeGroup(ruleSetGroup, {
            media,
            selectorBuilder: variant => `.${namer.className("recipe", "animation", group, variant)}`,
            pathToVar: globalPathToVar,
            keyframeNames,
            containers: ctx.containers,
          });
          recipeNodes.push(...nodes);
          selectors[group] = variants;
        }
        lowered.animation = { variableNodes, recipeNodes, selectors };
      }

      // ── Components (composition): no properties/variables — only recipes that reference other
      //    subsystems' recipes (kept as Model `references`) + an own `css` delta on its own class.
      //    The className list = the referenced recipe classes (looked up from the already-lowered
      //    subsystems' selectors, so their `:hover` etc. ride along) + the own delta class. ──
      const componentClasses: Record<string, Record<string, ResolvedComponentClass>> = {};
      const components = model.subsystems.components;
      if (components) {
        const recipeNodes: CssRuleNode[] = [];
        const selectors: Record<string, Record<string, string>> = {};

        const resolveReferencedClass = (reference: string): string | undefined => {
          const parsed = parseComponentReference(reference);
          if (!parsed) return undefined;
          const selector = lowered[parsed.subsystem]?.selectors[parsed.group]?.[parsed.variant];
          return selector?.replace(/^\./, "");
        };

        for (const [group, ruleSetGroup] of Object.entries(components.ruleSets ?? {})) {
          const { nodes, variants } = lowerRecipeGroup(ruleSetGroup, {
            media,
            selectorBuilder: variant => `.${namer.className("recipe", "components", group, variant)}`,
            pathToVar: globalPathToVar,
            containers: ctx.containers,
          });
          recipeNodes.push(...nodes);
          selectors[group] = variants;

          componentClasses[group] = {};
          for (const [variant, ruleSet] of Object.entries(ruleSetGroup)) {
            const ownClass = variants[variant].replace(/^\./, "");
            const referenced = (ruleSet.references ?? [])
              .map(resolveReferencedClass)
              .filter((cls): cls is string => cls !== undefined);
            const classList = [...referenced, ownClass];
            componentClasses[group][variant] = { className: classList.join(" "), classList };
          }
        }

        lowered.components = { variableNodes: [], recipeNodes, selectors };
      }

      // ── Globals (§9): preset `kind:"reset"` layers → `:where(sel){…}`; themed `kind:"globals"`
      //    elements → bare `sel{…}` + `sel:state` + `sel.<variant>`. No properties/variables.
      //    Lowered LAST (globalPathToVar now holds every subsystem's tokens) so its themed refs
      //    resolve against them, then HOISTED ahead of all recipes in collectNodes. ──
      const globals = model.subsystems.globals;
      if (globals) {
        const recipeNodes = lowerGlobalsGroups(globals.ruleSets ?? {}, globalPathToVar, media, ctx.containers);
        lowered.globals = { variableNodes: [], recipeNodes, selectors: {} };
      }

      // ── Container context (§10.5): the `.dt-cq-<name>` utility classes that establish each named
      //    containment context. Named via the §7B `kind:"container"` namer (default
      //    `<classToken>-cq-<name>`); the `@container` rules that respond to them are lowered inline
      //    on each recipe (via ctx.containers). The same `containerClass` fn feeds `theme.classes`. ──
      const containerClass = (name: string): string =>
        namer.className("container", "containers", "context", name);
      const containerContextNodes = deriveContainerContextNodes(model.containers, containerClass);

      // ── Aggregate node collection (reset first, then container-context classes, then variables +
      //    recipes per subsystem, in Model order). Reset's specificity-0 `:where()` rules lead so they
      //    never fight recipe classes. ──
      const collectNodes = (): CssNode[] => {
        const nodes: CssNode[] = [];
        if (lowered.globals) nodes.push(...lowered.globals.recipeNodes);
        nodes.push(...containerContextNodes);
        for (const key of Object.keys(model.subsystems)) {
          if (key === "globals") continue;
          const sub = lowered[key];
          if (!sub) continue;
          nodes.push(...sub.variableNodes, ...sub.recipeNodes);
        }
        enrichDeclarationsWithRefs(nodes);
        return nodes;
      };

      // §W9 / §W-motion — full-document post-processing (single emit + runtime `css`): optional cascade
      // `@layer` wrap, then an optional `prefers-reduced-motion` block (outside the layer). Both off →
      // byte-identical.
      const layerName =
        options.layer === true ? "refract" : (typeof options.layer === "string" && options.layer) || undefined;
      const reducedMotion = options.reducedMotion ?? false;
      const finalizeDoc = (css: string): string => {
        let out = css;
        if (layerName) {
          const body = css
            .trimEnd()
            .split("\n")
            .map(line => (line ? `  ${line}` : line))
            .join("\n");
          out = `@layer ${layerName} {\n${body}\n}\n`;
        }
        if (reducedMotion) out = `${out.trimEnd()}\n\n${REDUCED_MOTION_BLOCK}`;
        return out;
      };

      // ── Delivery-mode CSS rendering (default / inline) ──
      const renderCss = (nodes: CssNode[]): string => {
        if (!inline) return renderToCssString(nodes);
        // Bake resolved values into rule + keyframe declarations; drop the variable blocks. Resolve
        // EACH `var(--…)` within a value (not just the first) so a composed shorthand — e.g. the
        // animation `duration easing name` — bakes every part; single-var declarations are unchanged.
        const varMap = buildVariableValueMap(nodes);
        const bake = (decl: CssDeclaration): CssDeclaration => {
          if (typeof decl.value !== "string") return { property: decl.property, value: decl.value };
          const value = decl.value.replace(/var\((--[^)]+)\)/g, (whole, name: string) => {
            const resolved = varMap.get(name);
            return resolved !== undefined ? String(resolved) : whole;
          });
          return { property: decl.property, value };
        };
        const inlined: CssNode[] = [];
        for (const n of nodes) {
          if (n.kind === "rule") {
            inlined.push({ ...n, declarations: n.declarations.map(bake) });
          } else if (n.kind === "keyframes") {
            inlined.push({ ...n, steps: n.steps.map(s => ({ stop: s.stop, declarations: s.declarations.map(bake) })) });
          }
        }
        return renderToCssString(inlined);
      };

      // ── classes: subsystem → group → variant → className. Recipe subsystems map to the plain
      //    class string; the composition subsystem maps to `{ className, classList }` (referenced
      //    recipe classes + own delta), matching the OLD ResolvedComponentClass shape. ──
      const collectClasses = (): Record<string, Record<string, Record<string, unknown>>> => {
        const out: Record<string, Record<string, Record<string, unknown>>> = {};
        for (const [key, sub] of Object.entries(lowered)) {
          if (key === "globals") continue; // globals targets raw selectors — no minted classes
          if (key === "components") {
            out[key] = componentClasses;
            continue;
          }
          const groups: Record<string, Record<string, string>> = {};
          for (const [group, variants] of Object.entries(sub.selectors)) {
            groups[group] = Object.fromEntries(
              Object.entries(variants).map(([variant, selector]) => [variant, selector.replace(/^\./, "")]),
            );
          }
          out[key] = groups;
        }
        // Container-context utility classes (§10.5): `containers.<name> → ".dt-cq-<name>"` (no leading dot).
        if (model.containers && Object.keys(model.containers).length) {
          const containerGroup: Record<string, string> = {};
          for (const name of Object.keys(model.containers)) {
            containerGroup[name] = containerClass(name);
          }
          out.containers = { context: containerGroup };
        }
        return out;
      };

      const selectorFor = (subsystem: string, group: string, variant: string): string | undefined =>
        lowered[subsystem]?.selectors[group]?.[variant];

      // Class-name accessor mirroring `theme.classes` (single source of truth): the plain recipe
      // class for normal subsystems, and the space-joined composition string (`className`) for
      // `components` and the `containers.context.*` utilities. Returns `undefined` for an
      // unknown subsystem/group/variant address.
      const getClass = (subsystem: string, group: string, variant: string): string | undefined => {
        const leaf = collectClasses()[subsystem]?.[group]?.[variant];
        if (leaf === undefined) return undefined;
        return typeof leaf === "string" ? leaf : (leaf as ResolvedComponentClass).className;
      };

      // Per-recipe delivery: the subsystem's own rules for one variant (base + its state/breakpoint
      // rules — `selectorBelongsToRecipe` keeps `.cls`, `.cls:hover`, `.cls[disabled]`).
      const renderRecipe = (subsystem: string, group: string, variant: string): string => {
        const sub = lowered[subsystem];
        const base = selectorFor(subsystem, group, variant);
        if (!sub || !base) return "";
        const nodes = sub.recipeNodes.filter(
          (n): n is CssRuleNode => n.kind === "rule" && selectorBelongsToRecipe(n.selector, base),
        );
        return renderCss(nodes);
      };

      return {
        recipeName(subsystem, group, variant) {
          return (selectorFor(subsystem, group, variant) ?? "").replace(/^\./, "");
        },
        renderRecipe,
        renderVariables(subsystem) {
          return renderToCssString(lowered[subsystem]?.variableNodes ?? []);
        },
        join(parts) {
          return parts.filter(Boolean).join("\n\n");
        },

        // Aggregators overridden so the full document renders through the node IR (delivery-aware).
        renderAllVariables: () => renderVariablesCss(collectNodes()),
        renderAllRecipes: () => renderRulesCss(collectNodes()),
        renderAll: () => finalizeDoc(renderCss(collectNodes())),

        // Self-documentation: the REAL class names (composition strings for components) via getClass,
        // plus CSS-specific consumption prose for the emitted guide (llms.txt).
        describeUsage() {
          const recipes: UsageRecipe[] = [];
          for (const [subsystem, sub] of Object.entries(model.subsystems)) {
            for (const [group, ruleSet] of Object.entries(sub.ruleSets ?? {})) {
              for (const variant of Object.keys(ruleSet)) {
                const name = getClass(subsystem, group, variant);
                if (name) recipes.push({ subsystem, group, variant, name });
              }
            }
          }
          return {
            format: "css",
            summary: [
              "Import the stylesheet once, then apply the recipe class names below to your elements.",
              'Example: `import "./theme.css";` then `<button class="<class>">`.',
              "Values are CSS custom properties (`var(--…)`), so runtime theming = override the variables under a selector or `[data-theme]`.",
            ],
            recipes,
          };
        },

        // Human-facing preview (§20): CSS is the one format a browser loads as-is, so this is where
        // the live recipe plates come from. Both answers depend on the PLAN, which is why it's an
        // argument: `split` has a load-order contract (variables first), `subsystem`/`components`
        // name files through a user-supplied function, and `components` emits merged self-contained
        // rules keyed by the recipe's OWN class rather than the composition list every other mode uses.
        describePreview(plan, files): PreviewDescriptor {
          const written = new Set(files);
          const keep = (...names: Array<string | false | undefined>): string[] =>
            names.filter((n): n is string => typeof n === "string" && written.has(n));

          // `components` emits ONLY the components subsystem, so every other subsystem's recipes have
          // no CSS in this output — listing them as renderable would be a lie.
          const renderable = (r: UsageRecipe): boolean =>
            plan.type !== "components" || r.subsystem === "components";

          const markup = (r: UsageRecipe) => {
            if (!renderable(r)) return undefined;
            // components mode: the merged rule targets the own class; every other mode wants the full
            // composition list `getClass` returns.
            const name =
              plan.type === "components"
                ? (selectorFor(r.subsystem, r.group, r.variant) ?? "").replace(/^\./, "")
                : getClass(r.subsystem, r.group, r.variant);
            return name ? { attrs: { class: name } } : undefined;
          };

          const ruleSetOf = (r: UsageRecipe) =>
            model.subsystems[r.subsystem]?.ruleSets?.[r.group]?.[r.variant];

          /** The states this rule-set actually declares, in the adapter's canonical order. */
          const states = (r: UsageRecipe): string[] => {
            if (!renderable(r)) return [];
            const declared = new Set(
              (ruleSetOf(r)?.overrides ?? [])
                .map(o => o.state)
                .filter((s): s is string => typeof s === "string"),
            );
            return CSS_KNOWN_STATES.filter(s => declared.has(s));
          };

          // A pseudo-class can't be switched on from markup, so a specimen sheet can never show
          // `:hover` at rest. The fix is a parallel rule keyed on a plain class: same declarations,
          // pinnable selector. These rules exist ONLY for the preview and are inlined into the page,
          // never added to the emitted stylesheet a consumer ships.
          const PIN_PREFIX = "rfp-s-";
          const statePinClass = (state: string): string | undefined =>
            CSS_STATE_SELECTORS[state] ? `${PIN_PREFIX}${state}` : undefined;

          const buildStatePinCss = (): string => {
            collectNodes(); // enrich once; recipeNodes are mutated in place
            const pinned: CssRuleNode[] = [];
            for (const sub of Object.values(lowered)) {
              for (const node of sub?.recipeNodes ?? []) {
                if (node.kind !== "rule") continue;
                for (const [state, suffix] of Object.entries(CSS_STATE_SELECTORS)) {
                  if (!node.selector.includes(suffix)) continue;
                  pinned.push({
                    ...node,
                    selector: node.selector.split(suffix).join(`.${PIN_PREFIX}${state}`),
                  });
                  break; // one state per selector — the first match is the suffix that built it
                }
              }
            }
            return pinned.length ? renderToCssString(pinned) : "";
          };

          /**
           * A composed component emits a class LIST: one class per referenced rule-set, then its own
           * delta last. `references` and `classList` are built in the same order, so they zip.
           */
          const composition = (r: UsageRecipe) => {
            const leaf = collectClasses()[r.subsystem]?.[r.group]?.[r.variant];
            if (!leaf || typeof leaf === "string") return undefined;
            const classList = (leaf as ResolvedComponentClass).classList;
            if (!classList || classList.length < 2) return undefined;
            const references = ruleSetOf(r)?.references ?? [];
            return classList.map((className, index) => {
              const parsed = references[index] ? parseComponentReference(references[index]) : undefined;
              return {
                className,
                from: parsed ? `${parsed.subsystem}.${parsed.group}.${parsed.variant}` : undefined,
              };
            });
          };

          const base = {
            markup,
            modeAttribute: "data-theme",
            // The emitted custom-property name for a token path — the thing a reader actually types.
            tokenName: (path: string): string | undefined => globalPathToVar[path],
            states,
            statePinClass,
            statePinCss: buildStatePinCss(),
            composition,
          } as const;

          switch (plan.type) {
            case "single":
              return { ...base, stylesheets: keep(plan.file) };

            case "split":
              // Load-order contract — the styles file references vars the variables file defines.
              return { ...base, stylesheets: keep(plan.variables, plan.file) };

            case "subsystem": {
              // Every subsystem's variables before any rules, for the same reason. Names come from the
              // plan's `filename` fn but are intersected with what was actually written.
              const subsystems = Object.keys(model.subsystems);
              return {
                ...base,
                stylesheets: [
                  ...keep(...subsystems.map(sub => plan.filename(sub, "variables"))),
                  ...keep(...subsystems.map(sub => plan.filename(sub, "styles"))),
                ],
                groupBy: r => r.subsystem,
              };
            }

            case "components": {
              const componentFile = (r: UsageRecipe): string =>
                plan.filename({ group: r.group, variant: r.variant });
              const variables = plan.variables === false ? [] : keep(plan.variables);
              const componentFiles = files.filter(f => !variables.includes(f));
              return {
                ...base,
                stylesheets: [...variables, ...componentFiles],
                groupBy: r => (renderable(r) ? componentFile(r) : "not emitted in components mode"),
                notes:
                  plan.variables === false && plan.inline === false
                    ? [
                        "This target emits component rules that reference CSS variables but no variables " +
                          "file (`variables: false`), so the preview renders them undefined — supply the " +
                          "variables yourself in the consuming app.",
                      ]
                    : undefined,
              };
            }
          }
        },

        // Surface the CSS-named aggregate outputs on the theme (computed on demand — no stored bag),
        // plus `theme.media` = the plain core descriptor pass-through (an SC adapter would wrap it).
        extend() {
          return {
            media,
            // Per-recipe delivery helper: `theme.renderRecipe(subsystem, group, variant)` → that one
            // recipe's own CSS (base + its state/breakpoint rules). Bound to the model/ctx already.
            renderRecipe,
            // Class-name accessor: `theme.getClass(subsystem, group, variant)` → the class string you
            // drop into markup (composition classes joined for `components`). Mirrors `theme.classes`.
            getClass,
            // Token-var accessor: `theme.varName("colors.brand.dark")` → its emitted CSS custom-property
            // name (`--dt-colors-brand-dark`, carrying the configured prefix), or `undefined` for a path
            // that mints no variable. The most useful question a CSS consumer/agent can ask a token path.
            varName: (path: string): string | undefined => globalPathToVar[path],
            get css() {
              return finalizeDoc(renderCss(collectNodes()));
            },
            get variablesCss() {
              return renderVariablesCss(collectNodes());
            },
            get recipesCss() {
              return renderRulesCss(collectNodes());
            },
            get nodes() {
              return collectNodes();
            },
            get classes() {
              return collectClasses();
            },
          };
        },

        // Self-contained build-time output: the full stylesheet (baked CSS variables + rules) a
        // downstream app links directly. The CSS adapter needs no *theme-specific* runtime helper of
        // its own, so `vendorHelpers` is empty — shared static helpers like `color-math` (the pure
        // `lighten`/`darken`) are vendored by the build layer from their single source (see
        // `src/build/vendor.ts`), not re-embedded here. (Adapters only emit vendorHelpers for helpers
        // whose source is theme-specific, e.g. the SC media module with baked `@media` strings.)
        emit(plan) {
          // `single` (the default when no plan is threaded) → one file, `plan.file` (default
          // theme.css). split / subsystem lower here (9b) by reusing the aggregate renderers over
          // the shared, ref-enriched node set; components lands in 9d–9e and still fails loud.
          const type = plan?.type ?? "single";

          // §W9 / §W-motion — the `layer` wrap + `reducedMotion` block target one self-contained
          // document; the multi-file modes split the cascade, so fail loud rather than emit a partial result.
          if ((layerName || reducedMotion) && type !== "single") {
            const opt = layerName ? "layer" : "reducedMotion";
            throw new Error(
              `The \`${opt}\` option is only supported with single-file emit (got "${type}"). ` +
                `Emit one file, or drop \`${opt}\` for split/subsystem/components.`,
            );
          }

          if (type === "single") {
            const file = plan?.type === "single" ? plan.file : "theme.css";
            return { files: { [file]: finalizeDoc(renderCss(collectNodes())) } };
          }

          // `inline` bakes resolved values into the rules, leaving NO variables to emit — which
          // contradicts every multi-file mode (each writes a separate variables file/side). Fail
          // loud rather than silently dropping the variables the author asked to split out.
          if (inline && (type === "split" || type === "subsystem")) {
            throw new Error(
              `css adapter: emit mode '${type}' cannot be combined with the global inline option ` +
                `(inline bakes values, leaving no variables file)`,
            );
          }

          if (plan?.type === "split") {
            // Two files under a load-order contract — NO `@import` (that re-joins what we split).
            // The styles file references vars by name and assumes the variables file loads first.
            const nodes = collectNodes();
            return {
              files: {
                [plan.file]: renderRulesCss(nodes),
                [plan.variables]: renderVariablesCss(nodes),
              },
            };
          }

          if (plan?.type === "subsystem") {
            // Per subsystem: its variables → `<sub>.variables.css`, its recipes → `<sub>.css`.
            // Enrich ONCE over the whole set (collectNodes mutates the lowered[key] node objects in
            // place, so cross-subsystem refs survive), then render each subsystem's slice. Skip
            // empties — the components subsystem owns no properties → styles file only.
            collectNodes();
            const files: Record<string, string> = {};
            for (const key of Object.keys(model.subsystems)) {
              const sub = lowered[key];
              if (!sub) continue;
              const variablesCss = renderVariablesCss(sub.variableNodes);
              const stylesCss = renderRulesCss(sub.recipeNodes);
              if (variablesCss) files[plan.filename(key, "variables")] = variablesCss;
              if (stylesCss) files[plan.filename(key, "styles")] = stylesCss;
            }
            return { files };
          }

          if (plan?.type === "components") {
            // The flattened/merged export: each component variant is lowered to ONE self-contained
            // rule (its referenced recipes' declarations + own `css` delta, merged in core by
            // `mergeComponentRuleSet`), rendered with baked values — zero `var(`, dependency-free.
            //
            // `inline` is the plan-level control (defaults true). The global adapter `inline` option
            // is irrelevant here — the plan decides.
            const componentRuleSets = model.subsystems.components?.ruleSets ?? {};

            // The subsystem variable nodes are the value source for BOTH paths: inline baking resolves
            // each merged `var(--…)` ref to its formatted value (`20px`, `#4dabf7`, …); non-inline
            // sources the tree-shaken variables file from the same map (no re-derived formatting).
            const variableNodes: CssVariablesNode[] = [];
            for (const key of Object.keys(model.subsystems)) {
              const sub = lowered[key];
              if (sub) variableNodes.push(...sub.variableNodes);
            }

            if (plan.inline === false) {
              // ── NON-INLINE (9e): merged rules rendered with `var(--…)` refs (NO enrich/bake) into
              //    the styles file(s) — same filename bundling as inline — plus a tree-shaken variables
              //    file defining ONLY the tokens the exported components reference (union of every
              //    variant's `referencedPaths`), so every emitted `var(--…)` resolves. Load-order
              //    contract — NO `@import`. ──
              const filesByName: Record<string, string[]> = {};
              const orderedVarNames: string[] = [];
              const referencedVars = new Set<string>();

              for (const [group, ruleSetGroup] of Object.entries(componentRuleSets)) {
                for (const variant of Object.keys(ruleSetGroup)) {
                  const merged = mergeComponentRuleSet(model, group, variant);
                  const selector = lowered.components?.selectors[group]?.[variant];
                  if (!selector) continue;

                  const ruleNodes = lowerMergedRuleSet(merged, { selector, media, pathToVar: globalPathToVar, containers: ctx.containers });
                  const filename = plan.filename({ group, variant });
                  (filesByName[filename] ??= []).push(renderToCssString(ruleNodes));

                  // Tree-shake set: referenced token paths → var names, stable first-appearance order.
                  for (const path of merged.referencedPaths) {
                    const varName = globalPathToVar[path];
                    if (varName && !referencedVars.has(varName)) {
                      referencedVars.add(varName);
                      orderedVarNames.push(varName);
                    }
                  }
                }
              }

              const files: Record<string, string> = {};
              for (const [name, parts] of Object.entries(filesByName)) files[name] = parts.join("\n\n");

              // Tree-shaken variables file, unless `variables: false` (consumer supplies the vars).
              // Base `:root` = resolved literal per referenced var (reusing the enrichment value map —
              // built from the non-responsive nodes so base values aren't shadowed by overrides); then
              // any responsive `:root` @media override blocks, filtered to the referenced var names
              // (keeps breakpoint theming). Covered by the §11.5 responsive-overrides emit test
              // (the `responsiveComponents` fixture drives a component → responsive property var).
              if (plan.variables !== false) {
                const baseValueMap = buildVariableValueMap(variableNodes.filter(n => !n.media));
                const baseVars: Record<string, string> = {};
                for (const name of orderedVarNames) {
                  const value = baseValueMap.get(name);
                  if (value !== undefined) baseVars[name] = value;
                }

                const varsNodes: CssNode[] = [{ kind: "variables", selector: ":root", variables: baseVars }];
                for (const node of variableNodes) {
                  if (!node.media || node.selector !== ":root") continue;
                  const filtered: Record<string, string> = {};
                  for (const [name, value] of Object.entries(node.variables)) {
                    if (referencedVars.has(name)) filtered[name] = value;
                  }
                  if (Object.keys(filtered).length) {
                    varsNodes.push({ kind: "variables", selector: node.selector, media: node.media, variables: filtered });
                  }
                }

                const variablesCss = renderVariablesCss(varsNodes);
                if (variablesCss) files[plan.variables] = variablesCss;
              }

              return { files };
            }

            // Variants returning the same filename concatenate into that one file — so a per-group
            // `filename` fn bundles (buttons → buttons.css), and `() => "components.css"` collapses all.
            const filesByName: Record<string, string[]> = {};
            for (const [group, ruleSetGroup] of Object.entries(componentRuleSets)) {
              for (const variant of Object.keys(ruleSetGroup)) {
                const merged = mergeComponentRuleSet(model, group, variant);
                const selector = lowered.components?.selectors[group]?.[variant];
                if (!selector) continue;

                const ruleNodes = lowerMergedRuleSet(merged, { selector, media, pathToVar: globalPathToVar, containers: ctx.containers });
                // Populate `resolved` on each declaration from the variable map, then bake it.
                enrichDeclarationsWithRefs([...variableNodes, ...ruleNodes]);
                const inlined: CssNode[] = ruleNodes.map(rule => ({
                  ...rule,
                  declarations: rule.declarations.map(decl => {
                    const baked = decl.resolved !== undefined ? decl.resolved : decl.value;
                    // Every merged token ref must resolve to a baked value at this stage. A lingering
                    // `var(` means an unresolved reference — surface it loud rather than emit a file
                    // that silently depends on a variable the `components` mode never writes.
                    if (typeof baked === "string" && baked.includes("var(")) {
                      throw new Error(
                        `css adapter: emit mode 'components' (inline): '${decl.property}' on ` +
                          `'${selector}' has an unresolved token reference (${baked}) — no baked value`,
                      );
                    }
                    return { property: decl.property, value: baked };
                  }),
                }));

                const filename = plan.filename({ group, variant });
                (filesByName[filename] ??= []).push(renderToCssString(inlined));
              }
            }

            const files: Record<string, string> = {};
            for (const [name, parts] of Object.entries(filesByName)) files[name] = parts.join("\n\n");
            return { files };
          }

          throw new Error(`css adapter: emit mode '${type}' not yet implemented`);
        },
      };
    },
  };

  return defineAdapter(spec);
};
