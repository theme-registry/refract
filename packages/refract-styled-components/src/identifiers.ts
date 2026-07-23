/**
 * JS-identifier naming for the styled-components TS/JS emit (§8).
 *
 * The SC target emits a **literal theme object** and **flat `css` recipe consts**, so its names are
 * JavaScript identifiers, not CSS variables/classes. This module is the SC analogue of the shared
 * `../naming` namer: it reuses that module's `sanitizeSegment` + collision-guard discipline (§7B) but
 * produces a **camelCase identifier form** instead of a kebab class/var.
 *
 *   theme key:     `themeKey(["primary", "text"])`         → `primaryText`   (folds a variant/extra
 *                                                            into its group under `theme.<subsystem>`)
 *   theme access:  `themeAccess("colors.primary.text")`    → `{ subsystem: "colors", key: "primaryText" }`
 *   recipe export: `recipeExportName("components","buttons","primary")` → `componentsButtonsPrimary`
 *
 * Unlike the CSS/SC class names, SC identifiers carry **no prefix** (the artifact's `colorsSolidPrimary`,
 * not `dtColorsSolidPrimary`) — the literal theme object *is* the isolation boundary. The §7B
 * `naming.className` override still remaps a recipe's identity (its export name); `naming.variableName`
 * has no coherent target on a nested object and is accepted-but-structural (theme keys stay derived).
 */
import type { NamingOverrides } from "@theme-registry/refract/adapter-kit";

/** Split an authored segment into alphanumeric words (`"button-lg"` → `["button","lg"]`). Interior
 *  case is preserved so an already-camelCase property (`fontSize`) survives as one word. */
const splitWords = (segment: string): string[] => segment.split(/[^a-zA-Z0-9]+/).filter(Boolean);

const lowerFirst = (word: string): string => word.charAt(0).toLowerCase() + word.slice(1);
const upperFirst = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * camelCase-join a list of address segments into one identifier: the first word lower-cased, every
 * later word upper-cased and concatenated. A leading digit (invalid identifier start) is prefixed `_`.
 */
export const camelJoin = (segments: string[]): string => {
  const words = segments.flatMap(splitWords);
  if (!words.length) return "_";
  const joined = words.map((w, i) => (i === 0 ? lowerFirst(w) : upperFirst(w))).join("");
  return /^[0-9]/.test(joined) ? `_${joined}` : joined;
};

/** A token's key under `theme.<subsystem>` — the property + its variant/extra segments camel-folded. */
export const themeKey = (segmentsAfterSubsystem: string[]): string => camelJoin(segmentsAfterSubsystem);

/** A dotted token path → its `theme.<subsystem>.<key>` address parts. `colors.primary.text` →
 *  `{ subsystem: "colors", key: "primaryText" }`; `borders.radius` → `{ subsystem: "borders", key: "radius" }`. */
export const themeAccess = (path: string): { subsystem: string; key: string } => {
  const [subsystem, ...rest] = path.split(".");
  return { subsystem, key: themeKey(rest) };
};

/**
 * A bound identifier minter for one theme: the recipe-export namer with the §7B collision guard.
 * Distinct addresses producing the same identifier throw; the same address re-resolving is fine.
 */
export interface ScIdentifiers {
  /** The camelCase export name for a recipe (`components`,`buttons`,`primary` → `componentsButtonsPrimary`). */
  recipeExportName(subsystem: string, group: string, variant: string): string;
}

export const createIdentifiers = (overrides?: NamingOverrides): ScIdentifiers => {
  const seen = new Map<string, string>(); // identifier → source address key

  const track = (name: string, key: string): void => {
    const prev = seen.get(name);
    if (prev !== undefined && prev !== key) {
      throw new Error(
        `styled-components emit: recipe identifier "${name}" is produced by both "${prev}" and ` +
          `"${key}" — the naming override must map distinct recipes to distinct identifiers`,
      );
    }
    seen.set(name, key);
  };

  return {
    recipeExportName(subsystem, group, variant) {
      const segments = [subsystem, group, variant];
      let name = camelJoin(segments);
      if (overrides?.className) {
        // Feed the override a PREFIX-FREE default (SC identifiers carry no prefix), so a no-op
        // decorator round-trips to the structural name and only a real remap changes identity.
        const fallback = segments.map(s => splitWords(s).join("-")).join("-");
        const out = overrides.className(
          { kind: "recipe", subsystem, group, variant },
          { classToken: "", name: fallback },
        );
        name = camelJoin(splitWords(out));
        if (!name || name === "_") {
          throw new Error(
            `styled-components emit: className override returned an empty/invalid identifier for ` +
              `"${subsystem}.${group}.${variant}"`,
          );
        }
      }
      track(name, `${subsystem}.${group}.${variant}`);
      return name;
    },
  };
};
