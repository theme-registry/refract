import type { DTCGDocument, DTCGTokenType, ResolvedDTCGToken } from "./types";
import { RefractError } from "../core/errors";

const SPEC_KEYS = new Set(["$value", "$type", "$description", "$extensions", "$name"]);

const isToken = (node: unknown): boolean =>
  typeof node === "object" && node !== null && "$value" in (node as Record<string, unknown>);

/**
 * Walk a DTCG document and extract all tokens with resolved types and paths.
 * References (`{path.to.token}`) are resolved recursively.
 */
export const parseDTCGDocument = (doc: DTCGDocument): ResolvedDTCGToken[] => {
  const tokens: ResolvedDTCGToken[] = [];
  const tokensByPath = new Map<string, ResolvedDTCGToken>();

  // First pass: collect all tokens with their raw values
  const walk = (node: Record<string, unknown>, path: string[], inheritedType?: DTCGTokenType) => {
    const groupType = (node.$type as DTCGTokenType | undefined) ?? inheritedType;

    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith("$")) continue;
      if (typeof child !== "object" || child === null) continue;

      const childPath = [...path, key];

      if (isToken(child)) {
        const token = child as Record<string, unknown>;
        const resolved: ResolvedDTCGToken = {
          path: childPath,
          type: (token.$type as DTCGTokenType) ?? groupType ?? "color",
          value: token.$value,
          description: token.$description as string | undefined,
          extensions: token.$extensions as Record<string, unknown> | undefined,
        };
        tokens.push(resolved);
        tokensByPath.set(childPath.join("."), resolved);
      } else {
        walk(child as Record<string, unknown>, childPath, groupType);
      }
    }
  };

  walk(doc, []);

  // Second pass: resolve references
  for (const token of tokens) {
    token.value = resolveReferences(token.value, tokensByPath);
  }

  return tokens;
};

const REFERENCE_PATTERN = /^\{([^}]+)\}$/;

const resolveReferences = (
  value: unknown,
  tokensByPath: Map<string, ResolvedDTCGToken>,
  visited = new Set<string>(),
): unknown => {
  if (typeof value === "string") {
    const match = value.match(REFERENCE_PATTERN);
    if (match) {
      const refPath = match[1];
      if (visited.has(refPath)) {
        throw new RefractError("REFRACT_E_CYCLE", `Circular token reference: ${refPath}`);
      }
      const referenced = tokensByPath.get(refPath);
      if (!referenced) {
        return value; // unresolved reference — leave as-is
      }
      visited.add(refPath);
      return resolveReferences(referenced.value, tokensByPath, visited);
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(item => resolveReferences(item, tokensByPath, new Set(visited)));
  }

  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = resolveReferences(v, tokensByPath, new Set(visited));
    }
    return result;
  }

  return value;
};
