/**
 * `refract validate <file>` — read a Refract DTCG profile (a `resolver.json` with its token files, or a
 * single `.tokens.json`) and build it, reporting everything the JSON Schema can't check: references,
 * scale targets, breakpoint names, mode files, generated-value drift. Node-only.
 */
import { createTheme } from "../core/createTheme";
import { createNoopAdapter } from "../core/noopAdapter";
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
  return {
    path,
    report,
    themes: Object.fromEntries(Object.entries(themes).map(([m, c]) => [m, Object.keys(c)])),
    builtTokens: Object.keys(theme.tokens).length,
  };
}
