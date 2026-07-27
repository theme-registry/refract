/**
 * The SCSS adapter — lowers the format-neutral {@link ThemeModel} to idiomatic Sass.
 *
 * The third output adapter. Like CSS its `TUnit` is `string`, but the output is genuinely a
 * different format: tokens become compile-time **`$variables`** (not `:root` custom properties),
 * declaration refs render as **`$dt-…`** (not `var(--…)`), and each rule-set nests its
 * state/breakpoint overrides with `&` / `@media` the Sass way. Recipes are emitted as **classes**
 * and composition is the option-C **class list** (as in the CSS adapter) — the same class surface,
 * generated from Sass source.
 *
 * Naming is uniform + path-based (`$dt-<subsystem>-<path>`, `.dt-<subsystem>-<group>-<variant>`) —
 * SCSS is its own format, so it does not chase the CSS adapter's byte-for-byte variable/class names.
 *
 * KNOWN LIMITATION (inherent to compile-time Sass variables): `$variables` capture each token's
 * BASE value only. Responsive / appearance-mode *token* variation — which the CSS adapter emits as
 * `@media { :root { --x: … } }` custom-property reassignments — cannot be expressed as a `$variable`
 * (a Sass var is not media-conditional). Recipe-level breakpoint overrides, which re-emit whole
 * declarations, are fully supported via nested `@media`.
 *
 * Worked reference: `src/adapters/css/`. Core stays format-agnostic; all naming + state handling live here.
 */
import type { Literal, Ref, RuleSet, RuleSetOverride, ThemeModel } from "@theme-registry/refract";
import { buildTokenMap, mergeComponentRuleSet, parseRuleSetReference } from "@theme-registry/refract";
import type { MergedRuleSet } from "@theme-registry/refract";
import type { MediaDescriptor, MediaVariant } from "@theme-registry/refract";
import type { AdapterSpec, PreviewDescriptor, RenderContext, ThemeAdapter, UsageDescriptor, UsageRecipe } from "@theme-registry/refract";
import { defineAdapter } from "@theme-registry/refract";
import type { ResolvedComponentClass, ScssAdapterOptions, ScssUnit } from "./types";

export type { ResolvedComponentClass, ScssAdapterOptions, ScssUnit } from "./types";

/** `state → selector suffix`, nested as `&<suffix>`. SCSS compiles to CSS, so it knows the CSS states. */
const SCSS_STATE_SELECTORS: Record<string, string> = {
  link: ":link",
  visited: ":visited",
  hover: ":hover",
  focus: ":focus",
  active: ":active",
  disabled: "[disabled]",
  pressed: "[aria-pressed]",
};
const SCSS_KNOWN_STATES: ReadonlyArray<string> = Object.keys(SCSS_STATE_SELECTORS);
const STATE_ORDER: Record<string, number> = SCSS_KNOWN_STATES.reduce<Record<string, number>>(
  (acc, s, i) => ((acc[s] = i), acc),
  {},
);

/** Sanitize one identifier segment to `[a-z0-9-]` (drops `.` / `--` collisions to single dashes). */
const sanitizeSegment = (segment: string): string =>
  segment.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();

/** `$dt-colors-primary-dark` from a token path + prefix. */
const scssVarName = (path: string, prefix: string): string =>
  `$${prefix}-${path.split(".").map(sanitizeSegment).join("-")}`;

/** `dt-colors-solid-primary` from an address + prefix (no leading dot). */
const scssClassName = (subsystem: string, group: string, variant: string, prefix: string): string =>
  [prefix, subsystem, group, variant].map(sanitizeSegment).join("-");

/** Normalize a filename to a `.scss` extension (plan defaults are CSS-centric). */
const scssName = (name: string): string =>
  name.endsWith(".scss") ? name : `${name.replace(/\.[^./]+$/, "")}.scss`;

/** Turn a filename into a Sass partial (`_name.scss`) for `@use`. */
const scssPartial = (name: string): string => {
  const scss = scssName(name);
  const slash = scss.lastIndexOf("/");
  const dir = slash >= 0 ? scss.slice(0, slash + 1) : "";
  const base = scss.slice(slash + 1);
  return `${dir}${base.startsWith("_") ? base : `_${base}`}`;
};

/** The `@use` reference for a partial — its basename without leading `_` or `.scss`. */
const useRef = (partial: string): string => {
  const slash = partial.lastIndexOf("/");
  return partial
    .slice(slash + 1)
    .replace(/^_/, "")
    .replace(/\.scss$/, "");
};

export const createScssAdapter = (options: ScssAdapterOptions = {}): ThemeAdapter<ScssUnit> => {
  const prefix = options.prefix ?? "dt";
  const optionInline = options.inline ?? false;
  const indentWidth = options.indent ?? 2;
  const IND = " ".repeat(indentWidth);
  const pad = (level: number): string => IND.repeat(level);
  // §W9 — optional cascade-layer wrap for the full-document output (single emit + runtime `scss`).
  const layerName =
    options.layer === true ? "refract" : (typeof options.layer === "string" && options.layer) || undefined;
  const wrapLayer = (scss: string): string => {
    if (!layerName) return scss;
    const body = scss
      .trimEnd()
      .split("\n")
      .map(line => (line ? `${IND}${line}` : line))
      .join("\n");
    return `@layer ${layerName} {\n${body}\n}\n`;
  };

  const spec: AdapterSpec<ScssUnit> = {
    name: "scss",
    version: 1,
    // SCSS compiles to CSS, so it renders the same state selectors CSS does.
    allowedStates: SCSS_KNOWN_STATES,
    bind(model: ThemeModel, ctx: RenderContext) {
      const media = ctx.media;
      const tokenMap = buildTokenMap(model);

      const safeResolve = (path: string): Literal | undefined => {
        try {
          return ctx.resolve(path);
        } catch {
          return undefined;
        }
      };

      /**
       * A token value → its SCSS text. §21: length units are resolved format-neutrally in core and baked
       * onto the leaf's `Ref.unit`; a numeric length token appends its resolved unit (looked up on the
       * token map), everything else (unit-less numbers, colours, strings) passes through raw.
       */
      const formatTokenValue = (path: string, value: Literal | undefined): string => {
        if (typeof value !== "number") return String(value ?? "");
        const unit = tokenMap[path]?.unit;
        return unit ? `${value}${unit}` : `${value}`;
      };

      const applyWrap = (value: string, wrap?: string): string => (wrap ? `${wrap}(${value})` : value);

      /** Render one declaration value: a `$var` ref (default), or a baked literal (inline). */
      const renderValue = (ref: Ref, inline: boolean): string => {
        if (ref.ref !== undefined) {
          // §W6b — an external token has no `$var`; reference the parent's CSS variable directly.
          const external = tokenMap[ref.ref]?.external;
          if (external !== undefined) return applyWrap(`var(${external})`, ref.wrap);
          if (inline) return applyWrap(formatTokenValue(ref.ref, safeResolve(ref.ref) ?? ref.value), ref.wrap);
          return applyWrap(scssVarName(ref.ref, prefix), ref.wrap);
        }
        return applyWrap(String(ref.value ?? ""), ref.wrap);
      };

      const renderDeclarations = (decls: Record<string, Ref>, level: number, inline: boolean): string =>
        Object.entries(decls)
          .map(([property, ref]) => `${pad(level)}${property}: ${renderValue(ref, inline)};`)
          .join("\n");

      /** The full `@media (…)` at-rule for a viewport override (empty when unresolved). The core media
       *  descriptor already includes the `@media` keyword, so it is used verbatim as the block prelude. */
      const mediaQueryFor = (override: Pick<RuleSetOverride, "breakpoint" | "query" | "orientation">): string => {
        const breakpoint = override.breakpoint;
        if (breakpoint === undefined) return "";
        const query = (override.query ?? "exact") as MediaVariant;
        const orientation = override.orientation;
        if (!orientation) return (media as MediaDescriptor<string>)[breakpoint]?.[query] ?? "";
        if (query === "min") return media.min(breakpoint, { orientation });
        if (query === "max") return media.max(breakpoint, { orientation });
        return media.exact(breakpoint, { orientation });
      };

      /** One override → its nested block (`&:hover { … }`, `@media (…) { … }`, or both). */
      const renderOverride = (override: RuleSetOverride, level: number, inline: boolean): string => {
        const decls = override.declarations ?? {};
        const stateSuffix = override.state ? SCSS_STATE_SELECTORS[override.state] : undefined;
        const atRule = override.breakpoint !== undefined ? mediaQueryFor(override) : undefined;
        // Nothing renderable (e.g. a pure variant/target swap — not expressible in a $var recipe class).
        if (!Object.keys(decls).length) return "";
        if (override.breakpoint !== undefined && !atRule) return "";

        const open: string[] = [];
        const close: string[] = [];
        let cur = level;
        if (atRule) {
          open.push(`${pad(cur)}${atRule} {`);
          close.unshift(`${pad(cur)}}`);
          cur += 1;
        }
        if (stateSuffix) {
          open.push(`${pad(cur)}&${stateSuffix} {`);
          close.unshift(`${pad(cur)}}`);
          cur += 1;
        }
        return [...open, renderDeclarations(decls, cur, inline), ...close].join("\n");
      };

      /** Order overrides: canonical state order, base-state (no bp) before responsive. */
      const orderOverrides = (overrides: RuleSetOverride[]): RuleSetOverride[] =>
        [...overrides].sort((a, b) => {
          const abp = a.breakpoint !== undefined ? 1 : 0;
          const bbp = b.breakpoint !== undefined ? 1 : 0;
          if (abp !== bbp) return abp - bbp;
          const as = a.state ? STATE_ORDER[a.state] ?? 99 : -1;
          const bs = b.state ? STATE_ORDER[b.state] ?? 99 : -1;
          return as - bs;
        });

      /** Render a `{ declarations, overrides }` block under a selector (recipe class / reset selector). */
      const renderRuleSet = (
        selector: string,
        declarations: Record<string, Ref>,
        overrides: RuleSetOverride[],
        inline: boolean,
      ): string => {
        const parts: string[] = [`${selector} {`];
        const base = renderDeclarations(declarations, 1, inline);
        if (base) parts.push(base);
        for (const override of orderOverrides(overrides)) {
          const block = renderOverride(override, 1, inline);
          if (block) parts.push(block);
        }
        parts.push(`}`);
        return parts.join("\n");
      };

      /**
       * Render a themed globals element (§9) `kind:"globals"` rule-set → a bare, nested SCSS block:
       * `selector { <decls>; <&:state / @media overrides>; &.<variant> { <delta>; <overrides> } }`.
       * Unlike the preset `:where()` reset layer, the selector is bare (higher tier) and each
       * delta-only variant nests as `&.<variant>`.
       */
      const renderGlobalsElement = (ruleSet: RuleSet, inline: boolean): string => {
        const selector = ruleSet.selector ?? "*";
        const parts: string[] = [`${selector} {`];
        const base = renderDeclarations(ruleSet.declarations, 1, inline);
        if (base) parts.push(base);
        for (const override of orderOverrides(ruleSet.overrides)) {
          const block = renderOverride(override, 1, inline);
          if (block) parts.push(block);
        }
        for (const [variantName, variant] of Object.entries(ruleSet.variants ?? {})) {
          const vparts: string[] = [`${pad(1)}&.${variantName} {`];
          const vbase = renderDeclarations(variant.declarations, 2, inline);
          if (vbase) vparts.push(vbase);
          for (const override of orderOverrides(variant.overrides)) {
            const block = renderOverride(override, 2, inline);
            if (block) vparts.push(block);
          }
          vparts.push(`${pad(1)}}`);
          parts.push(vparts.join("\n"));
        }
        parts.push(`}`);
        return parts.join("\n");
      };

      // ── Precompute class names for every recipe/utility variant (components' class list needs
      //    sibling classes) — mirrors the CSS adapter's `selectors` map. ──
      const selectors: Record<string, Record<string, Record<string, string>>> = {};
      for (const [subsystem, subModel] of Object.entries(model.subsystems)) {
        if (subsystem === "components" || subsystem === "globals") continue;
        for (const [group, ruleSetGroup] of Object.entries(subModel.ruleSets ?? {})) {
          for (const variant of Object.keys(ruleSetGroup)) {
            (selectors[subsystem] ??= {})[group] ??= {};
            selectors[subsystem][group][variant] = scssClassName(subsystem, group, variant, prefix);
          }
        }
      }

      // ── Components: option-C class list (referenced recipe classes + own delta class). ──
      const componentClasses: Record<string, Record<string, ResolvedComponentClass>> = {};
      const components = model.subsystems.components;
      if (components) {
        for (const [group, ruleSetGroup] of Object.entries(components.ruleSets ?? {})) {
          for (const [variant, ruleSet] of Object.entries(ruleSetGroup)) {
            const ownClass = scssClassName("components", group, variant, prefix);
            const referenced = (ruleSet.references ?? [])
              .map(reference => {
                const parsed = parseRuleSetReference(reference);
                return parsed ? selectors[parsed.subsystem]?.[parsed.group]?.[parsed.variant] : undefined;
              })
              .filter((cls): cls is string => cls !== undefined);
            const classList = [...referenced, ownClass];
            (componentClasses[group] ??= {})[variant] = { className: classList.join(" "), classList };
          }
        }
      }

      // ── Primitives ──
      const renderVariablesFor = (subsystem: string): string => {
        // Inline bakes values into declarations, so there are no `$variables` to define.
        if (optionInline) return "";
        const prefixDot = `${subsystem}.`;
        const lines: string[] = [];
        for (const [path, ref] of Object.entries(tokenMap)) {
          if (!path.startsWith(prefixDot)) continue;
          if (ref.external !== undefined) continue; // §W6b — parent owns the var; define no `$var`
          const value = safeResolve(path) ?? ref.value;
          if (value === undefined) continue;
          lines.push(`${scssVarName(path, prefix)}: ${formatTokenValue(path, value)};`);
        }
        return lines.join("\n");
      };

      const renderRecipeFor = (subsystem: string, group: string, variant: string, inline: boolean): string => {
        const ruleSet = model.subsystems[subsystem]?.ruleSets?.[group]?.[variant];
        if (!ruleSet) return "";
        if (ruleSet.kind === "globals") {
          return renderGlobalsElement(ruleSet, inline);
        }
        if (ruleSet.kind === "reset") {
          const target = ruleSet.selector ?? "*";
          return renderRuleSet(`:where(${target})`, ruleSet.declarations, ruleSet.overrides, inline);
        }
        const cls =
          subsystem === "components"
            ? scssClassName("components", group, variant, prefix)
            : selectors[subsystem]?.[group]?.[variant];
        if (!cls) return "";
        return renderRuleSet(`.${cls}`, ruleSet.declarations, ruleSet.overrides, inline);
      };

      // Aggregate builders (reused by the aggregators, `extend`, and `emit`).
      const allVariables = (): string =>
        Object.keys(model.subsystems)
          .map(renderVariablesFor)
          .filter(Boolean)
          .join("\n\n");

      const allRecipes = (): string => {
        const parts: string[] = [];
        for (const [subsystem, subModel] of Object.entries(model.subsystems)) {
          for (const [group, ruleSetGroup] of Object.entries(subModel.ruleSets ?? {})) {
            for (const variant of Object.keys(ruleSetGroup)) {
              const rule = renderRecipeFor(subsystem, group, variant, optionInline);
              if (rule) parts.push(rule);
            }
          }
        }
        return parts.join("\n\n");
      };

      const allScss = (): string => [allVariables(), allRecipes()].filter(Boolean).join("\n\n");

      const collectClasses = (): Record<string, Record<string, Record<string, unknown>>> => {
        const out: Record<string, Record<string, Record<string, unknown>>> = {};
        for (const [subsystem, groups] of Object.entries(selectors)) {
          const g: Record<string, Record<string, string>> = {};
          for (const [group, variants] of Object.entries(groups)) g[group] = { ...variants };
          out[subsystem] = g;
        }
        if (components) out.components = componentClasses;
        return out;
      };

      return {
        recipeName(subsystem, group, variant) {
          const ruleSet = model.subsystems[subsystem]?.ruleSets?.[group]?.[variant];
          if (ruleSet?.kind === "reset" || ruleSet?.kind === "globals") return "";
          if (subsystem === "components") return scssClassName("components", group, variant, prefix);
          return selectors[subsystem]?.[group]?.[variant] ?? "";
        },

        // Preview (§20): a browser can't load Sass — the partials must be compiled first. Token
        // plates still render from the format-neutral export; recipes are listed by name only.
        describePreview(): PreviewDescriptor {
          return {
            stylesheets: [],
            unavailable:
              "This target emits Sass partials, which a browser cannot load directly — compile them " +
              "to CSS first (or add a CSS target to this config) for a live render. Token values " +
              "below are exact; recipe class names are the ones the partials compile to.",
          };
        },

        // Self-documentation: the REAL class names recipes compile to (globals/reset carry no class),
        // plus Sass-specific `@use` prose for the emitted guide (llms.txt).
        describeUsage(): UsageDescriptor {
          const recipes: UsageRecipe[] = [];
          for (const [subsystem, sub] of Object.entries(model.subsystems)) {
            for (const [group, ruleSetGroup] of Object.entries(sub.ruleSets ?? {})) {
              for (const [variant, ruleSet] of Object.entries(ruleSetGroup)) {
                if (ruleSet?.kind === "reset" || ruleSet?.kind === "globals") continue;
                const name =
                  subsystem === "components"
                    ? scssClassName("components", group, variant, prefix)
                    : selectors[subsystem]?.[group]?.[variant] ?? "";
                if (name) recipes.push({ subsystem, group, variant, name });
              }
            }
          }
          return {
            format: "scss",
            summary: [
              "This theme is emitted as Sass partials: a `$`-variables layer plus recipe rules that compile to CSS classes.",
              'Pull it into your Sass entry with `@use`: `@use "theme" as *;` (or `@use "variables" as *;` for just the tokens), then compile to CSS.',
              'Apply the recipe class names below to your markup: `<button class="<class>">`. Values resolve through Sass variables (or baked literals under the `inline` option).',
            ],
            recipes,
          };
        },
        renderRecipe(subsystem, group, variant) {
          return renderRecipeFor(subsystem, group, variant, optionInline);
        },
        renderVariables(subsystem) {
          return renderVariablesFor(subsystem);
        },
        join(parts) {
          return parts.filter(Boolean).join("\n\n");
        },

        // The full document is variables-then-rules; override so the aggregate ordering is explicit.
        renderAllVariables: allVariables,
        renderAllRecipes: allRecipes,
        renderAll: allScss,

        extend() {
          return {
            media,
            get scss() {
              return wrapLayer(allScss());
            },
            get variablesScss() {
              return allVariables();
            },
            get rulesScss() {
              return allRecipes();
            },
            get classes() {
              return collectClasses();
            },
          };
        },

        emit(plan) {
          const type = plan?.type ?? "single";

          // §W9 — `layer` wraps one self-contained document; multi-file modes split the cascade.
          if (layerName && type !== "single") {
            throw new Error(
              `scss adapter: the \`layer\` option is only supported with single-file emit (got "${type}").`,
            );
          }

          if (type === "single") {
            const file = plan?.type === "single" ? plan.file : "theme.scss";
            return { files: { [scssName(file)]: wrapLayer(allScss()) } };
          }

          // Baking values leaves no `$variables` to split out — contradicts every multi-file mode.
          if (optionInline && (type === "split" || type === "subsystem")) {
            throw new Error(
              `scss adapter: emit mode '${type}' cannot be combined with the global inline option ` +
                `(inline bakes values, leaving no $variables file)`,
            );
          }

          if (plan?.type === "split") {
            // A `_variables.scss` partial + a rules file that `@use`s it (Sass module system — NOT
            // the banned `@import`), so the rules' `$dt-…` refs resolve.
            const varsFile = scssPartial(plan.variables);
            const rulesFile = scssName(plan.file);
            const rules = `@use "${useRef(varsFile)}" as *;\n\n${allRecipes()}`;
            return { files: { [rulesFile]: rules, [varsFile]: allVariables() } };
          }

          if (plan?.type === "subsystem") {
            // Per-subsystem Sass files need cross-subsystem `@use` wiring (a component `@use`s the
            // colors/typography/… partials it composes). Deferred — a clear, honest v1 boundary.
            throw new Error("scss adapter: emit mode 'subsystem' is not supported yet");
          }

          if (plan?.type === "components") {
            // Each component variant → one self-contained class (its merged declarations). `inline`
            // (default true) bakes values; `inline: false` keeps `$var` refs + a tree-shaken partial.
            const componentRuleSets = model.subsystems.components?.ruleSets ?? {};
            const inline = plan.inline;

            const filesByName: Record<string, string[]> = {};
            const referencedPaths: string[] = [];
            const seen = new Set<string>();

            for (const [group, ruleSetGroup] of Object.entries(componentRuleSets)) {
              for (const variant of Object.keys(ruleSetGroup)) {
                const merged = mergeComponentRuleSet(model, group, variant);
                const selector = `.${scssClassName("components", group, variant, prefix)}`;
                // Flatten the merged view into a rule-set shape renderRuleSet understands.
                const overrides: RuleSetOverride[] = [
                  ...Object.entries(merged.states).map(([state, declarations]) => ({ state, declarations })),
                  ...merged.responsive.map(entry => {
                    const { declarations, ...condition } = entry;
                    return { ...condition, declarations } as RuleSetOverride;
                  }),
                ];
                const rule = renderRuleSet(selector, merged.base, overrides, inline);
                const filename = scssName(plan.filename({ group, variant }));
                (filesByName[filename] ??= []).push(rule);

                if (!inline) {
                  for (const path of merged.referencedPaths) {
                    if (!seen.has(path)) {
                      seen.add(path);
                      referencedPaths.push(path);
                    }
                  }
                }
              }
            }

            const files: Record<string, string> = {};
            const usesVars = !inline && referencedPaths.length > 0 && plan.variables !== false;
            for (const [name, parts] of Object.entries(filesByName)) {
              const body = parts.join("\n\n");
              files[name] = usesVars ? `@use "${useRef(scssPartial(plan.variables as string))}" as *;\n\n${body}` : body;
            }

            // Tree-shaken variables partial — only the referenced token paths — unless `variables: false`.
            if (!inline && plan.variables !== false) {
              const lines: string[] = [];
              for (const path of referencedPaths) {
                const value = safeResolve(path) ?? tokenMap[path]?.value;
                if (value === undefined) continue;
                lines.push(`${scssVarName(path, prefix)}: ${formatTokenValue(path, value)};`);
              }
              if (lines.length) files[scssPartial(plan.variables)] = lines.join("\n");
            }

            return { files };
          }

          throw new Error(`scss adapter: emit mode '${type}' not yet implemented`);
        },
      };
    },
  };

  return defineAdapter(spec);
};
