/**
 * The shared recipe renderer (§8) — one lowering, two sinks.
 *
 * A recipe {@link RuleSet} lowers to a format-neutral node tree ({@link RecipeNode}) — base
 * declarations, composition spreads, state / breakpoint / colour-scheme conditional blocks — that
 * BOTH sinks walk:
 *  - **`recipeSource`** serializes it to `css\`…\`` **source** (`${({ theme }) => theme.…}` value
 *    reads, `${sibling}` composition spreads, `theme.media` / `theme.scheme` tagged-template blocks)
 *    for `emit()`.
 *  - **`recipePlainCss`** renders it to a **live CSS string** off a runtime theme object (values
 *    resolved from `props.theme`, breakpoints as concrete `@media`, dark as `prefers-color-scheme` /
 *    `[data-theme]`) — the body of a lazy `css` block for the runtime surface.
 *
 * Values read from the theme, never `var()`; dark mode lives *in the recipe block* (§10.3), so it
 * tree-shakes with the recipe and switches with a plain CSS recalc — no `:root`, no provider swap.
 */
import type { MediaDescriptor, MediaVariant } from "@theme-registry/refract";
import type { Ref, RuleSet, RuleSetGroup, ThemeModel } from "@theme-registry/refract";
import { SC_STATE_SELECTORS, orderStateOverrides, resolveMediaQuery, DEFAULT_MEDIA_QUERY } from "./lowering";
import { themeAccess } from "./identifiers";
import type { ThemeData } from "./theme-object";

/** How `model.modes` are realized into a recipe (§8): OS media, a `[data-theme]` toggle, or both. */
export type SchemeOption = "media" | "attribute" | "both";

// ---------------------------------------------------------------------------
// Node tree (the shared lowering)
// ---------------------------------------------------------------------------

/** One fragment of a declaration value: literal text, a theme token read, or an appearance-mode read. */
type Fragment =
  | { lit: string }
  | { ref: string }
  | { modeRef: { mode: string; path: string } };

type RecipeNode =
  | { type: "decl"; property: string; value: Fragment[] }
  /** A nested selector block (`&:hover`, `[data-theme="dark"] &`) — arrow-form value reads. */
  | { type: "block"; selector: string; children: RecipeNode[] }
  /** A breakpoint block realized via `theme.media.<bp>.<query>` (captured-form reads inside). */
  | { type: "media"; breakpoint: string; query: MediaVariant; orientation?: "landscape" | "portrait"; children: RecipeNode[] }
  /** A colour-scheme block realized via `theme.scheme.<mode>` (captured-form reads inside). */
  | { type: "scheme"; mode: string; children: RecipeNode[] }
  /** A composition spread of a sibling recipe (`${componentsButtonsPrimary}` / inline its CSS). */
  | { type: "spread"; subsystem: string; group: string; variant: string };

/** Context threaded into the IR builder + both sinks. */
export interface RecipeContext {
  readonly model: ThemeModel;
  readonly media: MediaDescriptor<string>;
  readonly data: ThemeData;
  readonly scheme: SchemeOption;
  /** The concrete `@media (prefers-color-scheme: <mode>)` string per realizable mode. */
  readonly prefers: Record<string, string>;
}

const str = (value: unknown): string => (value == null ? "" : String(value));

/** A rule-set declaration `Ref` → its value fragments. Returns `undefined` to SKIP the declaration
 *  (a structured token the theme object doesn't carry). A literal is emitted as-is; a token ref (with
 *  optional adapter `wrap`, e.g. `blur(…)`) becomes a theme read. */
const refFragments = (ref: Ref, data: ThemeData): Fragment[] | undefined => {
  if (ref.ref === undefined) return [{ lit: str(ref.value) }];
  if (!data.tokenPaths.has(ref.ref)) return undefined; // structured / absent token — deferred
  const read: Fragment = { ref: ref.ref };
  return ref.wrap ? [{ lit: `${ref.wrap}(` }, read, { lit: ")" }] : [read];
};

const declNodes = (declarations: Record<string, Ref> | undefined, data: ThemeData): RecipeNode[] => {
  const nodes: RecipeNode[] = [];
  for (const [property, ref] of Object.entries(declarations ?? {})) {
    const value = refFragments(ref, data);
    if (value) nodes.push({ type: "decl", property, value });
  }
  return nodes;
};

/** Parse a component composition reference (`"colors:solid.primary"`) into its address. */
const parseReference = (
  reference: string,
): { subsystem: string; group: string; variant: string } | undefined => {
  const [subsystem, rest] = reference.split(":");
  if (!subsystem || !rest) return undefined;
  const dot = rest.indexOf(".");
  if (dot < 0) return undefined;
  return { subsystem, group: rest.slice(0, dot), variant: rest.slice(dot + 1) };
};

/** Which realizations (media / attribute) a mode uses under the current `scheme` option. Only `dark`
 *  / `light` can ride `prefers-color-scheme`; any other named mode falls back to `[data-theme]`. */
const schemeRealizations = (mode: string, scheme: SchemeOption): { media: boolean; attribute: boolean } => {
  const mediaEligible = mode === "dark" || mode === "light";
  const media = mediaEligible && (scheme === "media" || scheme === "both");
  const attribute =
    scheme === "attribute" || scheme === "both" || (scheme === "media" && !mediaEligible);
  return { media, attribute };
};

/** Mode-override declarations for a set of declarations, reading `theme.modes.<mode>.…`. */
const modeDeclNodes = (
  declarations: Record<string, Ref> | undefined,
  mode: string,
  data: ThemeData,
): RecipeNode[] => {
  const overridden = data.modeOverridePaths[mode];
  if (!overridden) return [];
  const nodes: RecipeNode[] = [];
  for (const [property, ref] of Object.entries(declarations ?? {})) {
    if (ref.ref !== undefined && overridden.has(ref.ref)) {
      nodes.push({ type: "decl", property, value: [{ modeRef: { mode, path: ref.ref } }] });
    }
  }
  return nodes;
};

/**
 * Lower one recipe {@link RuleSet} (+ optional composition `references`) to the shared node tree:
 * spreads → base declarations → breakpoint blocks → state blocks → colour-scheme blocks.
 */
export const buildRecipeIR = (ruleSet: RuleSet, ctx: RecipeContext): RecipeNode[] => {
  const nodes: RecipeNode[] = [];

  // Composition (components): spread each referenced sibling recipe first.
  for (const reference of ruleSet.references ?? []) {
    const parsed = parseReference(reference);
    if (parsed) nodes.push({ type: "spread", ...parsed });
  }

  // Base declarations.
  nodes.push(...declNodes(ruleSet.declarations, ctx.data));

  // Breakpoint-only overrides → a media block.
  for (const override of ruleSet.overrides) {
    if (override.state !== undefined || !override.breakpoint) continue;
    const children = declNodes(override.declarations, ctx.data);
    if (children.length) {
      nodes.push({
        type: "media",
        breakpoint: override.breakpoint,
        query: (override.query ?? DEFAULT_MEDIA_QUERY) as MediaVariant,
        orientation: override.orientation,
        children,
      });
    }
  }

  // State (+ state×breakpoint) overrides → a `&:hover`-style block, canonical LVHA order.
  const stateOverrides = ruleSet.overrides.filter(o => o.state !== undefined);
  for (const override of orderStateOverrides(stateOverrides)) {
    const stateSelector = SC_STATE_SELECTORS[override.state as string];
    const children = declNodes(override.declarations, ctx.data);
    if (!stateSelector || !children.length) continue;
    const block: RecipeNode = { type: "block", selector: `&${stateSelector}`, children };
    if (override.breakpoint) {
      nodes.push({
        type: "media",
        breakpoint: override.breakpoint,
        query: (override.query ?? DEFAULT_MEDIA_QUERY) as MediaVariant,
        orientation: override.orientation,
        children: [block],
      });
    } else {
      nodes.push(block);
    }
  }

  // Colour-scheme blocks (§10.3) — one per mode whose fields this recipe reads.
  for (const mode of ctx.data.modeNames) {
    const baseMode = modeDeclNodes(ruleSet.declarations, mode, ctx.data);
    const stateModeBlocks: RecipeNode[] = [];
    for (const override of orderStateOverrides(stateOverrides)) {
      const stateSelector = SC_STATE_SELECTORS[override.state as string];
      if (!stateSelector) continue;
      const children = modeDeclNodes(override.declarations, mode, ctx.data);
      if (children.length) stateModeBlocks.push({ type: "block", selector: `&${stateSelector}`, children });
    }
    const children = [...baseMode, ...stateModeBlocks];
    if (!children.length) continue;

    const { media, attribute } = schemeRealizations(mode, ctx.scheme);
    if (media) nodes.push({ type: "scheme", mode, children });
    if (attribute) nodes.push({ type: "block", selector: `[data-theme="${mode}"] &`, children });
  }

  return nodes;
};

/**
 * Lower the `globals` subsystem's rule-sets (§9) into `block` nodes for the `GlobalStyle` — one raw
 * `<selector> { … }` per rule-set. Two kinds:
 *  - `kind:"reset"` (preset `static` / `defaults`) — declaration-only (literals as-is, token refs as
 *    theme reads).
 *  - `kind:"globals"` (themed `elements`) — the element's base declarations PLUS its state/breakpoint/
 *    colour-scheme blocks (via {@link buildRecipeIR}) and each delta-only variant nested as a
 *    `&.<variant>` block. Dark rides the referenced token's own modes — realized *inside* the element
 *    block as a `theme.scheme.<mode>` / `[data-theme]` conditional (same as recipes), no `:root`.
 * Feeds the `GlobalStyle` emitter + the runtime `GlobalStyle`.
 */
export const buildGlobalsIR = (
  groups: Record<string, RuleSetGroup> | undefined,
  ctx: RecipeContext,
): RecipeNode[] => {
  const nodes: RecipeNode[] = [];
  for (const group of Object.values(groups ?? {})) {
    for (const ruleSet of Object.values(group)) {
      if (!ruleSet.selector) continue;
      if (ruleSet.kind === "globals") {
        const children = buildRecipeIR(ruleSet, ctx);
        for (const [variantName, variant] of Object.entries(ruleSet.variants ?? {})) {
          const variantRuleSet: RuleSet = {
            kind: "globals",
            selector: ruleSet.selector,
            declarations: variant.declarations,
            overrides: variant.overrides,
          };
          const variantChildren = buildRecipeIR(variantRuleSet, ctx);
          if (variantChildren.length) {
            children.push({ type: "block", selector: `&.${variantName}`, children: variantChildren });
          }
        }
        if (children.length) nodes.push({ type: "block", selector: ruleSet.selector, children });
      } else {
        const children = declNodes(ruleSet.declarations, ctx.data);
        if (children.length) nodes.push({ type: "block", selector: ruleSet.selector, children });
      }
    }
  }
  return nodes;
};

// ---------------------------------------------------------------------------
// Sink 1 — source serialization (emit)
// ---------------------------------------------------------------------------

const INDENT = "  ";

/** A theme read `theme.<subsystem>.<key>` (optionally under `modes.<mode>`). */
const accessExpr = (path: string, mode?: string): string => {
  const { subsystem, key } = themeAccess(path);
  return mode ? `theme.modes.${mode}.${subsystem}.${key}` : `theme.${subsystem}.${key}`;
};

/** Serialize one declaration's value fragments. `captured` = inside a media/scheme tagged template
 *  (the outer arrow already bound `theme`, so reads are bare `${theme.…}` not `${({theme})=>…}`). */
const fragmentsSource = (fragments: Fragment[], captured: boolean): string =>
  fragments
    .map(fragment => {
      if ("lit" in fragment) return fragment.lit;
      const expr = "ref" in fragment ? accessExpr(fragment.ref) : accessExpr(fragment.modeRef.path, fragment.modeRef.mode);
      return captured ? `\${${expr}}` : `\${({ theme }) => ${expr}}`;
    })
    .join("");

interface SourceOptions {
  /** The export identifier for a spread reference (`components`,`buttons`,`primary` → `componentsButtonsPrimary`). */
  spreadName(subsystem: string, group: string, variant: string): string;
}

const nodeSource = (node: RecipeNode, indent: string, captured: boolean, opts: SourceOptions): string => {
  switch (node.type) {
    case "decl":
      return `${indent}${node.property}: ${fragmentsSource(node.value, captured)};`;
    case "spread":
      return `${indent}\${${opts.spreadName(node.subsystem, node.group, node.variant)}}`;
    case "block": {
      const inner = node.children.map(c => nodeSource(c, indent + INDENT, captured, opts)).join("\n");
      return `${indent}${node.selector} {\n${inner}\n${indent}}`;
    }
    case "media": {
      const target = node.orientation
        ? `theme.media.${node.query}(${JSON.stringify(node.breakpoint)}, { orientation: ${JSON.stringify(node.orientation)} })`
        : `theme.media.${node.breakpoint}.${node.query}`;
      const inner = node.children.map(c => nodeSource(c, indent + INDENT, true, opts)).join("\n");
      return `${indent}\${({ theme }) => ${target}\`\n${inner}\n${indent}\`}`;
    }
    case "scheme": {
      const inner = node.children.map(c => nodeSource(c, indent + INDENT, true, opts)).join("\n");
      return `${indent}\${({ theme }) => theme.scheme.${node.mode}\`\n${inner}\n${indent}\`}`;
    }
  }
};

/** Serialize a recipe's node tree to the body of a `css\`…\`` template (2-space indented). */
export const recipeSource = (nodes: RecipeNode[], opts: SourceOptions): string =>
  nodes.map(node => nodeSource(node, INDENT, false, opts)).join("\n");

// ---------------------------------------------------------------------------
// Sink 2 — live plain-CSS rendering (runtime)
// ---------------------------------------------------------------------------

/** Read a value off the runtime theme object: `theme[subsystem][key]` (optionally under `modes.<mode>`). */
const readTheme = (theme: Record<string, any>, path: string, mode?: string): unknown => {
  const { subsystem, key } = themeAccess(path);
  const root = mode ? theme?.modes?.[mode] : theme;
  return root?.[subsystem]?.[key];
};

const fragmentsValue = (fragments: Fragment[], theme: Record<string, any>): string =>
  fragments
    .map(fragment => {
      if ("lit" in fragment) return fragment.lit;
      if ("ref" in fragment) return str(readTheme(theme, fragment.ref));
      return str(readTheme(theme, fragment.modeRef.path, fragment.modeRef.mode));
    })
    .join("");

/** Resolve a sibling recipe's live CSS (composition) — injected by the adapter's lazy registry. */
export type SpreadRenderer = (
  subsystem: string,
  group: string,
  variant: string,
  theme: Record<string, any>,
) => string;

const nodePlainCss = (
  node: RecipeNode,
  theme: Record<string, any>,
  ctx: RecipeContext,
  spread: SpreadRenderer,
): string => {
  switch (node.type) {
    case "decl":
      return `${node.property}: ${fragmentsValue(node.value, theme)};`;
    case "spread":
      return spread(node.subsystem, node.group, node.variant, theme);
    case "block": {
      const inner = node.children.map(c => nodePlainCss(c, theme, ctx, spread)).join(" ");
      return `${node.selector} { ${inner} }`;
    }
    case "media": {
      const query = resolveMediaQuery(ctx.media, node.breakpoint, node.query, node.orientation);
      const inner = node.children.map(c => nodePlainCss(c, theme, ctx, spread)).join(" ");
      return query ? `${query} { ${inner} }` : inner;
    }
    case "scheme": {
      const query = ctx.prefers[node.mode] ?? "";
      const inner = node.children.map(c => nodePlainCss(c, theme, ctx, spread)).join(" ");
      return query ? `${query} { ${inner} }` : inner;
    }
  }
};

/** Render a recipe's node tree to a live CSS string off a runtime theme object. */
export const recipePlainCss = (
  nodes: RecipeNode[],
  theme: Record<string, any>,
  ctx: RecipeContext,
  spread: SpreadRenderer,
): string => nodes.map(node => nodePlainCss(node, theme, ctx, spread)).join("\n");
