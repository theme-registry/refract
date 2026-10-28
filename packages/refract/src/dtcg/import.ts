import type { DTCGDocument } from "./types";
import { REFRACT_DTCG_EXTENSION, REFRACT_DTCG_EXTENSION_VERSION } from "./types";
import type { RefractDTCGExtension } from "./export";
import { extendImporter, runImporter } from "./importer";
import type { DTCGImportResult, FromDTCGOptions, Importer, ImporterSpec } from "./importer";
import { dtcgImporter } from "./dtcgImporter";
import { createTheme, RefractError } from "../core";
import type { Theme, ThemeAdapter } from "../core";

type RawThemeInput = Record<string, unknown>;

/** Import options: the default importer's options plus the importer to run. */
export type ImportDTCGOptions = FromDTCGOptions & {
  /** The importer to run (default: `dtcgImporter`). */
  importer?: Importer;
};

/**
 * Build an importer from a spec: each hook it leaves out comes from `spec.extends` (default:
 * `dtcgImporter`), each it gives receives that importer's hook as `next`.
 *
 * ```ts
 * export default defineImporter({
 *   name: "radii-as-spacing",
 *   version: 1,
 *   place(token, ctx, next) {
 *     if (token.path[0] === "radii") return { kind: "token", subsystem: "layout", property: "spacing", member: token.path.at(-1)! };
 *     return next(token);
 *   },
 * });
 * ```
 */
export const defineImporter = (spec: ImporterSpec): Importer => extendImporter(spec.extends ?? dtcgImporter, spec);

/**
 * Convert a DTCG document into a `createTheme` raw input, with a report of what happened to every
 * token. Runs `options.importer` (default {@link dtcgImporter}: tokens placed by `$type`, then path
 * keywords; colours kept in their groups with `tones: false`; shadows as structured layers; text styles
 * as typography recipes).
 *
 * A property with no `$root` or `base` member takes its `default` member as base, else its first in
 * name order; the report lists it. Values are resolved literals: aliases aren't kept in the raw theme.
 */
export const importDTCG = (doc: DTCGDocument, options: ImportDTCGOptions = {}): DTCGImportResult => {
  const { importer = dtcgImporter, ...rest } = options;
  return runImporter(importer, doc, rest);
};

/**
 * Convert a DTCG token document into a `createTheme` raw input — {@link importDTCG} without the report.
 *
 * Returns a plain object — modify it freely before passing to `createTheme`.
 */
export const fromDTCG = (doc: DTCGDocument, options?: ImportDTCGOptions): RawThemeInput =>
  importDTCG(doc, options).raw;

// --- refract round-trip (recipes via the com.theme-registry.refract extension) ---

/**
 * Read the refract round-trip payload from a DTCG document's top-level `$extensions`, or `undefined`
 * when it carries none. `parseDTCGDocument` intentionally drops top-level `$extensions`, so this reads
 * `doc.$extensions` directly. Throws on a payload from a newer, unreadable schema version.
 */
export const readRefractExtension = (doc: DTCGDocument): RefractDTCGExtension | undefined => {
  const ext = doc.$extensions?.[REFRACT_DTCG_EXTENSION] as RefractDTCGExtension | undefined;
  if (!ext) return undefined;
  if (ext.version !== REFRACT_DTCG_EXTENSION_VERSION) {
    throw new RefractError(
      "REFRACT_E_DTCG_VERSION",
      `Unsupported refract DTCG extension version ${ext.version} (this build reads version ` +
        `${REFRACT_DTCG_EXTENSION_VERSION}). Upgrade @theme-registry/refract to import this document's recipes.`,
    );
  }
  return ext;
};

/**
 * Lossless `DTCG → refract` round-trip entry: {@link fromDTCG} for the property tokens, plus the
 * recipes / keyframes / containers the document stashed under `com.theme-registry.refract` reinjected
 * through createTheme's overlay. A plain DTCG document (no refract extension) round-trips to a
 * recipe-less theme — identical to `createTheme(fromDTCG(doc), { adapter })`.
 */
export const fromDTCGTheme = (
  doc: DTCGDocument,
  options: ImportDTCGOptions & { adapter: ThemeAdapter },
): Theme => {
  const raw = fromDTCG(doc, options);
  const ext = readRefractExtension(doc);
  return createTheme(raw, {
    adapter: options.adapter,
    propertiesOverlay: ext?.properties,
    ruleSetsOverlay: ext?.ruleSets,
    keyframesOverlay: ext?.keyframes,
    containersOverlay: ext?.containers,
  });
};
