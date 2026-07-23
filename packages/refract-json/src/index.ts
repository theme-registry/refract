/**
 * The JSON adapter — lowers the format-neutral {@link ThemeModel} to structured JSON.
 *
 * The second shipping adapter, and the proof that "one Model, many formats" is real: where the
 * CSS adapter's output unit is `string`, this adapter's is a {@link JsonDoc} object and `join`
 * is a bucket merge — the same four primitives + `defineAdapter` aggregators, a different `TUnit`.
 *
 * What it adds over the adapter-free `./dtcg` export (which is tokens-only): it lowers the FULL
 * Model — not just tokens, but rule-sets/recipes, states, responsive/container overrides,
 * composition-by-reference, and keyframes — keeping each `ref` as data alongside its resolved
 * value (exactly what CSS collapses into opaque `var(--…)` strings). That is recipes-as-data,
 * and it doubles as the Model + build-time emit path.
 *
 * Worked reference: `src/adapters/css/`. Core stays format-agnostic; all addressing, the doc IR,
 * and value resolution live here.
 */
import type { Literal, Ref, RuleSet, ThemeModel } from "@theme-registry/refract";
import { buildTokenMap, mergeComponentRuleSet } from "@theme-registry/refract";
import type { MergedRuleSet } from "@theme-registry/refract";
import type { AdapterSpec, RenderContext, ThemeAdapter, UsageDescriptor, UsageRecipe } from "@theme-registry/refract";
import { defineAdapter } from "@theme-registry/refract";
import type {
  JsonAdapterOptions,
  JsonDoc,
  JsonKeyframe,
  JsonLeaf,
  JsonOverride,
  JsonRuleSet,
  RefsMode,
} from "./types";

export type {
  JsonAdapterOptions,
  JsonContainer,
  JsonDoc,
  JsonKeyframe,
  JsonKeyframeStep,
  JsonLeaf,
  JsonOverride,
  JsonRuleSet,
  RefsMode,
} from "./types";

/** The JSON adapter's output unit — a document fragment (see {@link JsonDoc}). */
export type JsonUnit = JsonDoc;

/** Normalize an emitted filename's extension to `.json` (plan defaults are CSS-centric: `theme.css`,
 *  `variables.css`, …). Any existing extension is swapped; a bare name gains `.json`. */
const jsonName = (name: string): string =>
  name.endsWith(".json") ? name : `${name.replace(/\.[^./]+$/, "")}.json`;

export const createJsonAdapter = (options: JsonAdapterOptions = {}): ThemeAdapter<JsonUnit> => {
  const refsMode: RefsMode = options.refs ?? "both";
  const indent = options.indent ?? 2;

  const spec: AdapterSpec<JsonUnit> = {
    name: "json",
    version: 1,
    // No `allowedStates`: JSON renders any state name as a data key — it owns no selector knowledge
    // (contrast the CSS adapter's CSS_KNOWN_STATES). Core then does no state validation for this adapter.
    bind(model: ThemeModel, ctx: RenderContext) {
      const { media, resolve } = ctx;
      // The flat `path -> Ref` token map (base + variants + extras), shared by the tokens bucket,
      // renderVariables, and the components tree-shake — the same map that backs `theme.tokens`.
      const tokenMap = buildTokenMap(model);

      const stringify = (doc: JsonDoc): string => JSON.stringify(doc, null, indent);

      /** Resolve a token path to its literal, swallowing a resolver throw (defensive — a well-formed
       *  Model resolves everything; falls back to the Ref's cached `value`). */
      const safeResolve = (path: string): Literal | undefined => {
        try {
          return resolve(path);
        } catch {
          return undefined;
        }
      };

      /** Build a leaf from a `Ref` + its already-resolved literal, honoring the ref mode. */
      const buildLeaf = (ref: Ref, value: Literal | undefined, mode: RefsMode): JsonLeaf => {
        const leaf: JsonLeaf = {};
        const hasRef = ref.ref !== undefined;
        if (mode !== "value" && hasRef) {
          leaf.ref = ref.ref;
          if (ref.fn !== undefined) leaf.fn = ref.fn;
          if (ref.arg !== undefined) leaf.arg = ref.arg;
        }
        if (mode !== "value" && ref.wrap !== undefined) leaf.wrap = ref.wrap;
        if (ref.external !== undefined) leaf.external = ref.external; // §W6b — parent-var passthrough
        // `value` in both/value modes; in path mode only for a literal (no ref to stand in for it).
        if ((mode !== "path" || !hasRef) && value !== undefined) leaf.value = value;
        // §15: a structured (shadow/transition) value carries as data — the format-neutral shape a
        // future RN adapter lowers; its per-layer `color` stays a `colors.*` ref for the consumer.
        if (ref.struct !== undefined) leaf.struct = ref.struct;
        return leaf;
      };

      /** A token leaf — resolved by the token's OWN address (its `Ref.ref`, if any, is a derivation source). */
      const tokenLeaf = (path: string, ref: Ref, mode: RefsMode): JsonLeaf =>
        buildLeaf(ref, safeResolve(path) ?? ref.value, mode);

      /** A declaration leaf — resolved by the path its `Ref.ref` points at (literal ⇒ its `value`).
       *  §15: when the ref points at a STRUCTURED (shadow/transition) token — which has no single
       *  literal to bake — the leaf carries that token's `struct` (its per-layer `color` stays a
       *  `colors.*` ref for the consumer), so an inline declaration isn't left value-less. */
      const declLeaf = (ref: Ref, mode: RefsMode): JsonLeaf => {
        const value = ref.ref !== undefined ? safeResolve(ref.ref) ?? ref.value : ref.value;
        const leaf = buildLeaf(ref, value, mode);
        // Only when the `ref` was baked away (inline `value` mode) and no literal resulted — otherwise
        // the retained `ref` already leads the consumer to the token that carries the struct.
        if (leaf.ref === undefined && leaf.value === undefined && leaf.struct === undefined && ref.ref !== undefined) {
          const target = tokenMap[ref.ref];
          if (target?.struct !== undefined) leaf.struct = target.struct;
        }
        return leaf;
      };

      const mapDecls = (decls: Record<string, Ref>, mode: RefsMode): Record<string, JsonLeaf> => {
        const out: Record<string, JsonLeaf> = {};
        for (const [prop, ref] of Object.entries(decls)) out[prop] = declLeaf(ref, mode);
        return out;
      };

      /** Copy the present condition axes off a Model override/entry onto a JSON override. */
      const copyCondition = (
        src: {
          state?: string;
          breakpoint?: string;
          query?: JsonOverride["query"];
          orientation?: JsonOverride["orientation"];
          container?: string;
          size?: string;
          variant?: string;
          target?: string;
        },
        dst: JsonOverride,
      ): void => {
        if (src.state !== undefined) dst.state = src.state;
        if (src.breakpoint !== undefined) dst.breakpoint = src.breakpoint;
        if (src.query !== undefined) dst.query = src.query;
        if (src.orientation !== undefined) dst.orientation = src.orientation;
        if (src.container !== undefined) dst.container = src.container;
        if (src.size !== undefined) dst.size = src.size;
        if (src.variant !== undefined) dst.variant = src.variant;
        if (src.target !== undefined) dst.target = src.target;
      };

      // Assemble a rule-set with a readable key order: kind / selector / references first, then
      // declarations / overrides (independent of the Model's property insertion order).
      const assembleRuleSet = (
        head: Pick<JsonRuleSet, "kind" | "selector" | "references">,
        declarations: Record<string, JsonLeaf>,
        overrides: JsonOverride[],
      ): JsonRuleSet => {
        const out = {} as JsonRuleSet;
        if (head.kind) out.kind = head.kind;
        if (head.selector !== undefined) out.selector = head.selector;
        if (head.references && head.references.length) out.references = head.references;
        out.declarations = declarations;
        out.overrides = overrides;
        return out;
      };

      const overridesToJson = (list: RuleSet["overrides"], mode: RefsMode): JsonOverride[] => {
        const overrides: JsonOverride[] = [];
        for (const ov of list) {
          const jo = {} as JsonOverride; // condition axes first, then declarations (readability)
          copyCondition(ov, jo);
          jo.declarations = ov.declarations ? mapDecls(ov.declarations, mode) : {};
          overrides.push(jo);
        }
        return overrides;
      };

      const ruleSetToJson = (rs: RuleSet, mode: RefsMode): JsonRuleSet => {
        const out = assembleRuleSet(
          { kind: rs.kind, selector: rs.selector, references: rs.references ? [...rs.references] : undefined },
          mapDecls(rs.declarations, mode),
          overridesToJson(rs.overrides, mode),
        );
        // §9: globals element variants (delta-only modifiers) survive as data.
        if (rs.variants && Object.keys(rs.variants).length) {
          out.variants = Object.fromEntries(
            Object.entries(rs.variants).map(([name, v]) => [
              name,
              { declarations: mapDecls(v.declarations, mode), overrides: overridesToJson(v.overrides, mode) },
            ]),
          );
        }
        return out;
      };

      const keyframeToJson = (kf: { steps: { stop: string; declarations: Record<string, Ref> }[] }, mode: RefsMode): JsonKeyframe => ({
        steps: kf.steps.map(s => ({ stop: s.stop, declarations: mapDecls(s.declarations, mode) })),
      });

      /** A merged component variant (`mergeComponentRuleSet`) → one self-contained JSON rule-set. */
      const mergedToJson = (merged: MergedRuleSet, mode: RefsMode): JsonRuleSet => {
        const out: JsonRuleSet = { kind: "recipe", declarations: mapDecls(merged.base, mode), overrides: [] };
        for (const [state, decls] of Object.entries(merged.states)) {
          out.overrides.push({ state, declarations: mapDecls(decls, mode) });
        }
        for (const entry of merged.responsive) {
          const jo = {} as JsonOverride;
          copyCondition(entry, jo);
          jo.declarations = mapDecls(entry.declarations, mode);
          out.overrides.push(jo);
        }
        return out;
      };

      // ── Bucket builders (each a flat address-keyed map; every full-doc consumer composes these) ──
      const buildTokensBucket = (subsystem?: string): Record<string, JsonLeaf> => {
        const prefix = subsystem !== undefined ? `${subsystem}.` : "";
        const tokens: Record<string, JsonLeaf> = {};
        for (const [path, ref] of Object.entries(tokenMap)) {
          if (subsystem !== undefined && !path.startsWith(prefix)) continue;
          tokens[path] = tokenLeaf(path, ref, refsMode);
        }
        return tokens;
      };

      const buildRuleSetsBucket = (subsystem?: string): Record<string, JsonRuleSet> => {
        const ruleSets: Record<string, JsonRuleSet> = {};
        for (const [sub, subModel] of Object.entries(model.subsystems)) {
          if (subsystem !== undefined && sub !== subsystem) continue;
          for (const [group, rsGroup] of Object.entries(subModel.ruleSets ?? {})) {
            for (const [variant, rs] of Object.entries(rsGroup)) {
              ruleSets[`${sub}.${group}.${variant}`] = ruleSetToJson(rs, refsMode);
            }
          }
        }
        return ruleSets;
      };

      const buildKeyframesBucket = (subsystem?: string): Record<string, JsonKeyframe> => {
        const keyframes: Record<string, JsonKeyframe> = {};
        for (const [sub, subModel] of Object.entries(model.subsystems)) {
          if (subsystem !== undefined && sub !== subsystem) continue;
          for (const [name, kf] of Object.entries(subModel.keyframes ?? {})) {
            keyframes[`${sub}.${name}`] = keyframeToJson(kf, refsMode);
          }
        }
        return keyframes;
      };

      const buildContainersBucket = (): JsonDoc["containers"] => {
        if (!model.containers || !Object.keys(model.containers).length) return undefined;
        const out: NonNullable<JsonDoc["containers"]> = {};
        for (const [name, c] of Object.entries(model.containers)) out[name] = { type: c.type, sizes: { ...c.sizes } };
        return out;
      };

      /** The whole theme as one document — the JSON analogue of the CSS adapter's `collectNodes()`. */
      const buildDoc = (): JsonDoc => {
        const doc: JsonDoc = { breakpoints: { ...model.breakpoints } };
        const containers = buildContainersBucket();
        if (containers) doc.containers = containers;
        const tokens = buildTokensBucket();
        if (Object.keys(tokens).length) doc.tokens = tokens;
        const ruleSets = buildRuleSetsBucket();
        if (Object.keys(ruleSets).length) doc.ruleSets = ruleSets;
        const keyframes = buildKeyframesBucket();
        if (Object.keys(keyframes).length) doc.keyframes = keyframes;
        return doc;
      };

      const hasContent = (doc: JsonDoc): boolean => Object.keys(doc).length > 0;

      const join = (parts: JsonDoc[]): JsonDoc => {
        const out: JsonDoc = {};
        for (const p of parts) {
          if (p.breakpoints) out.breakpoints = { ...out.breakpoints, ...p.breakpoints };
          if (p.containers) out.containers = { ...out.containers, ...p.containers };
          if (p.tokens) out.tokens = { ...out.tokens, ...p.tokens };
          if (p.ruleSets) out.ruleSets = { ...out.ruleSets, ...p.ruleSets };
          if (p.keyframes) out.keyframes = { ...out.keyframes, ...p.keyframes };
        }
        return out;
      };

      return {
        recipeName(subsystem, group, variant) {
          return `${subsystem}.${group}.${variant}`;
        },

        // Self-documentation: every recipe's dotted key under `ruleSets`, plus framework-neutral
        // "read the data" prose for the emitted guide (llms.txt).
        describeUsage(): UsageDescriptor {
          const recipes: UsageRecipe[] = [];
          for (const [subsystem, sub] of Object.entries(model.subsystems)) {
            for (const [group, ruleSetGroup] of Object.entries(sub.ruleSets ?? {})) {
              for (const variant of Object.keys(ruleSetGroup)) {
                recipes.push({ subsystem, group, variant, name: `${subsystem}.${group}.${variant}` });
              }
            }
          }
          return {
            format: "json",
            summary: [
              "This theme is emitted as a JSON document: a `tokens` bucket (the theme's values) plus a `ruleSets` map (the recipes), each keyed by `subsystem.group.variant`.",
              'Load it in any language or tool: `import theme from "./theme.json"` (or `require`). It carries no framework binding — read the token values and recipe declarations directly.',
              "Each recipe below is addressed by its dotted key under `ruleSets`; token paths follow the same `subsystem.group.variant` convention.",
            ],
            recipes,
          };
        },
        renderRecipe(subsystem, group, variant) {
          const rs = model.subsystems[subsystem]?.ruleSets?.[group]?.[variant];
          if (!rs) return {};
          return { ruleSets: { [`${subsystem}.${group}.${variant}`]: ruleSetToJson(rs, refsMode) } };
        },
        renderVariables(subsystem) {
          const tokens = buildTokensBucket(subsystem);
          return Object.keys(tokens).length ? { tokens } : {};
        },
        join,

        // Aggregators overridden (like the CSS adapter): the full doc is not a flat concat of the
        // primitives — the theme-global breakpoints/containers + keyframes land here.
        renderAllVariables(): JsonDoc {
          const doc: JsonDoc = { breakpoints: { ...model.breakpoints } };
          const containers = buildContainersBucket();
          if (containers) doc.containers = containers;
          const tokens = buildTokensBucket();
          if (Object.keys(tokens).length) doc.tokens = tokens;
          return doc;
        },
        renderAllRecipes(): JsonDoc {
          const doc: JsonDoc = {};
          const ruleSets = buildRuleSetsBucket();
          if (Object.keys(ruleSets).length) doc.ruleSets = ruleSets;
          const keyframes = buildKeyframesBucket();
          if (Object.keys(keyframes).length) doc.keyframes = keyframes;
          return doc;
        },
        renderAll: buildDoc,

        // Runtime surface: the doc object + its pretty string, plus the plain media descriptor
        // pass-through (mirrors how the CSS adapter surfaces `theme.css` + `theme.media`).
        extend() {
          return {
            media,
            get json(): JsonDoc {
              return buildDoc();
            },
            get jsonString(): string {
              return stringify(buildDoc());
            },
          };
        },

        // Build-time emit — the §9 output-shape vocabulary mapped onto the doc's buckets. Plan filenames
        // are normalized to a `.json` extension (the shared plan defaults name `.css` files).
        emit(plan) {
          const type = plan?.type ?? "single";

          if (type === "single") {
            const file = plan?.type === "single" ? plan.file : "theme.json";
            return { files: { [jsonName(file)]: stringify(buildDoc()) } };
          }

          if (plan?.type === "split") {
            // Two docs under a load-order-free contract: rule-sets/keyframes vs tokens/config.
            const doc = buildDoc();
            const stylesDoc: JsonDoc = {};
            if (doc.ruleSets) stylesDoc.ruleSets = doc.ruleSets;
            if (doc.keyframes) stylesDoc.keyframes = doc.keyframes;
            const varsDoc: JsonDoc = {};
            if (doc.breakpoints) varsDoc.breakpoints = doc.breakpoints;
            if (doc.containers) varsDoc.containers = doc.containers;
            if (doc.tokens) varsDoc.tokens = doc.tokens;
            return {
              files: { [jsonName(plan.file)]: stringify(stylesDoc), [jsonName(plan.variables)]: stringify(varsDoc) },
            };
          }

          if (plan?.type === "subsystem") {
            // One pair of docs per subsystem — its tokens (variables side) + its rule-sets/keyframes
            // (styles side). Global breakpoints/containers are theme-level, not per-subsystem, so they
            // don't appear here (like CSS `@media` breakpoints, they only surface inside overrides).
            // Skip empties — the components subsystem owns no tokens → styles file only.
            const files: Record<string, string> = {};
            for (const sub of Object.keys(model.subsystems)) {
              const tokens = buildTokensBucket(sub);
              if (Object.keys(tokens).length) files[jsonName(plan.filename(sub, "variables"))] = stringify({ tokens });

              const stylesDoc: JsonDoc = {};
              const ruleSets = buildRuleSetsBucket(sub);
              if (Object.keys(ruleSets).length) stylesDoc.ruleSets = ruleSets;
              const keyframes = buildKeyframesBucket(sub);
              if (Object.keys(keyframes).length) stylesDoc.keyframes = keyframes;
              if (hasContent(stylesDoc)) files[jsonName(plan.filename(sub, "styles"))] = stringify(stylesDoc);
            }
            return { files };
          }

          if (plan?.type === "components") {
            // The flattened/merged export: each component variant → one self-contained rule-set
            // (`mergeComponentRuleSet`). `inline` (default true) resolves values and drops refs;
            // `inline: false` keeps refs + a tree-shaken tokens file of only the referenced paths.
            const componentRuleSets = model.subsystems.components?.ruleSets ?? {};
            const leafMode: RefsMode = plan.inline ? "value" : "both";

            const filesByName: Record<string, Record<string, JsonRuleSet>> = {};
            const referencedPaths: string[] = [];
            const seen = new Set<string>();

            for (const [group, ruleSetGroup] of Object.entries(componentRuleSets)) {
              for (const variant of Object.keys(ruleSetGroup)) {
                const merged = mergeComponentRuleSet(model, group, variant);
                const filename = jsonName(plan.filename({ group, variant }));
                (filesByName[filename] ??= {})[`components.${group}.${variant}`] = mergedToJson(merged, leafMode);

                if (!plan.inline) {
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
            for (const [name, ruleSets] of Object.entries(filesByName)) files[name] = stringify({ ruleSets });

            // Tree-shaken tokens file — only the referenced paths — unless `variables: false`.
            if (!plan.inline && plan.variables !== false) {
              const tokens: Record<string, JsonLeaf> = {};
              for (const path of referencedPaths) {
                const ref = tokenMap[path];
                if (ref) tokens[path] = tokenLeaf(path, ref, "both");
              }
              if (Object.keys(tokens).length) files[jsonName(plan.variables)] = stringify({ tokens });
            }

            return { files };
          }

          throw new Error(`json adapter: emit mode '${type}' not yet implemented`);
        },
      };
    },
  };

  return defineAdapter(spec);
};
