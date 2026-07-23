/**
 * Self-documenting theme output (Node-only) — render an `llms.txt` consumption guide + a
 * `manifest.json` index from an adapter's {@link UsageDescriptor} and a DTCG token export.
 *
 * The point: a theme built by refract is often shipped onward as a published package, a zip / CI
 * artifact, or a vendored folder to developers who have **neither refract nor its skills** (and may
 * not know refract exists). These two files travel *inside* `outDir`, so they accompany any
 * distribution form, and they name the theme's REAL class names / export ids / token paths — a
 * downstream agent consumes the theme from the folder alone, never guessing an identifier.
 *
 * Distribution-agnostic by construction: references are **relative** by default (`./theme.css`); the
 * `@scope/name` import form is added only as an overlay when a package name is configured (a zip has
 * no package specifier, so it must not be assumed).
 */
import type { UsageDescriptor } from "../core/ThemeAdapter";

/** How many recipe rows to inline into `llms.txt` before deferring the rest to `manifest.json`. */
const LLMS_RECIPE_CAP = 60;

export interface GuideOptions {
  /** The static file names emitted for this target (relative), so the guide points at real artifacts. */
  readonly files: readonly string[];
  /** The published package specifier, if any — adds an import-by-specifier overlay to the prose. */
  readonly packageName?: string;
  /** Output name for the narrative guide (default `"llms.txt"`). */
  readonly llmsFile?: string;
  /** Output name for the machine index (default `"manifest.json"`); `false` suppresses it. */
  readonly manifestFile?: string | false;
}

export interface GuideOutput {
  /** filename → contents, ready for the build layer to write into `outDir`. */
  readonly files: Record<string, string>;
}

const escapeCell = (s: string): string => s.replace(/\|/g, "\\|");

/** Render the `llms.txt` narrative. */
function renderLlms(descriptor: UsageDescriptor, options: GuideOptions, manifestName: string | false): string {
  const lines: string[] = [];
  lines.push(`# Theme consumption guide (${descriptor.format})`);
  lines.push("");
  lines.push(
    "This folder is a self-contained theme built with refract. You do NOT need refract to use it —",
    "everything below refers to files in THIS folder (relative paths), so it works whether the theme",
    "was installed as a package, unzipped from an artifact, or vendored into a repo.",
  );
  lines.push("");

  if (options.files.length > 0) {
    lines.push("## Files");
    lines.push("");
    for (const f of options.files) lines.push(`- \`./${f}\``);
    lines.push("");
  }

  lines.push("## How to use");
  lines.push("");
  for (const s of descriptor.summary) lines.push(s);
  if (options.packageName) {
    lines.push("");
    lines.push(
      `If this theme is installed as the \`${options.packageName}\` package, you may import the same`,
      `files by specifier (e.g. \`${options.packageName}/${options.files[0] ?? "theme.css"}\`) instead of by relative path.`,
    );
  }
  lines.push("");

  const { recipes } = descriptor;
  if (recipes.length > 0) {
    lines.push("## Recipes — real names");
    lines.push("");
    lines.push("Use these exact identities; do not invent names.");
    lines.push("");
    lines.push("| Recipe | Identity |");
    lines.push("| --- | --- |");
    const shown = recipes.slice(0, LLMS_RECIPE_CAP);
    for (const r of shown) {
      lines.push(`| \`${escapeCell(`${r.subsystem}.${r.group}.${r.variant}`)}\` | \`${escapeCell(r.name)}\` |`);
    }
    if (recipes.length > shown.length) {
      const rest = recipes.length - shown.length;
      lines.push("");
      lines.push(
        `_(+${rest} more recipe(s) — the complete list is in ${manifestName ? `\`./${manifestName}\`` : "the manifest"}.)_`,
      );
    }
    lines.push("");
  }

  if (manifestName) {
    lines.push("## Machine-readable index");
    lines.push("");
    lines.push(`See \`./${manifestName}\` for the full recipe index and the theme's tokens (DTCG format).`);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Build the guide artifacts. `tokens` is a DTCG document (from `toDTCG`) embedded verbatim into the
 * manifest so the machine index carries every token path + value beside the recipe identities.
 */
export function buildGuide(
  descriptor: UsageDescriptor,
  tokens: unknown,
  options: GuideOptions,
): GuideOutput {
  const llmsName = options.llmsFile ?? "llms.txt";
  const manifestName = options.manifestFile === undefined ? "manifest.json" : options.manifestFile;

  const files: Record<string, string> = {
    [llmsName]: renderLlms(descriptor, options, manifestName),
  };

  if (manifestName) {
    const manifest = {
      schema: 1,
      format: descriptor.format,
      files: options.files,
      packageName: options.packageName,
      recipes: descriptor.recipes,
      tokens,
    };
    files[manifestName] = `${JSON.stringify(manifest, null, 2)}\n`;
  }

  return { files };
}
