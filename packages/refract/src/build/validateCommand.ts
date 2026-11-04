/**
 * `refract validate <file>` — read a Refract DTCG profile (a `resolver.json` with its token files, or a
 * single `.tokens.json`) and build it, reporting everything the JSON Schema can't check: references,
 * scale targets, breakpoint names, mode files, generated-value drift, and name collisions under the
 * default naming (two token paths or two recipes that would get the same CSS variable / class name).
 * Node-only.
 */
import { createTheme } from "../core/createTheme";
import { createNoopAdapter } from "../core/noopAdapter";
import { eachRuleSet } from "../core/defineAdapter";
import { createNamer, resolveNaming } from "../adapter-kit";
import type { Theme } from "../core/createTheme";
import { loadDTCGProfile } from "./loadDTCG";
import type { ProfileReport } from "../dtcg/profile";

export interface ValidateResult {
  readonly path: string;
  readonly report: ProfileReport & { readonly modes: readonly string[] };
  /** Child themes from `"as": "themes"` modifiers: `modifier → contexts`. */
  readonly themes: Readonly<Record<string, readonly string[]>>;
  /** Tokens in the built theme. */
  readonly builtTokens: number;
}

/** Read and build a profile; throws (a coded `RefractError`) on anything that doesn't read or build. */
export async function runValidate(path: string): Promise<ValidateResult> {
  const { raw, themes, report } = await loadDTCGProfile(path);
  const theme = createTheme(raw, { adapter: createNoopAdapter() });
  for (const contexts of Object.values(themes)) for (const partial of Object.values(contexts)) theme.override(partial);
  checkDefaultNaming(theme);
  return {
    path,
    report,
    themes: Object.fromEntries(Object.entries(themes).map(([m, c]) => [m, Object.keys(c)])),
    builtTokens: Object.keys(theme.tokens).length,
  };
}

/**
 * Validate builds with the no-op adapter, which names nothing — so a collision that only the default
 * naming produces (names differing only in case, or `a-b`+`c` vs `a`+`b-c` once segments are joined)
 * would pass here and fail at `refract build`. Run the default namer over every token path and every
 * rule-set: it throws the same `REFRACT_E_NAMING` error the CSS / SCSS / styled-components adapters
 * throw, naming both sides. The prefix is the same for every name, so the default one stands in for any.
 */
function checkDefaultNaming(theme: Theme): void {
  const namer = createNamer(resolveNaming({}));
  for (const path of Object.keys(theme.tokens)) namer.variableName(path);
  for (const { subsystem, group, variant } of eachRuleSet(theme.model)) namer.className("recipe", subsystem, group, variant);
}
