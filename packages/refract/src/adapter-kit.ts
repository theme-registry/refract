/**
 * Uniform text-adapter naming (§17) — a single adapter-wide `prefix` (+ optional `classPrefix`
 * defaulting to it) drives every CSS variable and class name. Shared by the CSS and SC adapters so
 * the two text formats emit the SAME names from a token path — no per-subsystem infixes, no
 * per-subsystem defaults, single-dash separators. Lives at the adapters root (like `length.ts`) so
 * neither adapter depends on its sibling.
 *
 *   variable: `varNameFromPath(token, "colors.primary.dark")` → `--<token>-colors-primary-dark`
 *   class:    `recipeClassName(naming, "colors", "solid", "primary")` → `<classToken>-colors-solid-primary`
 */

import { RefractError } from "./core/errors";

/** Kebab/underscore-safe identifier segment. */
export const sanitizeSegment = (segment: string): string =>
  segment
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .toLowerCase();

/** Resolved naming tokens for one bound theme. */
export type AdapterNaming = {
  /** Leading segment of every CSS variable name (`app` → `--app-colors-primary`). */
  varToken: string;
  /** Leading segment of every class name (`app` → `app-colors-solid-primary`). */
  classToken: string;
};

/** Resolve the adapter-wide tokens: `classPrefix` falls back to `prefix`, both default to `dt`. */
export const resolveNaming = (options: { prefix?: string; classPrefix?: string }): AdapterNaming => {
  const varToken = sanitizeSegment(options.prefix ?? "dt") || "dt";
  const classToken = sanitizeSegment(options.classPrefix ?? options.prefix ?? "dt") || "dt";
  return { varToken, classToken };
};

/** A token path → its CSS variable name: `colors.primary.dark` → `--<token>-colors-primary-dark`. */
export const varNameFromPath = (varToken: string, path: string): string =>
  `--${varToken}-${path.split(".").map(sanitizeSegment).filter(Boolean).join("-")}`;

/** The recipe/rule-set identity: `<classToken>-<sub>-<group>-<variant>` (sanitized). */
export const recipeClassName = (
  naming: AdapterNaming,
  subsystem: string,
  group: string,
  variant: string,
): string =>
  [naming.classToken, subsystem, group, variant].map(sanitizeSegment).filter(Boolean).join("-");

// ---------------------------------------------------------------------------
// §7B — adapter naming-override hook
// ---------------------------------------------------------------------------

/**
 * A token path → its (possibly overridden) CSS variable name. The resolver the CSS + SC lowering
 * thread in place of a raw `varToken`, so a variable's `:root` definition and every `var(--…)`
 * usage funnel through the same (optionally overridden) name.
 */
export type VarNamer = (path: string) => string;

/**
 * Optional per-adapter formatters that swap how class + variable names are generated. Each receives
 * the structured address plus the computed built-in `name` (decorate it or replace it). Shared by
 * the two text adapters (CSS + SC); JSON keys its own way and stays out. The adapter enforces a
 * three-part contract on every result: **deterministic** (a pure fn of the address), **collision-free**
 * (distinct addresses must yield distinct names — a duplicate throws), and a **valid identifier**
 * (the result is run through {@link sanitizeSegment}).
 */
export type NamingOverrides = {
  /**
   * Remap a recipe class (`kind: "recipe"`) or a container-context utility (`kind: "container"`,
   * the `-cq-<name>` class). `address.variant` is the recipe variant, or — for a container — its
   * name. Return `defaults.name` to keep the built-in name for the kinds you don't care about.
   */
  className?(
    address: { kind: "recipe" | "container"; subsystem: string; group: string; variant: string },
    defaults: { classToken: string; name: string },
  ): string;
  /**
   * Remap a CSS variable, addressed by its dotted token `path` (and its `segments`). The returned
   * name is normalized to a valid custom property (`--` + sanitized body).
   */
  variableName?(
    address: { path: string; segments: string[] },
    defaults: { varToken: string; name: string },
  ): string;
};

/** Normalize an overridden variable name to a valid custom property: `--` + sanitized body. */
const sanitizeVarName = (name: string): string => {
  const body = sanitizeSegment(name.replace(/^-+/, ""));
  if (!body) throw new RefractError("REFRACT_E_NAMING", `naming override: variableName returned an empty/invalid name ("${name}")`);
  return `--${body}`;
};

/** The bound naming surface for one theme: the resolved tokens + the two override-aware namers. */
export interface AdapterNamer {
  readonly naming: AdapterNaming;
  /** A token path → its (possibly overridden) CSS variable name. */
  variableName: VarNamer;
  /** A recipe or container-context class → its (possibly overridden) class name. */
  className(
    kind: "recipe" | "container",
    subsystem: string,
    group: string,
    variant: string,
  ): string;
}

/**
 * Bind the resolved {@link AdapterNaming} + optional {@link NamingOverrides} into an {@link AdapterNamer}.
 * Every emitted name is collision-checked on **both** the default and the override path: two distinct
 * addresses (token paths / rule-sets) that resolve to the same output name throw a path-labelled error,
 * so a silent merge — e.g. palettes `"brand accent"` and `"brand-accent"` both sanitizing to
 * `--dt-colors-brand-accent` — fails loud instead. The SAME address re-resolving to the same name is
 * fine (definitions + usages call repeatedly). With no overrides the namer returns the built-in name
 * verbatim (byte-identical); the bookkeeping is checked but never rewrites the name.
 * The container-context class keeps its own `<classToken>-cq-<name>` default, distinct from the recipe formula.
 */
export const createNamer = (naming: AdapterNaming, overrides?: NamingOverrides): AdapterNamer => {
  const varSeen = new Map<string, string>(); // output var name → source path
  const classSeen = new Map<string, string>(); // output class name → source address key
  const hasVarOverride = !!overrides?.variableName;
  const hasClassOverride = !!overrides?.className;

  const trackVar = (name: string, path: string): void => {
    const prev = varSeen.get(name);
    if (prev !== undefined && prev !== path) {
      throw new RefractError(
        "REFRACT_E_NAMING",
        hasVarOverride
          ? `naming override: variable name "${name}" is produced by both "${prev}" and "${path}" — ` +
              `variableName must map distinct token paths to distinct names`
          : `naming collision: token paths "${prev}" and "${path}" both produce the variable name ` +
              `"${name}" — segment sanitization collapses spaces / punctuation to "-", so rename one ` +
              `so their sanitized names differ`,
      );
    }
    varSeen.set(name, path);
  };

  const trackClass = (name: string, key: string): void => {
    const prev = classSeen.get(name);
    if (prev !== undefined && prev !== key) {
      throw new RefractError(
        "REFRACT_E_NAMING",
        hasClassOverride
          ? `naming override: class name "${name}" is produced by both "${prev}" and "${key}" — ` +
              `className must map distinct rule-sets to distinct names`
          : `naming collision: rule-sets "${prev}" and "${key}" both produce the class name "${name}" — ` +
              `segment sanitization collapses spaces / punctuation to "-", so rename one so they differ`,
      );
    }
    classSeen.set(name, key);
  };

  return {
    naming,
    variableName: (path) => {
      const def = varNameFromPath(naming.varToken, path);
      if (!overrides?.variableName) {
        trackVar(def, path);
        return def;
      }
      const raw = overrides.variableName(
        { path, segments: path.split(".") },
        { varToken: naming.varToken, name: def },
      );
      const name = sanitizeVarName(raw);
      trackVar(name, path);
      return name;
    },
    className: (kind, subsystem, group, variant) => {
      const def =
        kind === "container"
          ? `${naming.classToken}-cq-${sanitizeSegment(variant)}`
          : recipeClassName(naming, subsystem, group, variant);
      const key = `${kind}:${subsystem}.${group}.${variant}`;
      if (!overrides?.className) {
        trackClass(def, key);
        return def;
      }
      const raw = overrides.className(
        { kind, subsystem, group, variant },
        { classToken: naming.classToken, name: def },
      );
      const name = sanitizeSegment(raw);
      if (!name) {
        throw new RefractError(
          "REFRACT_E_NAMING",
          `naming override: className returned an empty/invalid name for ` +
            `"${kind}:${subsystem}.${group}.${variant}"`,
        );
      }
      trackClass(name, key);
      return name;
    },
  };
};
