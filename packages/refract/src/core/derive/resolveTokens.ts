/**
 * Derivation resolver (model-first).
 *
 * Resolves a `path -> Ref` token map to concrete literals, running **value derivations** — a
 * `Ref` of the form `{ ref, fn, arg }` means `value = registry[fn](resolve(ref), arg)`. Plain
 * `{ ref }` is an alias (`= resolve(ref)`), `{ value }` is a terminal literal. Recursive (so
 * chained derivations like `darker = darken(dark)` resolve), memoized per pass, and cycle-safe.
 *
 * Subsystems contribute derivation fns (colors → `lighten`/`darken`, typography → `scale`);
 * core assembles them into one {@link DerivationRegistry}. Used by `theme.tokens` (resolved
 * view) and by the CSS adapter's lowering (concrete `:root` / inline values). See
 * `.notes/reference/derivation-resolver-and-merge.md`.
 */
import type { Literal, Ref } from "../model";
import { RefractError } from "../errors";

/** A value-derivation: derive a literal from a source literal + optional argument. */
export type DerivationFn = (value: Literal, arg?: unknown) => Literal;

/** `fn name -> DerivationFn`, assembled from the subsystems (unique names; collisions throw). */
export type DerivationRegistry = Record<string, DerivationFn>;

/** Merge subsystem derivation-fn maps into one registry; a duplicate name is a hard error. */
export const buildDerivationRegistry = (
  contributions: ReadonlyArray<Readonly<DerivationRegistry>>,
): DerivationRegistry => {
  const registry: DerivationRegistry = {};
  for (const contribution of contributions) {
    for (const [name, fn] of Object.entries(contribution)) {
      if (name in registry) {
        throw new RefractError("REFRACT_E_TOKEN_PATH", `Duplicate derivation fn "${name}" registered by two subsystems.`);
      }
      registry[name] = fn;
    }
  }
  return registry;
};

/**
 * Resolve one token `path` in `map` to a concrete literal, running any derivation. `cache` and
 * `resolving` are threaded through recursion (chaining + cycle detection); callers may omit them.
 */
export const resolveToken = (
  map: Record<string, Ref>,
  registry: DerivationRegistry,
  path: string,
  cache: Map<string, Literal> = new Map(),
  resolving: Set<string> = new Set(),
): Literal => {
  const cached = cache.get(path);
  if (cached !== undefined) return cached;

  const entry = map[path];
  if (!entry) throw new RefractError("REFRACT_E_TOKEN_PATH", `Unknown token path "${path}".`);

  // §W6b — external token: resolves to its parent-theme CSS variable, never derived.
  if (entry.external !== undefined) {
    const v = `var(${entry.external})`;
    cache.set(path, v);
    return v;
  }

  // Terminal literal — no ref to follow.
  if (entry.ref === undefined) {
    if (entry.value === undefined) {
      throw new RefractError("REFRACT_E_TOKEN_PATH", `Token "${path}" has neither "ref" nor "value".`);
    }
    cache.set(path, entry.value);
    return entry.value;
  }

  if (resolving.has(path)) {
    throw new RefractError("REFRACT_E_CYCLE", `Cyclic token reference: ${[...resolving, path].join(" -> ")}`);
  }
  resolving.add(path);
  const base = resolveToken(map, registry, entry.ref, cache, resolving);
  let result: Literal;
  if (entry.modifiers !== undefined) {
    // dec.2 — fold the ordered derivation chain over the resolved source.
    result = entry.modifiers.reduce((value, mod) => {
      const fn = registry[mod.fn];
      if (!fn) throw new RefractError("REFRACT_E_TOKEN_PATH", `Unknown derivation fn "${mod.fn}" for token "${path}".`);
      return fn(value, mod.arg);
    }, base);
  } else if (entry.fn !== undefined) {
    const fn = registry[entry.fn];
    if (!fn) throw new RefractError("REFRACT_E_TOKEN_PATH", `Unknown derivation fn "${entry.fn}" for token "${path}".`);
    result = fn(base, entry.arg);
  } else {
    result = base; // plain alias
  }
  resolving.delete(path);
  cache.set(path, result);
  return result;
};

/** Resolve every entry in a token `map` to its concrete literal (one shared memo pass). */
export const resolveTokenMap = (
  map: Record<string, Ref>,
  registry: DerivationRegistry,
): Record<string, Literal> => {
  const cache = new Map<string, Literal>();
  const out: Record<string, Literal> = {};
  for (const path of Object.keys(map)) {
    out[path] = resolveToken(map, registry, path, cache);
  }
  return out;
};
