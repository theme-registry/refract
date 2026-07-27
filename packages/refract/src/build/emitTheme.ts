/**
 * `emitTheme` — the programmatic build API (Node-only, §7 Step 10b).
 *
 * The build-time delivery method (alongside runtime `createTheme`): build a theme, ask the adapter
 * to `emit()` its self-contained static output, and write it to disk. After this a consuming app
 * imports the emitted files and drops refract at runtime.
 *
 * Adapter-agnostic by construction — it takes the fully-constructed adapter *object* (the config's
 * `import` is the extensibility seam; `emitTheme` imports zero adapters itself). It orchestrates ONLY
 * over the public surface (`createTheme`) + the `emit()` / `VENDOR_HELPERS` seams; no reach-in.
 *
 * Two vendoring lanes (Option A, locked 2026-07-11):
 *  - `emit().vendorHelpers` — *theme-specific* live helpers the adapter generates (e.g. the SC media
 *    module with baked `@media` strings). Always written when present.
 *  - `helpers` opt-in — *shared static* helpers (color-math) materialized here from their single
 *    source via `VENDOR_HELPERS`. Explicit opt-in — a target names which it wants; never auto-emitted.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ThemeAdapter, Emit } from "../core/ThemeAdapter";
import type { RawTheme } from "../core/rawTheme";
import type { MediaConfig } from "../core/media";
import type { UnitsConfig } from "../core/units";
import { createTheme } from "../core/createTheme";
import { buildMediaDescriptor, buildContainerDescriptors, mediaQueryString, resolveMediaConfig } from "../core/media";
import { VENDOR_HELPERS, findVendorHelper } from "./vendor";
import { readVendorSource, transpileToEsm } from "./paths";
import { resolveEmitPlan } from "./emit";
import { buildGuide } from "./guide";
import { buildPreview, type PreviewConfig } from "./preview";
import { toDTCG } from "../dtcg";

/** Opt-in self-documenting output config (§C). `true` uses defaults; the object tunes names/overlay. */
export type GuideConfig = {
  /** Published package specifier — adds a by-specifier import overlay to the guide (else relative-only). */
  readonly packageName?: string;
  /** Narrative guide filename (default `"llms.txt"`). */
  readonly llmsFile?: string;
  /** Machine index filename (default `"manifest.json"`); `false` suppresses it. */
  readonly manifestFile?: string | false;
};

export interface EmitThemeOptions {
  /** The raw theme config (same shape `createTheme` consumes). */
  readonly raw: RawTheme;
  /** The fully-constructed adapter object (`createCssAdapter(...)`, an SC adapter, …). */
  readonly adapter: ThemeAdapter;
  /** Directory to write the emitted files into (created recursively). */
  readonly outDir: string;
  /** Shared vendorable helper ids to materialize from `VENDOR_HELPERS` (e.g. `["color-math"]`). */
  readonly helpers?: readonly string[];
  /** Output-shape directive (§9); normalized to a plan and passed to the adapter's `emit(plan)`. */
  readonly emit?: Emit;
  /** Media unit config (§10.5) — threaded into `createTheme` + the emit rebind so em/rem reaches disk. */
  readonly media?: MediaConfig;
  /** Declaration-value length units (§21) — threaded into `createTheme` so built output honors the role map. */
  readonly units?: UnitsConfig;
  /** Divisor when a deferred length resolves to `rem` (§21). Defaults to 16. */
  readonly baseFontSize?: number;
  /** §C — emit a self-documenting `llms.txt` + `manifest.json` into `outDir`. Off by default. */
  readonly guide?: boolean | GuideConfig;
  /** §20 — emit a human-facing `preview.html` specimen into `outDir`. Off by default. */
  readonly preview?: boolean | PreviewConfig;
}

export interface EmitThemeResult {
  readonly outDir: string;
  /** Absolute paths of every file written, in write order. */
  readonly files: string[];
}

export async function emitTheme(options: EmitThemeOptions): Promise<EmitThemeResult> {
  const { raw, adapter, outDir, helpers = [], emit, media: mediaConfig, units, baseFontSize, guide, preview } = options;

  const theme = createTheme(raw, { adapter, media: mediaConfig, units, baseFontSize });

  // Re-bind with the PLAIN core media descriptor: `emit()` isn't on the theme surface, and an
  // adapter may decorate `theme.media` (SC → tagged templates), whereas emitted vendored helpers
  // (SC's media.ts) need the plain `@media` query strings. This mirrors the 10a gate.
  const media = buildMediaDescriptor(theme.model.breakpoints, o =>
    mediaQueryString(o, resolveMediaConfig(mediaConfig)),
  );
  const containers = buildContainerDescriptors(theme.model.containers, mediaConfig);
  const bound = adapter.bind(theme.model, { media, containers, resolve: theme.resolveToken });

  if (!bound.emit) {
    throw new Error(`Adapter "${adapter.name}" does not implement emit(); it cannot build to disk.`);
  }
  // Hoisted: `guide` and `preview` both describe THIS emit, and `describePreview` is handed the plan.
  const plan = resolveEmitPlan(emit);
  const emitted = bound.emit(plan);

  const written: string[] = [];
  mkdirSync(outDir, { recursive: true });
  const write = (name: string, contents: string): void => {
    const dest = join(outDir, name);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, contents, "utf8");
    written.push(dest);
  };

  // Static consume-as-is artifacts (theme.css, …).
  for (const [name, contents] of Object.entries(emitted.files)) write(name, contents);
  // Theme-specific vendored helpers (SC media.ts) — always ride along with the adapter's output.
  for (const [name, contents] of Object.entries(emitted.vendorHelpers ?? {})) write(name, contents);

  // Shared static vendored helpers — materialized from their single source (no adapter re-embed).
  for (const id of helpers) {
    const helper = findVendorHelper(id);
    if (!helper) {
      throw new Error(
        `Unknown vendor helper "${id}". Known: ${VENDOR_HELPERS.map(h => h.id).join(", ")}.`,
      );
    }
    // `transpileToEsm` lazy-loads the optional `typescript` peer (Step 10e) — reached only here, on
    // an explicit `helpers` opt-in, so a helper-free CSS build never needs `typescript` installed.
    write(helper.outfile, await transpileToEsm(readVendorSource(helper.source)));
  }

  // §C — self-documenting output: an llms.txt guide + manifest.json describing THIS theme's real
  // names, written beside the artifacts so they travel with any distribution form. Opt-in.
  if (guide) {
    const cfg: GuideConfig = guide === true ? {} : guide;
    const built = buildGuide(bound.describeUsage(), toDTCG(theme), {
      files: Object.keys(emitted.files),
      packageName: cfg.packageName,
      llmsFile: cfg.llmsFile,
      manifestFile: cfg.manifestFile,
    });
    for (const [name, contents] of Object.entries(built.files)) write(name, contents);
  }

  // §20 — human-facing `preview.html`: the same theme rendered as a specimen page. `describePreview`
  // is OPTIONAL and gets the plan plus the REAL emitted names (`filename` is a user function in
  // subsystem/components mode, so the names cannot be re-derived from the plan). An adapter that
  // doesn't implement it yields a tokens-only page rather than an error.
  if (preview) {
    const cfg: PreviewConfig = preview === true ? {} : preview;
    const files = Object.keys(emitted.files);
    const built = buildPreview(
      {
        usage: bound.describeUsage(),
        preview: bound.describePreview?.(plan, files),
        tokens: toDTCG(theme),
        model: theme.model,
      },
      { files, contents: emitted.files, plan, file: cfg.file, inline: cfg.inline, title: cfg.title },
    );
    for (const [name, contents] of Object.entries(built.files)) write(name, contents);
  }

  return { outDir, files: written };
}
