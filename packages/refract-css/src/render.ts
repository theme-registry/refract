/**
 * Render the CSS adapter's `CssNode[]` IR to a CSS string, plus the enrich/split
 * helpers the delivery modes need. Ported (copy, not rewrite) from the proven
 * `core/common/{cssRenderer,cssEnrich,cssRender}.ts`, self-contained (no core imports).
 */
import type { CssKeyframesNode, CssNode, CssRuleNode, CssVariablesNode } from "./nodes";

export type RenderCssOptions = {
  indent?: string;
  newline?: string;
};

const DEFAULT_INDENT = "  ";
const DEFAULT_NEWLINE = "\n";

/**
 * Render an IR (`CssNode[]`) to a CSS string. Adjacent variable nodes sharing the same
 * `selector` + `media` merge into one block, so two subsystems that both contribute
 * `:root` variables produce one `:root { … }` block.
 */
export const renderToCssString = (nodes: CssNode[], options: RenderCssOptions = {}): string => {
  const indent = options.indent ?? DEFAULT_INDENT;
  const newline = options.newline ?? DEFAULT_NEWLINE;
  const blocks: string[] = [];

  const merged = mergeAdjacentVariableNodes(nodes);

  for (const node of merged) {
    if (node.kind === "keyframes") {
      const body = renderKeyframesBody(node, indent, newline);
      if (!body) continue;
      blocks.push(`@keyframes ${node.name} {${newline}${body}${newline}}`);
      continue;
    }

    const body =
      node.kind === "variables"
        ? renderVariableBody(node.variables, indent, newline)
        : renderRuleBody(node.declarations, indent, newline);

    if (!body) continue;

    const inner = `${node.selector} {${newline}${body}${newline}}`;
    if (node.media) {
      blocks.push(`${node.media} {${newline}${indentBlock(inner, indent, newline)}${newline}}`);
    } else {
      blocks.push(inner);
    }
  }

  return blocks.filter(Boolean).join(`${newline}${newline}`);
};

const mergeAdjacentVariableNodes = (nodes: CssNode[]): CssNode[] => {
  const keyFor = (node: CssNode): string =>
    node.kind === "variables" ? `var:${node.media ?? ""}:${node.selector}` : "";

  const output: CssNode[] = [];
  for (const node of nodes) {
    if (node.kind !== "variables") {
      output.push(node);
      continue;
    }
    const key = keyFor(node);
    const previous = output[output.length - 1];
    if (previous && previous.kind === "variables" && keyFor(previous) === key) {
      previous.variables = { ...previous.variables, ...node.variables };
    } else {
      output.push({
        kind: "variables",
        selector: node.selector,
        media: node.media,
        variables: { ...node.variables },
      });
    }
  }
  return output;
};

const renderVariableBody = (
  variables: Record<string, string>,
  indent: string,
  newline: string,
): string => {
  const entries = Object.entries(variables);
  if (!entries.length) return "";
  return entries.map(([name, value]) => `${indent}${name}: ${value};`).join(newline);
};

const renderRuleBody = (
  declarations: CssRuleNode["declarations"],
  indent: string,
  newline: string,
): string => {
  if (!declarations.length) return "";
  return declarations.map(({ property, value }) => `${indent}${property}: ${value};`).join(newline);
};

/** Render a keyframes at-rule body: one indented `<stop> { … }` block per step, in order. */
const renderKeyframesBody = (
  node: CssKeyframesNode,
  indent: string,
  newline: string,
): string => {
  const steps = node.steps
    .map(step => {
      if (!step.declarations.length) return "";
      const decls = step.declarations
        .map(({ property, value }) => `${indent}${indent}${property}: ${value};`)
        .join(newline);
      return `${indent}${step.stop} {${newline}${decls}${newline}${indent}}`;
    })
    .filter(Boolean);
  return steps.join(newline);
};

const indentBlock = (block: string, indent: string, newline: string): string =>
  block
    .split(newline)
    .map(line => (line.length ? `${indent}${line}` : line))
    .join(newline);

// ---------------------------------------------------------------------------
// split / render slices
// ---------------------------------------------------------------------------

export const splitNodes = (nodes: CssNode[]): {
  variables: CssVariablesNode[];
  rules: CssNode[];
} => {
  const variables: CssVariablesNode[] = [];
  const rules: CssNode[] = [];
  for (const node of nodes) {
    // Keyframes ride the rules stream (they are style output, never a variables block).
    if (node.kind === "variables") variables.push(node);
    else rules.push(node);
  }
  return { variables, rules };
};

export const renderVariablesCss = (nodes: CssNode[]): string =>
  renderToCssString(splitNodes(nodes).variables);

export const renderRulesCss = (nodes: CssNode[]): string =>
  renderToCssString(splitNodes(nodes).rules);

// ---------------------------------------------------------------------------
// enrich (ref / resolved) — used by inline delivery
// ---------------------------------------------------------------------------

const VAR_PATTERN = /var\((--[^)]+)\)/;

/**
 * Build the `var name → resolved literal value` map from a node set's variable blocks: direct
 * literals first, then a second pass resolving one level of `var(--…)` indirection. Shared by
 * `enrichDeclarationsWithRefs` (inline baking) and the `components` non-inline tree-shaken
 * variables file, so both source values the same way (no re-derived formatting).
 */
export const buildVariableValueMap = (nodes: CssNode[]): Map<string, string> => {
  const variableMap = new Map<string, string>();
  for (const node of nodes) {
    if (node.kind !== "variables") continue;
    for (const [name, value] of Object.entries(node.variables)) {
      if (!VAR_PATTERN.test(value)) variableMap.set(name, value);
    }
  }

  for (const node of nodes) {
    if (node.kind !== "variables") continue;
    for (const [name, value] of Object.entries(node.variables)) {
      if (variableMap.has(name)) continue;
      const match = value.match(VAR_PATTERN);
      if (match) {
        const resolved = variableMap.get(match[1]);
        if (resolved) variableMap.set(name, resolved);
      }
    }
  }

  return variableMap;
};

/**
 * Enrich `CssRuleNode` declarations with `ref` (the CSS var they reference) and `resolved`
 * (its literal value), cross-referenced against the variable nodes. Mutates in place.
 */
export const enrichDeclarationsWithRefs = (nodes: CssNode[]): void => {
  const variableMap = buildVariableValueMap(nodes);

  const enrich = (decl: CssRuleNode["declarations"][number]): void => {
    if (typeof decl.value !== "string") return;
    const match = decl.value.match(VAR_PATTERN);
    if (!match) return;
    decl.ref = match[1];
    const resolved = variableMap.get(match[1]);
    if (resolved !== undefined) decl.resolved = resolved;
  };

  for (const node of nodes) {
    if (node.kind === "keyframes") {
      for (const step of node.steps) for (const decl of step.declarations) enrich(decl);
      continue;
    }
    if (node.kind !== "rule") continue;
    for (const decl of node.declarations) enrich(decl);
  }
};
