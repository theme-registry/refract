import type { DTCGDocument, ResolvedDTCGToken } from "./types";
import { buildDTCGGraph } from "./graph";

/**
 * Walk a DTCG document and extract all tokens with resolved types and paths — the flat view
 * `fromDTCG` maps from. References (`{path.to.token}`, JSON Pointer `$ref`) are resolved recursively.
 *
 * A view over {@link parseDTCGGraph}: values come back in the 2024-draft string form (2025.10
 * colour/dimension/duration objects serialized to `"#24348f"` / `"16px"` / `"200ms"`), and a `$root`
 * token's path ends in `"base"`, so the subsystem mapping reads it as the group's base. A token with
 * no resolvable type reads as `"color"`, as it always has here; a token whose value can't be read
 * (a colour in an unconvertible space with no `hex`) is left out. The graph's diagnostics say why.
 */
export const parseDTCGDocument = (doc: DTCGDocument): ResolvedDTCGToken[] => {
  const { graph, legacy } = buildDTCGGraph(doc);
  const tokens: ResolvedDTCGToken[] = [];
  for (const token of graph.tokens) {
    const value = legacy.get(token.id);
    if (value === undefined) continue;
    tokens.push({
      path: token.path.map(seg => (seg === "$root" ? "base" : seg)),
      type: token.type === "unknown" ? "color" : token.type,
      value,
      description: token.description,
      extensions: token.extensions as Record<string, unknown> | undefined,
    });
  }
  return tokens;
};
