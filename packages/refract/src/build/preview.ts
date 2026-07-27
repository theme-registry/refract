/**
 * Human-facing preview (Node-only) — render a single `preview.html` specimen of a built theme.
 *
 * The audience-flipped sibling of `guide.ts`: that one writes `llms.txt` + `manifest.json` for a
 * downstream *agent*; this one writes a page a person opens, forwards, or hands a designer to answer
 * "what does this theme actually look like?". Both are opt-in per emit target and land in the same
 * `outDir`, so they travel with any distribution form.
 *
 * Two plate tiers, split by CAPABILITY rather than by adapter name:
 *
 *  - **Token plates (universal).** Rendered from the format-neutral DTCG export — the same document
 *    `guide` embeds — so they depend on nothing the adapter emitted. Every adapter, including a
 *    third-party one that has never heard of previews, gets these on day one. The walk is generic
 *    over `$type`, so a new subsystem's tokens show up without touching this file.
 *
 *  - **Recipe plates (live).** Require the emitted artifacts to be browser-loadable as-is, which the
 *    adapter alone can answer — see {@link PreviewDescriptor}. Today that means CSS; SCSS needs
 *    compiling, styled-components emits JS modules, JSON has no rendered form. Those adapters say so
 *    in their own words and the page degrades to tokens-only rather than rendering unstyled boxes.
 *
 * Distribution convention deliberately INVERTS `guide`'s: the page **inlines** its stylesheets by
 * default (`inline: false` opts out). `guide` is machine-facing and lives next to the code it
 * documents, so relative references are right there; a preview gets moved, attached, and forwarded,
 * and has to keep working. `inline: false` serves the dev loop, where the page should reflect a
 * rebuilt stylesheet on refresh.
 */
import type { ThemeModel } from "../core/model/model";
import type {
  NormalizedEmit,
  PreviewDescriptor,
  UsageDescriptor,
  UsageRecipe,
} from "../core/ThemeAdapter";

/** Opt-in preview config (`EmitTarget.preview`). `true` uses every default. */
export type PreviewConfig = {
  /** Output filename (default `"preview.html"`). */
  readonly file?: string;
  /**
   * Inline the emitted stylesheets into the page so it is a single shareable file (default `true`).
   * `false` emits relative `<link>`s instead — the page then only works beside its `outDir`, but it
   * reflects a rebuilt stylesheet on refresh.
   */
  readonly inline?: boolean;
  /** Page heading + `<title>` (default `"<format> theme preview"`). */
  readonly title?: string;
};

export interface PreviewOptions extends PreviewConfig {
  /** The file names actually written for this target — the guard against referencing a missing artifact. */
  readonly files: readonly string[];
  /** Emitted file contents by name, for inlining. A name missing here falls back to a `<link>`. */
  readonly contents?: Readonly<Record<string, string>>;
  /** The normalized emit plan — reported in the header and used for layout semantics only. */
  readonly plan: NormalizedEmit;
}

export interface PreviewOutput {
  /** filename → contents, ready for the build layer to write into `outDir`. */
  readonly files: Record<string, string>;
}

export interface PreviewSource {
  /** The adapter's usage descriptor — supplies the format id and the real recipe identities. */
  readonly usage: UsageDescriptor;
  /** The adapter's preview descriptor, or `undefined` when it doesn't implement `describePreview`. */
  readonly preview?: PreviewDescriptor;
  /** A DTCG document (from `toDTCG`) — the token-plate source. */
  readonly tokens: unknown;
  /** The built model — supplies appearance modes and breakpoints for the page controls. */
  readonly model: ThemeModel;
}

const DEFAULT_FILE = "preview.html";

// ---------------------------------------------------------------------------
// Escaping — every value below originates in user-authored theme content
// ---------------------------------------------------------------------------

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * A token value going into a `style="…"` attribute. Declaration/rule terminators are dropped so a
 * value can never break out of its declaration, then the result is HTML-attribute escaped.
 */
const cssValue = (v: unknown): string => escapeHtml(String(v).replace(/[;{}<>]/g, "").trim());

/** Inline `<style>`/`<script>` bodies can't contain a literal `</` without ending the element early. */
const escapeTextElement = (s: string): string => s.replace(/<\/(?=[a-zA-Z])/g, "<\\/");

// ---------------------------------------------------------------------------
// Token plates — a generic DTCG walk, so new subsystems appear without a code change
// ---------------------------------------------------------------------------

interface TokenLeaf {
  readonly path: readonly string[];
  /** The DTCG `$type`, inherited from the nearest ancestor that declares one. */
  readonly type?: string;
  readonly value: unknown;
}

/** Collect every `$value` leaf, threading the nearest declared `$type` down the tree. */
function collectLeaves(node: unknown, path: readonly string[], inherited: string | undefined, out: TokenLeaf[]): void {
  if (!node || typeof node !== "object" || Array.isArray(node)) return;
  const record = node as Record<string, unknown>;
  const type = typeof record.$type === "string" ? record.$type : inherited;
  if ("$value" in record) {
    out.push({ path, type, value: record.$value });
    return;
  }
  for (const [key, child] of Object.entries(record)) {
    if (key.startsWith("$")) continue;
    collectLeaves(child, [...path, key], type, out);
  }
}

/** Sample text for the plates that demonstrate a value by rendering type in it. */
const TYPE_SPECIMEN = "The quick brown fox";

/**
 * The visual for one token. A `dimension` under `typography` is a font size (render the ramp);
 * elsewhere it's a length (render a bar). Anything unrecognized falls back to its literal value,
 * which is still the honest answer for a duration or a cubic-bezier.
 */
function renderSwatch(leaf: TokenLeaf): string {
  const value = leaf.value;
  const label = `<code class="rfp-val">${escapeHtml(String(value))}</code>`;

  switch (leaf.type) {
    case "color":
      return `<span class="rfp-chip" style="background:${cssValue(value)}"></span>${label}`;
    case "shadow":
      return `<span class="rfp-box" style="box-shadow:${cssValue(value)}"></span>${label}`;
    case "border":
      return `<span class="rfp-box" style="border:${cssValue(value)}"></span>${label}`;
    case "fontFamily":
      return `<span class="rfp-specimen" style="font-family:${cssValue(value)}">${TYPE_SPECIMEN}</span>${label}`;
    case "fontWeight":
      return `<span class="rfp-specimen" style="font-weight:${cssValue(value)}">${TYPE_SPECIMEN}</span>${label}`;
    case "dimension":
      // `typography.fontSize.*` is the type ramp — show it as type. Every other dimension (spacing,
      // radius, breakpoints, and typography's own `letterSpacing`) reads better as a length bar.
      return leaf.path[0] === "typography" && leaf.path[1] === "fontSize"
        ? `<span class="rfp-specimen" style="font-size:${cssValue(value)}">${TYPE_SPECIMEN}</span>${label}`
        : `<span class="rfp-bar" style="width:${cssValue(value)}"></span>${label}`;
    default:
      return label;
  }
}

/** One plate per top-level DTCG group (`color`, `spacing`, `shadow`, …), rows sorted by source order. */
function renderTokenPlates(tokens: unknown): string {
  const leaves: TokenLeaf[] = [];
  collectLeaves(tokens, [], undefined, leaves);
  if (leaves.length === 0) {
    return `<p class="rfp-note">This theme declares no tokens.</p>`;
  }

  const groups = new Map<string, TokenLeaf[]>();
  for (const leaf of leaves) {
    const key = leaf.path[0] ?? "tokens";
    const bucket = groups.get(key);
    if (bucket) bucket.push(leaf);
    else groups.set(key, [leaf]);
  }

  const sections: string[] = [];
  for (const [group, rows] of groups) {
    const items = rows
      .map(
        leaf =>
          `<li class="rfp-row"><span class="rfp-name">${escapeHtml(leaf.path.slice(1).join(".") || group)}</span>` +
          `<span class="rfp-swatch">${renderSwatch(leaf)}</span></li>`,
      )
      .join("\n");
    sections.push(
      `<section class="rfp-plate">\n<h3 class="rfp-plate-title">${escapeHtml(group)} ` +
        `<span class="rfp-count">${rows.length}</span></h3>\n<ul class="rfp-rows">\n${items}\n</ul>\n</section>`,
    );
  }
  return sections.join("\n");
}

// ---------------------------------------------------------------------------
// Recipe plates
// ---------------------------------------------------------------------------

/**
 * Which element to render a recipe as, when the adapter didn't say. Presentation guesswork belongs
 * here rather than in an adapter: it's about the specimen page, not about the output format.
 */
function inferTag(recipe: UsageRecipe): string {
  const group = recipe.group.toLowerCase();
  if (group.includes("button") || group.includes("btn")) return "button";
  if (group.includes("link") || group.includes("anchor")) return "a";
  if (group.includes("badge") || group.includes("chip") || group.includes("tag") || group.includes("label")) {
    return "span";
  }
  return "div";
}

/** `<tag attr="…">Label</tag>` for one recipe, or `undefined` when the adapter offers no markup. */
function renderRecipeSpecimen(recipe: UsageRecipe, descriptor: PreviewDescriptor | undefined): string | undefined {
  const markup = descriptor?.markup?.(recipe);
  if (!markup) return undefined;
  const tag = markup.tag ?? inferTag(recipe);
  const attrs = Object.entries(markup.attrs)
    .map(([key, value]) => ` ${escapeHtml(key)}="${escapeHtml(value)}"`)
    .join("");
  return `<${tag}${attrs}>${escapeHtml(recipe.variant)}</${tag}>`;
}

function renderRecipePlates(
  usage: UsageDescriptor,
  descriptor: PreviewDescriptor | undefined,
  live: boolean,
): string {
  if (usage.recipes.length === 0) {
    // The scaffolder writes tokens and no recipes, so this is the FIRST thing a new user sees here.
    // Say what's missing and where to go, rather than showing an empty box.
    return (
      `<p class="rfp-note"><strong>No recipes yet — this theme is tokens only.</strong> ` +
      `Tokens are values; recipes are the rule-sets that turn them into styled components ` +
      `(a button, a card). Add a <code>recipes</code> block to a subsystem in your raw theme and ` +
      `rebuild — they'll render here.</p>`
    );
  }

  const groups = new Map<string, UsageRecipe[]>();
  for (const recipe of usage.recipes) {
    const key = descriptor?.groupBy?.(recipe) ?? "";
    const bucket = groups.get(key);
    if (bucket) bucket.push(recipe);
    else groups.set(key, [recipe]);
  }

  const sections: string[] = [];
  for (const [group, recipes] of groups) {
    const items = recipes
      .map(recipe => {
        const specimen = live ? renderRecipeSpecimen(recipe, descriptor) : undefined;
        const address = `${recipe.subsystem}.${recipe.group}.${recipe.variant}`;
        return (
          `<li class="rfp-recipe">` +
          (specimen ? `<div class="rfp-stage">${specimen}</div>` : "") +
          `<div class="rfp-meta"><span class="rfp-name">${escapeHtml(address)}</span>` +
          `<code class="rfp-val">${escapeHtml(recipe.name)}</code></div></li>`
        );
      })
      .join("\n");
    const title = group
      ? `<h3 class="rfp-plate-title">${escapeHtml(group)} <span class="rfp-count">${recipes.length}</span></h3>\n`
      : "";
    sections.push(`<section class="rfp-plate">\n${title}<ul class="rfp-recipes">\n${items}\n</ul>\n</section>`);
  }
  return sections.join("\n");
}

// ---------------------------------------------------------------------------
// Model-derived page controls
// ---------------------------------------------------------------------------

/** Distinct appearance modes across every property's `modes` list, in first-appearance order. */
export function collectModes(model: ThemeModel): string[] {
  const modes: string[] = [];
  for (const subsystem of Object.values(model.subsystems)) {
    for (const property of Object.values(subsystem.properties ?? {})) {
      for (const override of property.modes ?? []) {
        if (override.mode && !modes.includes(override.mode)) modes.push(override.mode);
      }
    }
  }
  return modes;
}

// ---------------------------------------------------------------------------
// Page chrome
// ---------------------------------------------------------------------------

/**
 * The preview's own styling. Class-only selectors (`.rfp-*`), so the theme's `globals` element rules
 * can never outrank it, and emitted LAST so an equal-specificity theme class still loses here. The
 * document body is deliberately left to the theme — a themed page background is part of the specimen.
 */
const CHROME_CSS = `
.rfp-root{font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#111;background:#fff;
  max-width:1100px;margin:0 auto;padding:24px;box-sizing:border-box}
.rfp-head{display:flex;flex-wrap:wrap;gap:12px;align-items:baseline;justify-content:space-between;
  border-bottom:1px solid #e5e5e5;padding-bottom:12px;margin-bottom:20px}
.rfp-title{font-size:20px;font-weight:600;margin:0}
.rfp-sub{color:#666;font-size:12px}
.rfp-controls{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px}
.rfp-controls button{font:inherit;font-size:12px;padding:4px 10px;border:1px solid #ccc;border-radius:6px;
  background:#fafafa;color:#111;cursor:pointer}
.rfp-controls button[aria-pressed="true"]{background:#111;border-color:#111;color:#fff}
.rfp-group-label{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#888;align-self:center;
  margin-right:4px}
.rfp-section-title{font-size:15px;font-weight:600;margin:28px 0 10px}
.rfp-plate{border:1px solid #e5e5e5;border-radius:8px;padding:14px 16px;margin-bottom:14px;background:#fff}
.rfp-plate-title{font-size:13px;font-weight:600;margin:0 0 10px;color:#333}
.rfp-count{color:#999;font-weight:400}
.rfp-rows,.rfp-recipes{list-style:none;margin:0;padding:0}
.rfp-row{display:grid;grid-template-columns:minmax(120px,220px) 1fr;gap:12px;align-items:center;
  padding:5px 0;border-top:1px solid #f2f2f2}
.rfp-row:first-child{border-top:0}
.rfp-name{font-size:12px;color:#444;overflow-wrap:anywhere}
.rfp-swatch{display:flex;align-items:center;gap:10px;min-width:0;overflow:hidden}
.rfp-val{font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:#666;background:#f6f6f6;
  padding:1px 5px;border-radius:4px;white-space:nowrap}
.rfp-chip{width:28px;height:28px;border-radius:5px;border:1px solid rgba(0,0,0,.15);flex:none}
.rfp-box{width:44px;height:28px;border-radius:5px;background:#fff;border:1px solid rgba(0,0,0,.08);flex:none}
.rfp-bar{height:10px;background:#111;border-radius:2px;flex:none;max-width:100%}
.rfp-specimen{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.rfp-recipes{display:flex;flex-wrap:wrap;gap:14px}
.rfp-recipe{border:1px solid #eee;border-radius:8px;padding:12px;min-width:160px;background:#fff}
.rfp-stage{display:flex;align-items:center;justify-content:center;min-height:56px;margin-bottom:8px}
.rfp-meta{display:flex;flex-direction:column;gap:3px;align-items:flex-start}
.rfp-note{font-size:13px;color:#555;background:#f8f8f8;border:1px solid #ececec;border-left:3px solid #bbb;
  border-radius:0 6px 6px 0;padding:10px 14px;margin:0 0 14px}
.rfp-frame{margin:0 auto;transition:max-width .15s ease}
.rfp-files{font-size:12px;color:#666;margin:0 0 16px}
.rfp-files code{font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}
@media (prefers-color-scheme:dark){
  .rfp-root{color:#eee;background:#151515}
  .rfp-head{border-bottom-color:#2c2c2c}
  .rfp-plate,.rfp-recipe{background:#1c1c1c;border-color:#2c2c2c}
  .rfp-plate-title{color:#ddd}.rfp-name{color:#bbb}.rfp-sub,.rfp-files{color:#999}
  .rfp-val{background:#262626;color:#aaa}
  .rfp-controls button{background:#222;border-color:#3a3a3a;color:#eee}
  .rfp-controls button[aria-pressed="true"]{background:#eee;border-color:#eee;color:#111}
  .rfp-note{background:#1d1d1d;border-color:#2c2c2c;border-left-color:#555;color:#bbb}
  .rfp-row{border-top-color:#242424}
  .rfp-bar{background:#eee}
}
`.trim();

/** Mode + breakpoint controls. Plain DOM, no dependencies — the page must work from `file://`. */
const CHROME_JS = `
(function(){
  var root=document.documentElement;
  function bind(sel,onPick){
    var btns=[].slice.call(document.querySelectorAll(sel));
    btns.forEach(function(b){
      b.addEventListener("click",function(){
        btns.forEach(function(o){o.setAttribute("aria-pressed",String(o===b));});
        onPick(b.getAttribute("data-value"));
      });
    });
  }
  bind("[data-rfp-mode]",function(v){
    var attr=root.getAttribute("data-rfp-mode-attr");
    if(!attr)return;
    if(v)root.setAttribute(attr,v);else root.removeAttribute(attr);
  });
  bind("[data-rfp-width]",function(v){
    var frame=document.getElementById("rfp-frame");
    if(frame)frame.style.maxWidth=v?v+"px":"";
  });
})();
`.trim();

function renderControls(
  modes: readonly string[],
  modeAttribute: string | undefined,
  breakpoints: Readonly<Record<string, number>>,
): string {
  const parts: string[] = [];

  // A mode toggle is only offered when the adapter told us HOW to switch — otherwise the buttons
  // would be decorative. "Auto" clears the attribute and hands control back to the OS media query.
  if (modeAttribute && modes.length > 0) {
    const buttons = [`<button type="button" data-rfp-mode data-value="" aria-pressed="true">auto</button>`]
      .concat(
        modes.map(
          mode =>
            `<button type="button" data-rfp-mode data-value="${escapeHtml(mode)}" aria-pressed="false">` +
            `${escapeHtml(mode)}</button>`,
        ),
      )
      .join("");
    parts.push(`<div class="rfp-controls"><span class="rfp-group-label">mode</span>${buttons}</div>`);
  }

  const widths = Object.entries(breakpoints);
  if (widths.length > 0) {
    const buttons = [`<button type="button" data-rfp-width data-value="" aria-pressed="true">full</button>`]
      .concat(
        widths.map(
          ([name, px]) =>
            `<button type="button" data-rfp-width data-value="${escapeHtml(String(px))}" aria-pressed="false">` +
            `${escapeHtml(name)} · ${escapeHtml(String(px))}px</button>`,
        ),
      )
      .join("");
    parts.push(`<div class="rfp-controls"><span class="rfp-group-label">width</span>${buttons}</div>`);
  }

  return parts.join("\n");
}

/** `<style>`/`<link>` tags for the emitted artifacts, in the adapter's declared load order. */
function renderThemeLinks(
  stylesheets: readonly string[],
  contents: Readonly<Record<string, string>> | undefined,
  inline: boolean,
): string {
  return stylesheets
    .map(name => {
      const body = inline ? contents?.[name] : undefined;
      return body === undefined
        ? `<link rel="stylesheet" href="./${escapeHtml(name)}">`
        : `<style data-rfp-source="${escapeHtml(name)}">\n${escapeTextElement(body)}\n</style>`;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Build the preview artifact. Pure — returns `filename → contents` for the build layer to write.
 *
 * The adapter's declared `stylesheets` are intersected with `options.files` (what was actually
 * written), so a descriptor that drifts from `emit()` degrades to tokens-only instead of producing a
 * page that silently references a file that isn't there.
 */
export function buildPreview(source: PreviewSource, options: PreviewOptions): PreviewOutput {
  const { usage, preview, tokens, model } = source;
  const fileName = options.file ?? DEFAULT_FILE;
  const inline = options.inline ?? true;

  const written = new Set(options.files);
  const stylesheets = (preview?.stylesheets ?? []).filter(name => written.has(name));
  const live = stylesheets.length > 0;

  const modes = collectModes(model);
  const breakpoints = model.breakpoints ?? {};
  const title = options.title ?? `${usage.format} theme preview`;

  const notes: string[] = [];
  if (!live) {
    notes.push(
      preview?.unavailable ??
        `This theme was built with the ${usage.format} adapter, whose output a browser can't load ` +
          `directly — token values below are exact, but recipes are listed by name only.`,
    );
  }
  for (const note of preview?.notes ?? []) notes.push(note);

  const head = [
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width,initial-scale=1">`,
    `<title>${escapeHtml(title)}</title>`,
    // Theme first, chrome last: equal-specificity ties then resolve in the chrome's favor.
    renderThemeLinks(stylesheets, options.contents, inline),
    `<style>\n${CHROME_CSS}\n</style>`,
  ]
    .filter(Boolean)
    .join("\n");

  const modeAttribute = preview?.modeAttribute;
  const fileList = options.files.length
    ? `<p class="rfp-files">Built files: ${options.files.map(f => `<code>${escapeHtml(f)}</code>`).join(" · ")}</p>`
    : "";

  const body = [
    `<div class="rfp-root">`,
    `<header class="rfp-head">`,
    `<h1 class="rfp-title">${escapeHtml(title)}</h1>`,
    `<span class="rfp-sub">format <strong>${escapeHtml(usage.format)}</strong> · emit ` +
      `<strong>${escapeHtml(options.plan.type)}</strong> · ${usage.recipes.length} recipe(s)</span>`,
    `</header>`,
    fileList,
    notes.map(n => `<p class="rfp-note">${escapeHtml(n)}</p>`).join("\n"),
    renderControls(modes, modeAttribute, breakpoints),
    `<div class="rfp-frame" id="rfp-frame">`,
    `<h2 class="rfp-section-title">Tokens</h2>`,
    renderTokenPlates(tokens),
    `<h2 class="rfp-section-title">Recipes</h2>`,
    renderRecipePlates(usage, preview, live),
    `</div>`,
    `</div>`,
    `<script>\n${CHROME_JS}\n</script>`,
  ]
    .filter(Boolean)
    .join("\n");

  const html =
    `<!doctype html>\n<html lang="en"${modeAttribute ? ` data-rfp-mode-attr="${escapeHtml(modeAttribute)}"` : ""}>\n` +
    `<head>\n${head}\n</head>\n<body>\n${body}\n</body>\n</html>\n`;

  return { files: { [fileName]: html } };
}
