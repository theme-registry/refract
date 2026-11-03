/**
 * Load a Refract DTCG profile from disk (Node-only): a resolver (`resolver.json`, recognised by its
 * `resolutionOrder`) together with the token files its `$ref`s name, resolved relative to the
 * resolver's folder — or a single `.tokens.json` file.
 *
 *   createTheme(await loadDTCG("./tokens/resolver.json"), { adapter })
 *
 * `loadDTCGProfile` returns the full result (child themes of `"as": "themes"` modifiers and the
 * report); `loadDTCG` returns only the raw theme.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { importDTCGProfile } from "../dtcg/resolver";
import type { DTCGResolverDocument, ProfileSetResult } from "../dtcg/resolver";
import type { DTCGDocument } from "../dtcg/types";
import type { RawTheme } from "../core/rawTheme";
import { RefractError } from "../core/errors";

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

const readJson = (path: string, what: string): unknown => {
  if (!existsSync(path)) throw new RefractError("REFRACT_E_PROFILE", `${what} "${path}" doesn't exist.`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new RefractError("REFRACT_E_PROFILE", `${what} "${path}" isn't valid JSON: ${(e as Error).message}`);
  }
};

/** Every file `$ref` in a resolver's sets and modifier contexts (pointers into the resolver excluded). */
const fileRefs = (resolver: DTCGResolverDocument): string[] => {
  const refs = new Set<string>();
  const visit = (sources: unknown): void => {
    if (!Array.isArray(sources)) return;
    for (const s of sources) {
      if (isObject(s) && typeof s.$ref === "string" && !s.$ref.startsWith("#")) refs.add(s.$ref.split("#")[0]);
    }
  };
  for (const set of Object.values(resolver.sets ?? {})) visit(set.sources);
  for (const mod of Object.values(resolver.modifiers ?? {})) for (const ctx of Object.values(mod.contexts ?? {})) visit(ctx);
  for (const item of resolver.resolutionOrder ?? []) {
    if (!isObject(item)) continue;
    visit(item.sources);
    if (isObject(item.contexts)) for (const ctx of Object.values(item.contexts)) visit(ctx);
  }
  return [...refs];
};

/** Load a profile (resolver or single token file) from disk into `{ raw, themes, report }`. */
export async function loadDTCGProfile(path: string): Promise<ProfileSetResult> {
  const abs = resolve(path);
  const doc = readJson(abs, "Profile file");
  if (isObject(doc) && Array.isArray(doc.resolutionOrder)) {
    const resolver = doc as unknown as DTCGResolverDocument;
    const dir = dirname(abs);
    const files: Record<string, DTCGDocument> = {};
    for (const ref of fileRefs(resolver)) {
      files[ref] = readJson(resolve(dir, ref), `Token file (from ${path})`) as DTCGDocument;
    }
    return importDTCGProfile({ resolver, files });
  }
  return importDTCGProfile(doc as DTCGDocument);
}

/** Load a profile from disk into a raw theme: `createTheme(await loadDTCG(path), { adapter })`. */
export async function loadDTCG(path: string): Promise<RawTheme> {
  return (await loadDTCGProfile(path)).raw;
}
