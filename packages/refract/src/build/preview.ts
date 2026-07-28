/**
 * Human-facing preview (Node-only) — render a single `preview.html` **style-guide specimen** of a
 * built theme.
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
 *    over `$type` with per-group specimen overrides, so a new subsystem's tokens still appear (in a
 *    catch-all section) without touching this file.
 *
 *  - **Recipe plates (live).** Require the emitted artifacts to be browser-loadable as-is, which the
 *    adapter alone can answer — see {@link PreviewDescriptor}. Today that means CSS; SCSS needs
 *    compiling, styled-components emits JS modules, JSON has no rendered form. Those adapters say so
 *    in their own words and the page degrades to tokens-only rather than rendering unstyled boxes.
 *
 * Two rules the layout is built on, both learned the hard way:
 *
 *  1. **The chrome is chromatically silent.** The theme owns every saturated pixel; the tool around
 *     it is neutral, and specimen geometry uses a dedicated mid-tone (`--rfp-spec`) rather than the
 *     nearest neutral to hand. Filling a swatch with the page ground makes it vanish the moment the
 *     ground and the stage converge — which is exactly what happens in dark mode.
 *  2. **Never assume the theme is light.** The emitted stylesheet is inlined, so a theme with a
 *     `dark` mode restyles itself under the toggle; the chrome has to survive both, and the page
 *     must not hard-code a light ground under it.
 *
 * Distribution convention deliberately INVERTS `guide`'s: the page **inlines** its stylesheets by
 * default (`inline: false` opts out). `guide` is machine-facing and lives next to the code it
 * documents, so relative references are right there; a preview gets moved, attached, and forwarded,
 * and has to keep working.
 */
import type { ThemeModel, PropertyModel, Ref } from "../core/model/model";
import type {
  NormalizedEmit,
  PreviewDescriptor,
  UsageDescriptor,
  UsageRecipe,
} from "../core/ThemeAdapter";
import { convertHexToRGB, rgbToOklch } from "../subsystems/colors/utils";

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
  /** Page heading + `<title>` (default the theme name, else `"<format> theme"`). */
  readonly title?: string;
};

export interface PreviewOptions extends PreviewConfig {
  /** The file names actually written for this target — the guard against referencing a missing artifact. */
  readonly files: readonly string[];
  /** Emitted file contents by name, for inlining + the byte counts in the masthead. */
  readonly contents?: Readonly<Record<string, string>>;
  /** The normalized emit plan — reported in the masthead and used for layout semantics only. */
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
  /** The built model — supplies appearance modes, breakpoints, and the globals element selectors. */
  readonly model: ThemeModel;
}

const DEFAULT_FILE = "preview.html";

// ---------------------------------------------------------------------------
// Escaping — every value below originates in user-authored theme content
// ---------------------------------------------------------------------------

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * A token value going into a `style="…"` attribute. Declaration/rule terminators are dropped so a
 * value can never break out of its declaration, then the result is HTML-attribute escaped.
 */
const cssValue = (v: unknown): string => esc(String(v).replace(/[;{}<>]/g, "").trim());

/** Inline `<style>`/`<script>` bodies can't contain a literal `</` without ending the element early. */
const escapeTextElement = (s: string): string => s.replace(/<\/(?=[a-zA-Z])/g, "<\\/");

const bytes = (n: number): string => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

// ---------------------------------------------------------------------------
// Token collection — a generic DTCG walk
// ---------------------------------------------------------------------------

interface TokenLeaf {
  readonly path: readonly string[];
  /** The DTCG `$type`, inherited from the nearest ancestor that declares one. */
  readonly type?: string;
  readonly value: unknown;
}

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

/** `<group>` → its leaves, in source order. The group is the token's first path segment. */
function groupLeaves(leaves: readonly TokenLeaf[]): Map<string, TokenLeaf[]> {
  const groups = new Map<string, TokenLeaf[]>();
  for (const leaf of leaves) {
    const key = leaf.path[0] ?? "tokens";
    const bucket = groups.get(key);
    if (bucket) bucket.push(leaf);
    else groups.set(key, [leaf]);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Sections — which DTCG group lands where
// ---------------------------------------------------------------------------

interface SectionDef {
  readonly id: string;
  readonly title: string;
  readonly eyebrow: string;
  readonly note?: string;
}

const SECTIONS: readonly SectionDef[] = [
  { id: "palette", title: "Colour", eyebrow: "Palette",
    note: "Every rung is a token you can reference. A ladder is an absolute lightness scale and the seed is <em>not</em> snapped onto it &mdash; the marked rung is where the family's <code>base</code> lands, not a rung it equals. Click any identifier to copy it." },
  { id: "type", title: "Type scale", eyebrow: "Typography" },
  { id: "space", title: "Spacing and size", eyebrow: "Space",
    note: "There is no separate <code>padding</code> token — spacing <em>is</em> the padding scale, so it is shown both as a measure and as an applied inset." },
  { id: "shape", title: "Borders, radius and elevation", eyebrow: "Shape & depth" },
  { id: "motion", title: "Transitions", eyebrow: "Motion" },
  { id: "layout", title: "Breakpoints", eyebrow: "Layout",
    note: "These drive the Width control at the top — pick one to reflow the whole specimen at that viewport." },
  { id: "other", title: "Other tokens", eyebrow: "Additional" },
];

/**
 * Which section a SUBSYSTEM's recipes belong in.
 *
 * A `colors.solid` rule-set is part of the colour story, not a component — reading it under a
 * "Components" heading twenty plates below the palette it is made of loses the connection. Each
 * subsystem's recipes render inside its own section, in that section's idiom. Anything unmapped
 * (`components`, or a subsystem this file has never heard of) falls through to the components
 * section, which is the honest home for "a thing you compose out of the others".
 */
const RECIPE_SECTION_OF: Readonly<Record<string, string>> = {
  colors: "palette",
  typography: "type",
  layout: "space",
  borders: "shape",
  effects: "shape",
  animation: "motion",
};

/** Group → section. Anything unmapped falls into `other`, so a new subsystem is never dropped. */
const SECTION_OF: Readonly<Record<string, string>> = {
  color: "palette",
  typography: "type",
  spacing: "space", gutters: "space", sizes: "space", aspectRatio: "space",
  radius: "shape", borderWidth: "shape", borderStyle: "shape", outlineOffset: "shape",
  shadow: "shape", blur: "shape", opacity: "shape", zIndex: "shape",
  transition: "motion",
  breakpoint: "layout",
};

// ---------------------------------------------------------------------------
// Specimen builders
// ---------------------------------------------------------------------------

const SPECIMEN_TEXT = "Precision is a design decision";
const LEADING_TEXT =
  "Leading is the quiet half of a type scale. Two lines are the minimum needed to judge it, so this specimen wraps.";

const idButton = (path: string, varName?: string): string =>
  `<button class="rfp-id" type="button">${esc(path)}</button>` +
  (varName ? `<span class="rfp-var">${esc(varName)}</span>` : "");

const leafPath = (leaf: TokenLeaf): string => leaf.path.join(".");
const leafLabel = (leaf: TokenLeaf): string => leaf.path.slice(1).join(".") || leaf.path[0];

/**
 * Split a group's leaves into its `base` and everything else.
 *
 * Colour already does this — the family base is the big swatch, its variants are chips — and the
 * distinction matters just as much for a scale: the base IS the unit the variants are derived
 * from, and burying it as the first row of an undifferentiated list hides that.
 */
function splitBase(leaves: readonly TokenLeaf[]): { base?: TokenLeaf; variants: TokenLeaf[] } {
  const base = leaves.find(l => l.path[l.path.length - 1] === "base");
  return { base, variants: leaves.filter(l => l !== base) };
}

/**
 * How wide to draw a length.
 *
 * Scaling every set so its largest member fills the row is a lie about magnitude: an 80px spacing
 * drawn ~900px wide reads as ten times its value, and 4px vs 8px become indistinguishable from
 * 40px vs 80px. Draw at TRUE SIZE whenever the set fits the column — a reader can then compare a
 * specimen against a ruler, which is the entire point of a measure.
 *
 * Only fall back to proportional when the values simply cannot fit (breakpoints run to 1280px in a
 * ~900px column), and say so on the plate rather than letting the reader assume true scale.
 */
const TRUE_SCALE_LIMIT = 560;
const barWidth = (px: number | undefined, max: number, trueScale: boolean): string =>
  px === undefined ? "100%" : trueScale ? `${px}px` : `${Math.max(1, (px / max) * 100)}%`;

/** Rows preceded by a labelled band, so `base` reads as the unit rather than as another entry. */
const labelledRows = (baseRow: string, variantRows: string): string =>
  baseRow && variantRows
    ? `<div class="rfp-row-label">Base</div><div class="rfp-rows">${baseRow}</div>` +
      `<div class="rfp-row-label">Variants</div><div class="rfp-rows">${variantRows}</div>`
    : `<div class="rfp-rows">${baseRow}${variantRows}</div>`;

/** A three-column row: identifier · specimen · value. */
const rowOf = (id: string, specimen: string, value: string, centred = false): string =>
  `<div class="rfp-row${centred ? " rfp-centred" : ""}"><div>${id}</div>${specimen}` +
  `<div class="rfp-rowval">${esc(value)}</div></div>`;

/** Is this colour-family child a numeric ladder rung (`50`…`900`)? */
const isRung = (name: string): boolean => /^\d+$/.test(name);

/** OKLCH lightness (0–100) of a hex colour, or `undefined` for anything else. */
function lightnessOf(value: string): number | undefined {
  if (!/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(value.trim())) return undefined;
  try {
    return rgbToOklch(convertHexToRGB(value.trim())).L;
  } catch {
    return undefined;
  }
}

/** WCAG relative luminance of a hex colour, or `undefined` when it isn't one. */
function luminance(value: string): number | undefined {
  const hex = value.trim();
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return undefined;
  const n = parseInt(hex.slice(1), 16);
  const ch = (c: number): number => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
}

/** WCAG contrast ratio between two hex colours, or `undefined` if either isn't parseable. */
function contrastRatio(a: string, b: string): number | undefined {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === undefined || lb === undefined) return undefined;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Provenance — did the author write this value, or did refract synthesise it?
 *
 * refract knows, and nothing else in the toolchain does: a literal `Ref` carries `value`, while a
 * synthesised one carries `ref` / `fn` / `modifiers` (a tonal step, a harmony rotation, a
 * derivation chain). It has to be read from the MODEL: the DTCG export resolves both kinds down to
 * a literal, so by the time a token reaches the token plates the distinction is gone.
 */
type Provenance = "src" | "gen";

function colorProvenance(model: ThemeModel): Map<string, Provenance> {
  const out = new Map<string, Provenance>();
  const properties = model.subsystems.colors?.properties ?? {};
  const mark = (path: string, ref: Ref | undefined): void => {
    if (!ref) return;
    const derived = ref.ref !== undefined || ref.fn !== undefined || (ref.modifiers?.length ?? 0) > 0;
    out.set(path, derived ? "gen" : "src");
  };
  for (const [family, property] of Object.entries(properties)) {
    mark(`colors.${family}`, property.base);
    for (const [extra, ref] of Object.entries(property.extras ?? {})) mark(`colors.${family}.${extra}`, ref);
    for (const [variant, model2] of Object.entries(property.variants ?? {})) {
      mark(`colors.${family}.${variant}`, model2.base);
    }
  }
  return out;
}

/**
 * The masthead wears the theme's own first palette — the one place the chrome takes a hue, and it
 * takes the theme's rather than asserting one. Falls back to ink when no colour token parses.
 */
function mastheadColor(leaves: readonly TokenLeaf[]): { bg: string; fg: string } | undefined {
  const usable = (l: TokenLeaf): boolean =>
    l.type === "color" && /^#[0-9a-f]{6}$/i.test(String(l.value).trim());
  // A family's `base` — NOT merely the first colour leaf, which is a ladder rung (`50`) and comes
  // out near-white. Fall back to any colour only when no family declares a base.
  const first = leaves.find(l => usable(l) && l.path[l.path.length - 1] === "base") ?? leaves.find(usable);
  if (!first) return undefined;
  const bg = String(first.value).trim();
  const L = lightnessOf(bg);
  // A light brand needs dark type on it; anything else takes white.
  return { bg, fg: L !== undefined && L > 62 ? "#14171c" : "#ffffff" };
}

/**
 * Which rung the family's `base` LANDS on — never which rung it *is*.
 *
 * A numeric ladder is an absolute lightness scale (`L = (1000 − label) / 10`) and refract
 * deliberately **does not snap** the seed onto it: `refract create` reports where a seed falls
 * (`#4c6ef5` → L 59.1% ≈ 400) rather than moving it. So the base almost never equals a rung, and
 * testing for equality marks nothing. Report the nearest rung by lightness instead — true, and the
 * question a reader actually has.
 */
function baseLandsOn(base: string | undefined, rungs: ReadonlyArray<[string, string]>): string | undefined {
  const baseL = base === undefined ? undefined : lightnessOf(base);
  if (baseL === undefined || rungs.length === 0) return undefined;
  const nominalL = (step: string): number => (1000 - Number(step)) / 10;
  return rungs.reduce(
    (best, [step]) => (Math.abs(nominalL(step) - baseL) < Math.abs(nominalL(best) - baseL) ? step : best),
    rungs[0][0],
  );
}

/** Nearest px magnitude of a dimension value, for bar widths. `undefined` when it has no magnitude. */
function pxOf(value: unknown): number | undefined {
  const match = /^(-?[\d.]+)\s*(px|rem|em)?$/.exec(String(value).trim());
  if (!match) return undefined;
  const n = Number(match[1]);
  if (!Number.isFinite(n)) return undefined;
  return match[2] === "rem" || match[2] === "em" ? n * 16 : n;
}

// ── Colour ─────────────────────────────────────────────────────────────────

interface PaletteResult {
  readonly html: string;
  /** Declared `base` + `text` pairings and how many clear WCAG AA — the masthead headline. */
  readonly pairings: { readonly total: number; readonly passing: number };
}

/**
 * Colour, as one CARD per family.
 *
 * The flat row-per-token list this replaces gave every family the same weight and let them run
 * together; a card gives each family an edge, a large base swatch to judge against, and room to
 * separate what the author WROTE from what refract derived.
 */
function renderPalette(
  leaves: readonly TokenLeaf[],
  model: ThemeModel,
  tokenName?: (p: string) => string | undefined,
): PaletteResult {
  const provenance = colorProvenance(model);
  const tagFor = (path: string): string => {
    const kind = provenance.get(path);
    return kind ? `<span class="rfp-tag rfp-${kind}">${kind}</span>` : "";
  };

  const families = new Map<string, Array<[string, string]>>();
  for (const leaf of leaves) {
    const family = leaf.path[1] ?? "color";
    const member = leaf.path.slice(2).join(".") || "base";
    const bucket = families.get(family);
    if (bucket) bucket.push([member, String(leaf.value)]);
    else families.set(family, [[member, String(leaf.value)]]);
  }

  const cards: string[] = [];
  const singles: string[] = [];
  let total = 0;
  let passing = 0;

  for (const [family, members] of families) {
    const rungs = members.filter(([name]) => isRung(name)).sort((a, b) => Number(a[0]) - Number(b[0]));
    const base = members.find(([name]) => name === "base")?.[1];
    const text = members.find(([name]) => name === "text")?.[1];
    const path = `colors.${family}`;

    // The one contrast pairing the author actually declared.
    let ratioBadge = "";
    if (base && text) {
      const ratio = contrastRatio(base, text);
      if (ratio !== undefined) {
        total += 1;
        if (ratio >= 4.5) passing += 1;
        ratioBadge = contrastBadge(base, text);
      }
    }

    // Everything that isn't the base or a rung is a declared member of THIS family.
    const memberChips = members
      .filter(([name]) => !isRung(name) && name !== "base")
      .map(([member, hex]) => chipOf(`${path}.${member}`, member, hex, tagFor(`${path}.${member}`), tokenName))
      .join("");

    // A family with no internal structure is a one-off, not a palette — those share a grid rather
    // than each taking a whole card to show a single chip.
    if (!rungs.length && !memberChips && base) {
      singles.push(chipOf(path, family, base, tagFor(path), tokenName, text));
      continue;
    }

    const swatch = base ?? rungs[Math.floor(rungs.length / 2)]?.[1];
    if (!swatch) continue;
    const lands = rungs.length >= 3 ? baseLandsOn(base, rungs) : undefined;

    const strip = rungs.length
      ? `<div class="rfp-row-label">Lightness ladder <span class="rfp-tag rfp-gen">gen</span></div>` +
        `<div class="rfp-rungs">` +
        rungs
          .map(([step, hex]) => {
            const isLanding = lands !== undefined && step === lands;
            return (
              `<div class="rfp-rung"${isLanding ? " data-lands" : ""}` +
              ` title="colors.${esc(family)}.${esc(step)} · ${esc(hex)}${isLanding ? " · base lands here" : ""}">` +
              `<div class="rfp-sw" style="background:${cssValue(hex)}"></div>` +
              `<div class="rfp-rung-foot">${esc(step)}</div></div>`
            );
          })
          .join("") +
        `</div>`
      : "";

    const meta = [
      base ? `base ${esc(base)}` : "",
      lands ? `lands &asymp; ${esc(lands)}` : "",
      rungs.length ? `${rungs.length} rungs` : "",
      memberChips ? `${members.filter(([n]) => !isRung(n) && n !== "base").length} member(s)` : "",
    ]
      .filter(Boolean)
      .join(" · ");

    // EVERY family gets its own card — a palette is a unit, and merging three of them into one
    // grid (as an earlier pass did for anything without a ladder) loses exactly the separation
    // that makes a swatch sheet readable.
    cards.push(
      `<section class="rfp-card"><div class="rfp-pal-top">` +
        `<div class="rfp-pal-base" style="background:${cssValue(swatch)}${text ? `;color:${cssValue(text)}` : ""}">${ratioBadge}</div>` +
        `<h3 class="rfp-pal-name">${esc(family)}<small>${meta}</small>` +
        idButton(path, tokenName?.(path)) +
        `</h3></div>` +
        strip +
        (memberChips ? `<div class="rfp-row-label">Declared members</div><div class="rfp-chips">${memberChips}</div>` : "") +
        `</section>`,
    );
  }

  let html = cards.join("");
  if (singles.length) {
    html +=
      `<section class="rfp-card"><div class="rfp-card-head"><span class="rfp-card-name">Single tokens</span>` +
      `<span class="rfp-card-sub">${singles.length} · families with no variants of their own</span></div>` +
      `<div class="rfp-chips">${singles.join("")}</div></section>`;
  }
  return { html, pairings: { total, passing } };
}

/** The WCAG readout for a declared pairing, or "" when either colour can't be parsed. */
function contrastBadge(bg: string, fg: string): string {
  const ratio = contrastRatio(bg, fg);
  if (ratio === undefined) return "";
  const grade = ratio >= 7 ? "AAA" : ratio >= 4.5 ? "AA" : ratio >= 3 ? "AA large" : "fail";
  return `<span class="rfp-ratio">${ratio.toFixed(2)}:1 · ${grade}</span>`;
}

/** One colour chip: swatch (+ contrast when a pairing is declared), label, tag, value. */
function chipOf(
  path: string,
  label: string,
  hex: string,
  tag: string,
  tokenName?: (p: string) => string | undefined,
  pairedText?: string,
): string {
  return (
    `<div class="rfp-chip"><div class="rfp-sw rfp-chip-sw"` +
    ` style="background:${cssValue(hex)}${pairedText ? `;color:${cssValue(pairedText)}` : ""}">` +
    (pairedText ? contrastBadge(hex, pairedText) : "") +
    `</div><div class="rfp-cap"><div class="rfp-lbl">${esc(label)}${tag}</div>` +
    `<div class="rfp-val-sm">${esc(hex)}${pairedText ? ` on ${esc(pairedText)}` : ""}</div>` +
    idButton(path, tokenName?.(path)) +
    `</div></div>`
  );
}

// ── Typography ─────────────────────────────────────────────────────────────

function renderTypography(leaves: readonly TokenLeaf[], tokenName?: (p: string) => string | undefined): string {
  const byProp = new Map<string, TokenLeaf[]>();
  for (const leaf of leaves) {
    const prop = leaf.path[1] ?? "typography";
    const bucket = byProp.get(prop);
    if (bucket) bucket.push(leaf);
    else byProp.set(prop, [leaf]);
  }

  const out: string[] = [];
  for (const [prop, items] of byProp) {
    const render = (leaf: TokenLeaf): string => {
        const path = leafPath(leaf);
        const id = idButton(path, tokenName?.(path));
        const value = String(leaf.value);
        if (prop === "fontSize") {
          return rowOf(id, `<div class="rfp-specimen" style="font-size:${cssValue(value)}">${SPECIMEN_TEXT}</div>`, value);
        }
        if (prop === "fontFamily") {
          return rowOf(id, `<div class="rfp-specimen" style="font-family:${cssValue(value)}">${SPECIMEN_TEXT}</div>`, value);
        }
        if (prop === "fontWeight") {
          return rowOf(id, `<div class="rfp-specimen" style="font-weight:${cssValue(value)}">${SPECIMEN_TEXT}</div>`, value);
        }
        if (prop === "lineHeight") {
          // One line tells you nothing about leading — the specimen has to wrap.
          return rowOf(id, `<div class="rfp-leading" style="line-height:${cssValue(value)}">${LEADING_TEXT}</div>`, value);
        }
        if (prop === "letterSpacing") {
          return rowOf(
            id,
            `<div class="rfp-specimen" style="font-size:22px;letter-spacing:${cssValue(value)}">${SPECIMEN_TEXT}</div>`,
            value,
          );
        }
        return rowOf(id, `<div class="rfp-specimen">${esc(value)}</div>`, value);
    };
    const { base, variants } = splitBase(items);
    out.push(
      plate(
        `typography.${prop}`,
        `${items.length} token(s)`,
        labelledRows(base ? render(base) : "", variants.map(render).join("")),
      ),
    );
  }
  return out.join("");
}

// ── Space ──────────────────────────────────────────────────────────────────

function renderSpace(groups: Map<string, TokenLeaf[]>, tokenName?: (p: string) => string | undefined): string {
  const out: string[] = [];

  for (const group of ["spacing", "gutters", "sizes", "aspectRatio"]) {
    const leaves = groups.get(group);
    if (!leaves?.length) continue;

    if (group === "aspectRatio") {
      const tiles = leaves
        .map(leaf => {
          const path = leafPath(leaf);
          const ratio = String(leaf.value);
          return tile(
            `<div class="rfp-obj" style="width:84px;aspect-ratio:${cssValue(ratio)};height:auto;border-radius:4px"></div>`,
            idButton(path, tokenName?.(path)),
            ratio,
          );
        })
        .join("");
      out.push(plate(`layout.${group}`, `${leaves.length} token(s)`, `<div class="rfp-tiles">${tiles}</div>`));
      continue;
    }

    const max = Math.max(...leaves.map(l => pxOf(l.value) ?? 0), 1);
    const trueScale = max <= TRUE_SCALE_LIMIT;
    const render = (leaf: TokenLeaf): string => {
      const path = leafPath(leaf);
      const px = pxOf(leaf.value);
      // A gutter is "spacing between content tracks" — so render the tracks. The hatching is the
      // gutter itself, matching the applied-inset plate where hatch always means measured space.
      const specimen =
        group === "gutters"
          ? `<div class="rfp-tracks" style="gap:${cssValue(leaf.value)}"><i></i><i></i><i></i></div>`
          : `<div class="rfp-bar${group === "spacing" ? "" : " rfp-ghost"}" style="width:${barWidth(px, max, trueScale)}"></div>`;
      return rowOf(idButton(path, tokenName?.(path)), specimen, String(leaf.value), true);
    };

    const { base, variants } = splitBase(leaves);
    const scaleNote = group === "gutters" ? "" : trueScale ? " · true scale" : " · scaled to fit";
    const subtitle =
      group === "gutters"
        ? `${leaves.length} steps · the space between content tracks (<code>column-gap</code> / <code>row-gap</code> / <code>gap</code> in grid, flex and multi-column)`
        : `${leaves.length} steps${scaleNote}`;
    out.push(
      plate(
        `layout.${group}`,
        subtitle,
        labelledRows(base ? render(base) : "", variants.map(render).join("")),
      ),
    );

    // Spacing gets two applied views on top of the measure: there is no `padding` token, so this is
    // the only place a reader can see what a step feels like as an inset or a gap.
    if (group === "spacing") {
      const applied = leaves.filter(l => (pxOf(l.value) ?? 0) > 0).slice(0, 6);
      if (applied.length) {
        const insets = applied
          .map(leaf => {
            const path = leafPath(leaf);
            return (
              `<div class="rfp-tile"><div class="rfp-inset" style="padding:${cssValue(leaf.value)}">` +
              `<div class="rfp-inset-core">${esc(String(leaf.value))}</div></div>` +
              `<div>${idButton(path, tokenName?.(path))}</div></div>`
            );
          })
          .join("");
        out.push(
          plate(
            `layout.${group}`,
            "applied as padding — hatching is the inset, solid is the content box",
            `<div class="rfp-tiles">${insets}</div>`,
          ),
        );

        const gaps = applied
          .slice(0, 4)
          .map(leaf =>
            rowOf(
              idButton(leafPath(leaf), tokenName?.(leafPath(leaf))),
              `<div class="rfp-gap" style="gap:${cssValue(leaf.value)}"><i></i><i></i><i></i><i></i></div>`,
              String(leaf.value),
              true,
            ),
          )
          .join("");
        out.push(plate(`layout.${group}`, "applied as gap", `<div class="rfp-rows">${gaps}</div>`));
      }
    }
  }
  return out.join("");
}

// ── Shape & depth ──────────────────────────────────────────────────────────

function renderShape(groups: Map<string, TokenLeaf[]>, tokenName?: (p: string) => string | undefined): string {
  const out: string[] = [];

  const tilesFor = (group: string, build: (leaf: TokenLeaf) => string, sub?: string): void => {
    const leaves = groups.get(group);
    if (!leaves?.length) return;
    const asTile = (leaf: TokenLeaf): string =>
      tile(build(leaf), idButton(leafPath(leaf), tokenName?.(leafPath(leaf))), String(leaf.value));
    const { base, variants } = splitBase(leaves);
    const body =
      base && variants.length
        ? `<div class="rfp-row-label">Base</div><div class="rfp-tiles">${asTile(base)}</div>` +
          `<div class="rfp-row-label">Variants</div><div class="rfp-tiles">${variants.map(asTile).join("")}</div>`
        : `<div class="rfp-tiles">${leaves.map(asTile).join("")}</div>`;
    out.push(plate(group, sub ?? `${leaves.length} token(s)`, body));
  };

  tilesFor("radius", l => `<div class="rfp-obj" style="border-radius:${cssValue(l.value)}"></div>`);
  // The stroke is the subject here, so the box must NOT be filled.
  tilesFor("borderWidth", l => `<div class="rfp-obj rfp-outlined" style="border:${cssValue(l.value)} solid currentColor;border-radius:8px"></div>`);
  tilesFor("borderStyle", l => `<div class="rfp-obj rfp-outlined" style="border:3px ${cssValue(l.value)} currentColor;border-radius:8px"></div>`);
  tilesFor("outlineOffset", l => `<div class="rfp-obj rfp-outlined" style="border-radius:8px;outline:2px solid currentColor;outline-offset:${cssValue(l.value)}"></div>`);
  tilesFor("shadow", l => `<div class="rfp-obj rfp-raised" style="border-radius:8px;box-shadow:${cssValue(l.value)}"></div>`);
  // Blur and opacity need a saturated fill: a mid-grey at .38 is indistinguishable from the stage.
  tilesFor("blur", l => `<div class="rfp-obj rfp-accent" style="border-radius:8px;filter:blur(${cssValue(l.value)})"></div>`);
  tilesFor("opacity", l => `<div class="rfp-obj rfp-accent" style="border-radius:8px;opacity:${cssValue(l.value)}"></div>`);
  tilesFor("zIndex", l => `<span class="rfp-numeral">${esc(String(l.value))}</span>`);

  return out.join("");
}

// ── Motion ─────────────────────────────────────────────────────────────────

function renderMotion(leaves: readonly TokenLeaf[], tokenName?: (p: string) => string | undefined): string {
  const rows = leaves
    .map(leaf => {
      const path = leafPath(leaf);
      const value = String(leaf.value);
      return rowOf(
        idButton(path, tokenName?.(path)),
        `<div class="rfp-track"><i class="rfp-dot" style="transition:transform ${cssValue(value)}"></i></div>`,
        value,
        true,
      );
    })
    .join("");
  return plate(
    "effects.transitions",
    `${leaves.length} token(s)`,
    `<div class="rfp-rows">${rows}</div>`,
    `<button class="rfp-play" type="button" id="rfp-play">Play</button>`,
  );
}

// ── Generic fallback (unknown groups keep their tokens visible) ─────────────

function renderGeneric(group: string, leaves: readonly TokenLeaf[], tokenName?: (p: string) => string | undefined): string {
  // A dimension has magnitude, so show magnitude — breakpoints in particular read as a set of
  // widths, which a column of bare labels doesn't convey at all.
  const max = Math.max(...leaves.map(l => pxOf(l.value) ?? 0), 1);
  const trueScale = max <= TRUE_SCALE_LIMIT;
  const render = (leaf: TokenLeaf): string => {
    const px = pxOf(leaf.value);
    const specimen =
      leaf.type === "dimension" && px !== undefined && px > 0
        ? `<div class="rfp-bar rfp-ghost" style="width:${barWidth(px, max, trueScale)}"></div>`
        : `<div class="rfp-specimen">${esc(leafLabel(leaf))}</div>`;
    return rowOf(
      idButton(leafPath(leaf), tokenName?.(leafPath(leaf))),
      specimen,
      String(leaf.value),
      leaf.type === "dimension",
    );
  };
  const { base, variants } = splitBase(leaves);
  const dimensional = leaves.some(l => l.type === "dimension");
  const subtitle = `${leaves.length} token(s)${dimensional ? (trueScale ? " · true scale" : " · scaled to fit") : ""}`;
  return plate(group, subtitle, labelledRows(base ? render(base) : "", variants.map(render).join("")));
}

// ── Shared bits ────────────────────────────────────────────────────────────

const plate = (name: string, sub: string, body: string, action = ""): string =>
  `<section class="rfp-card"><div class="rfp-card-head">` +
  `<span class="rfp-card-name">${esc(name)}</span><span class="rfp-card-sub">${sub}</span>${action}` +
  `</div>${body}</section>`;

const tile = (stage: string, id: string, value: string): string =>
  `<div class="rfp-tile"><div class="rfp-stage">${stage}</div>` +
  `<div>${id}<span class="rfp-hex">${esc(value)}</span></div></div>`;

// ---------------------------------------------------------------------------
// Model-derived plates: modes, base elements
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

/** A literal `Ref` reads straight off `value`; a derived/aliased one has to be skipped honestly. */
const literalOf = (ref: Ref | undefined): string | undefined => {
  if (!ref || ref.value === undefined || ref.value === null) return undefined;
  if (typeof ref.value === "object") return undefined;
  return String(ref.value);
};

interface ModeChange {
  readonly path: string;
  readonly mode: string;
  readonly from?: string;
  readonly to: string;
}

/**
 * Which tokens actually carry a mode override. The toggle shows the *result*; this shows the
 * *cause* — and the tokens that DIDN'T override are usually the surprise worth catching.
 * Derived (non-literal) overrides are counted but not tabled, since there's no honest value to show.
 */
function collectModeChanges(model: ThemeModel): { changes: ModeChange[]; skipped: number } {
  const changes: ModeChange[] = [];
  let skipped = 0;

  const walk = (subsystem: string, name: string, property: PropertyModel): void => {
    for (const override of property.modes ?? []) {
      if (!override.mode) continue;
      for (const [field, ref] of Object.entries(override.overrides ?? {})) {
        const to = literalOf(ref);
        const suffix = [override.target, field === "base" ? undefined : field].filter(Boolean).join(".");
        const path = `${subsystem}.${name}${suffix ? `.${suffix}` : ""}`;
        if (to === undefined) {
          skipped += 1;
          continue;
        }
        const from =
          field === "base" && !override.target
            ? literalOf(property.base)
            : literalOf(property.extras?.[field]) ?? literalOf(property.variants?.[override.target ?? ""]?.base);
        changes.push({ path, mode: override.mode, from, to });
      }
    }
  };

  for (const [subsystem, sub] of Object.entries(model.subsystems)) {
    for (const [name, property] of Object.entries(sub.properties ?? {})) walk(subsystem, name, property);
  }
  return { changes, skipped };
}

function renderModes(model: ThemeModel, totalTokens: number, tokenName?: (p: string) => string | undefined): string {
  const modes = collectModes(model);
  if (!modes.length) return "";
  const { changes, skipped } = collectModeChanges(model);
  if (!changes.length && !skipped) return "";

  const rows = changes
    .map(
      c =>
        `<tr><td>${idButton(c.path, tokenName?.(c.path))}</td>` +
        `<td>${swatchCell(c.from)}</td><td class="rfp-arrow">&rarr;</td><td>${swatchCell(c.to)}</td></tr>`,
    )
    .join("");

  const note = skipped
    ? `<p class="rfp-note-sm">${skipped} further override(s) resolve through a derivation, so they carry no single literal to show here.</p>`
    : "";

  return (
    `<section class="rfp-section" id="rfp-modes"><div class="rfp-section-head">` +
    `<h2>What changes in ${esc(modes.join(" / "))}</h2>` +
    `<span class="rfp-count">${modes.length} mode(s) declared</span></div>` +
    `<p class="rfp-note">Flipping the toggle shows you the result; this shows the cause. Only these tokens carry an override — everything else is inherited.</p>` +
    plate(
      `mode: ${modes.join(", ")}`,
      `${changes.length} of ${totalTokens} tokens overridden`,
      `<div class="rfp-scroll"><table class="rfp-diff"><thead><tr><th>Token</th><th>Base</th><th></th><th>Override</th></tr></thead>` +
        `<tbody>${rows}</tbody></table></div>${note}`,
    ) +
    `</section>`
  );
}

const swatchCell = (value?: string): string => {
  if (value === undefined) return `<span class="rfp-hex">—</span>`;
  const isColor = /^(#|rgb|hsl|oklch|color\()/i.test(value.trim());
  return (
    `<span class="rfp-swatch-cell">` +
    (isColor ? `<i class="rfp-chip" style="background:${cssValue(value)}"></i>` : "") +
    `<span class="rfp-hex">${esc(value)}</span></span>`
  );
};

/**
 * The `globals` subsystem themes bare elements — no class involved — so a prose specimen is the only
 * way to show them. The selectors come from the model; the emitted stylesheet does the styling.
 */
function renderGlobals(model: ThemeModel, live: boolean): string {
  const groups = model.subsystems.globals?.ruleSets;
  if (!groups || !live) return "";
  const selectors = Object.keys(groups.elements ?? {});
  if (!selectors.length) return "";

  const has = (sel: string): boolean => selectors.some(s => s === sel || s.startsWith(`${sel}.`) || s.startsWith(`${sel}:`));
  const parts: string[] = [];
  if (has("h1")) parts.push(`<h1>Shipping a theme</h1>`);
  parts.push(
    `<p>A theme compiles once and lowers to every format you target — the same source produces CSS custom ` +
      `properties, Sass partials, a JSON document, or styled-components modules` +
      (has("a") ? ` <a href="#rfp-recipes">without re-authoring a single value</a>` : "") +
      `.</p>`,
  );
  if (has("h2")) parts.push(`<h2>Why bare elements matter</h2>`);
  parts.push(
    `<p>Content you don't control — a CMS body field, rendered markdown, a third-party embed — arrives ` +
      `without your class names. Theming the elements themselves is what keeps it consistent.</p>`,
  );
  if (has("ul")) {
    parts.push(
      `<ul><li>Headings inherit the type scale and its derived leading</li>` +
        `<li>Links pick up the brand colour and its underline treatment</li>` +
        `<li>Variants emit only the delta from their base rule</li></ul>`,
    );
  }
  if (has("blockquote")) {
    parts.push(`<blockquote>Structural devices should encode something true about the content, not decorate it.</blockquote>`);
  }
  if (has("hr")) parts.push(`<hr>`);
  if (has("h3")) parts.push(`<h3>Variants are structural deltas</h3>`);

  return (
    `<section class="rfp-section" id="rfp-globals"><div class="rfp-section-head">` +
    `<h2>Unclassed markup</h2>` +
    `<span class="rfp-count">globals.elements · ${selectors.length}</span></div>` +
    `<p class="rfp-note">These style bare elements with no class involved, so plain HTML from a CMS or a markdown ` +
      `pipeline already looks right. Nothing else in this document renders without a class.</p>` +
    plate(
      "globals.elements",
      `${selectors.length} selector(s) · ${esc(selectors.join(", "))}`,
      `<div class="rfp-prose">${parts.join("")}</div>`,
    ) +
    `</section>`
  );
}

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

/**
 * CSS properties that give a rule-set a size of its own. Anything here means the specimen already
 * knows how big it wants to be; anything else (a pure colour rule) collapses to its text.
 */
const SIZING = [
  "width", "height", "minwidth", "minheight", "maxwidth", "maxheight",
  "padding", "inlinesize", "blocksize", "aspectratio", "flexbasis", "flex", "size",
];

/**
 * Every CSS property a recipe declares, including those it inherits by composition, normalized to
 * lowercase kebab. One walk serves both the sizing question and the visibility question below.
 */
function declarationKeys(model: ThemeModel, recipe: UsageRecipe, seen = new Set<string>()): Set<string> {
  const keys = new Set<string>();
  const address = `${recipe.subsystem}.${recipe.group}.${recipe.variant}`;
  if (seen.has(address)) return keys;
  seen.add(address);

  const ruleSet = model.subsystems[recipe.subsystem]?.ruleSets?.[recipe.group]?.[recipe.variant];
  if (!ruleSet) return keys;
  for (const key of Object.keys(ruleSet.declarations ?? {})) {
    keys.add(key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase());
  }
  for (const reference of ruleSet.references ?? []) {
    const [subsystem, rest] = reference.split(":");
    const dot = rest?.indexOf(".") ?? -1;
    if (!subsystem || !rest || dot < 0) continue;
    for (const key of declarationKeys(model, { subsystem, group: rest.slice(0, dot), variant: rest.slice(dot + 1), name: "" }, seen)) {
      keys.add(key);
    }
  }
  return keys;
}

/**
 * Properties that paint NOTHING on their own.
 *
 * `border-color` without a width and style is invisible — a `colors.border` recipe emits exactly
 * that one declaration and renders a completely blank box. The specimen has to supply the missing
 * companion so the colour can be seen, and then SAY it did: a reader must never conclude their
 * theme sets a 3px border when the preview added it.
 *
 * Only applied when the recipe doesn't declare the companion itself.
 */
const REVEALS: ReadonlyArray<{
  readonly needs: RegExp;
  readonly companions: readonly string[];
  readonly style: string;
  readonly label: string;
}> = [
  {
    needs: /^border(-(top|right|bottom|left|inline|block)(-(start|end))?)?-color$/,
    companions: ["border-style", "border-width", "border"],
    style: "border-style:solid;border-width:3px",
    label: "border-width + border-style",
  },
  {
    needs: /^outline-color$/,
    companions: ["outline-style", "outline-width", "outline"],
    style: "outline-style:solid;outline-width:3px;outline-offset:2px",
    label: "outline-width + outline-style",
  },
  // The symmetric case, and just as invisible: `border-style` initial value is `none`, so a
  // rule-set that sets only a width paints nothing either. `border-color` needs no companion here
  // — its initial value is `currentColor`, which is visible.
  {
    needs: /^border(-(top|right|bottom|left|inline|block)(-(start|end))?)?-width$/,
    companions: ["border-style", "border"],
    style: "border-style:solid",
    label: "border-style",
  },
  {
    needs: /^outline-width$/,
    companions: ["outline-style", "outline"],
    style: "outline-style:solid",
    label: "outline-style",
  },
  {
    needs: /^text-decoration-color$/,
    companions: ["text-decoration-line", "text-decoration"],
    style: "text-decoration-line:underline;text-decoration-thickness:3px",
    label: "text-decoration-line",
  },
  {
    needs: /^column-rule-color$/,
    companions: ["column-rule-style", "column-rule-width", "column-rule"],
    style: "column-rule-style:solid;column-rule-width:3px",
    label: "column-rule-width + style",
  },
];

interface Reveal {
  /** Inline declarations the preview supplies so the recipe's own values become visible. */
  readonly style: string;
  /** What was supplied, for the on-page disclosure. */
  readonly labels: readonly string[];
}

function revealFor(keys: ReadonlySet<string>): Reveal | undefined {
  const styles: string[] = [];
  const labels: string[] = [];
  for (const reveal of REVEALS) {
    const declares = [...keys].some(key => reveal.needs.test(key));
    if (!declares) continue;
    if (reveal.companions.some(c => keys.has(c))) continue; // the theme supplies it already
    styles.push(reveal.style);
    labels.push(reveal.label);
  }
  return styles.length ? { style: styles.join(";"), labels } : undefined;
}

/**
 * Does this recipe size itself?
 *
 * A colour recipe (`background` + `color`, nothing else) has no dimensions, so it renders as a
 * text-sized blob adrift on the stage — which tells you almost nothing about the colour. Those
 * specimens fill their stage and read as a swatch instead. A recipe that declares its own padding
 * must NOT be stretched: its real size IS the thing being shown.
 */
function hasIntrinsicSize(model: ThemeModel, recipe: UsageRecipe): boolean {
  // A `components` rule-set IS a component: show it at whatever size it really is, even when that
  // is text-sized, because that is the truth about the recipe. Stretching a button to fill its
  // stage would misrepresent it. Filling is for rule-sets that express a *value* — a colour, a
  // surface — where the swatch is the point and the box is arbitrary.
  if (recipe.subsystem === "components") return true;
  return [...declarationKeys(model, recipe)].some(key => {
    const k = key.replace(/-/g, "");
    return SIZING.some(prop => k === prop || k.startsWith(prop));
  });
}

function inferTag(recipe: UsageRecipe): string {
  const group = recipe.group.toLowerCase();
  if (group.includes("button") || group.includes("btn")) return "button";
  if (group.includes("input") || group.includes("field")) return "input";
  if (group.includes("link") || group.includes("anchor")) return "a";
  if (group.includes("badge") || group.includes("chip") || group.includes("tag") || group.includes("label")) return "span";
  return "div";
}

/**
 * A layout rule-set expresses a *measure*, and a measure needs something to measure against.
 *
 * `layout.spacing` tokens already get this right — a hatched inset with a solid core, a row of
 * blocks with a gap between them. The recipes made of those same tokens were rendering as bare
 * boxes: padding with no contrast between inset and content, and `gap`, which does literally
 * nothing on an element with one child, showing absolutely nothing at all.
 *
 * So a layout recipe borrows its own section's idiom. As with REVEALS, the scaffolding is the
 * preview's and is disclosed as such.
 */
function layoutDemo(keys: ReadonlySet<string>): { kind: "inset" | "gap"; label: string } | undefined {
  // A rule-set that also sets a width, height or margin is a STRUCTURE (a centring container, a
  // grid) rather than a measure — it has a real size of its own and should be shown at it. Only a
  // pure measure gets the hatched inset / gap demo.
  const structural = /^(width|height|min-|max-|margin|flex|aspect-ratio|inline-size|block-size)/;
  if ([...keys].some(key => structural.test(key))) return undefined;

  if ([...keys].some(key => /^padding/.test(key))) {
    return { kind: "inset", label: "a content box, so the inset is visible" };
  }
  if ([...keys].some(key => key === "gap" || /^(row|column)-gap$/.test(key))) {
    return { kind: "gap", label: "display:flex + sample items, so the gap is visible" };
  }
  return undefined;
}

/** Does this rule-set emit anything at all? Composition counts — a reference paints via its class. */
function emitsNothing(model: ThemeModel, recipe: UsageRecipe): boolean {
  const ruleSet = model.subsystems[recipe.subsystem]?.ruleSets?.[recipe.group]?.[recipe.variant];
  if (!ruleSet) return false;
  return (
    Object.keys(ruleSet.declarations ?? {}).length === 0 &&
    (ruleSet.references?.length ?? 0) === 0 &&
    (ruleSet.overrides?.length ?? 0) === 0
  );
}

/**
 * The on-page disclosure for a supplied companion. Without this the page would quietly imply the
 * theme sets a 3px border, which is exactly the kind of small lie a specimen sheet must not tell.
 */
const aidNote = (reveal: Reveal): string =>
  `<span class="rfp-aid" title="Not part of your theme — added so the declared colour is visible">` +
  `preview adds ${esc(reveal.labels.join(" · "))}</span>`;

/**
 * A layout measure rendered the way its own section renders tokens: the recipe's real class carries
 * the padding or the gap, and the preview supplies only what makes that measure legible.
 */
function measureSpecimen(
  recipe: UsageRecipe,
  descriptor: PreviewDescriptor | undefined,
  kind: "inset" | "gap",
): string | undefined {
  const cls = descriptor?.markup?.(recipe)?.attrs.class;
  if (!cls) return undefined;
  return kind === "inset"
    ? `<div class="${esc(cls)} rfp-demo-inset"><span class="rfp-inset-core">${esc(recipe.variant)}</span></div>`
    : `<div class="${esc(cls)} rfp-demo-gap"><i></i><i></i><i></i><i></i></div>`;
}

/** One rendered specimen. `pin` adds the adapter's state-pinning class so a state can be shown at rest. */
function specimen(
  recipe: UsageRecipe,
  descriptor: PreviewDescriptor | undefined,
  pin?: string,
  fill?: boolean,
  reveal?: string,
): string | undefined {
  const markup = descriptor?.markup?.(recipe);
  if (!markup) return undefined;
  const tag = markup.tag ?? inferTag(recipe);
  const attrs = { ...markup.attrs };
  if (pin) attrs.class = `${attrs.class ?? ""} ${pin}`.trim();
  if (fill) attrs.class = `${attrs.class ?? ""} rfp-fill`.trim();
  // Supplied by the preview, never by the theme — see REVEALS.
  if (reveal) attrs.style = `${attrs.style ? `${attrs.style};` : ""}${reveal}`;
  const rendered = Object.entries(attrs)
    .map(([k, v]) => ` ${esc(k)}="${esc(v)}"`)
    .join("");
  if (tag === "input") return `<input${rendered} value="${esc(recipe.variant)}" readonly aria-label="${esc(recipe.variant)}">`;
  return `<${tag}${rendered}>${esc(recipe.variant)}</${tag}>`;
}

function renderRecipes(
  recipes_: readonly UsageRecipe[],
  descriptor: PreviewDescriptor | undefined,
  live: boolean,
  model: ThemeModel,
  emptyNotice = true,
): string {
  const usage = { recipes: recipes_ } as UsageDescriptor;
  if (usage.recipes.length === 0) {
    if (!emptyNotice) return "";
    // The scaffolder writes tokens and no recipes, so this is the FIRST thing a new user sees here.
    return (
      `<div class="rfp-notice"><span class="rfp-notice-mark">Empty</span><div>` +
      `<p><strong>No recipes yet — this theme is tokens only.</strong> Tokens are values; recipes are the ` +
      `rule-sets that turn them into styled components. Add a <code>recipes</code> block to a subsystem in ` +
      `your raw theme and rebuild — they'll render here.</p></div></div>`
    );
  }

  // Group for layout: the adapter decides (subsystem, component file, …); default is by group.
  const groups = new Map<string, UsageRecipe[]>();
  for (const recipe of usage.recipes) {
    const key = descriptor?.groupBy?.(recipe) ?? `${recipe.subsystem}.${recipe.group}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(recipe);
    else groups.set(key, [recipe]);
  }

  const out: string[] = [];
  for (const [group, recipes] of groups) {
    // A state matrix beats one specimen per card: states are the whole point of a component sheet,
    // and side by side is the only way to tell whether hover and active are distinguishable.
    const states = live
      ? [...new Set(recipes.flatMap(r => descriptor?.states?.(r) ?? []))].filter(s => descriptor?.statePinClass?.(s))
      : [];

    if (states.length && descriptor?.markup) {
      const head = ["base", ...states].map(s => `<th>${esc(s)}</th>`).join("");
      const body = recipes
        .map(recipe => {
          const own = descriptor.states?.(recipe) ?? [];
          // A stateful colour recipe is still a colour recipe: give its cells the same swatch
          // treatment the stateless grid gets, or `colors.container` reads as tiny blobs beside
          // `colors.surface`'s full swatches for no reason a reader can see.
          const keys = declarationKeys(model, recipe);
          const fill = !hasIntrinsicSize(model, recipe);
          const reveal = revealFor(keys);
          const cells = ["base", ...states]
            .map(state => {
              if (state !== "base" && !own.includes(state)) return `<td class="rfp-none">—</td>`;
              const pin = state === "base" ? undefined : descriptor.statePinClass?.(state);
              return `<td>${specimen(recipe, descriptor, pin, fill, reveal?.style) ?? ""}</td>`;
            })
            .join("");
          return (
            `<tr><td><span class="rfp-addr">${esc(`${recipe.subsystem}.${recipe.group}.${recipe.variant}`)}</span>` +
            `<button class="rfp-id" type="button">${esc(recipe.name)}</button>` +
            (reveal ? aidNote(reveal) : "") +
            `</td>${cells}</tr>`
          );
        })
        .join("");
      out.push(
        plate(
          group,
          `${recipes.length} variant(s) × ${states.length} state(s)`,
          `<div class="rfp-scroll"><table class="rfp-matrix"><thead><tr><th>Variant</th>${head}</tr></thead>` +
            `<tbody>${body}</tbody></table></div>`,
        ),
      );
      out.push(renderComposition(recipes, descriptor));
      continue;
    }

    const cards = recipes
      .map(recipe => {
        // A recipe with no dimensions of its own reads as a swatch, so let it fill the stage
        // rather than float in the middle of it as a text-sized blob.
        const empty = live && emitsNothing(model, recipe);
        const keys = live && !empty ? declarationKeys(model, recipe) : new Set<string>();
        const demo = recipe.subsystem === "layout" ? layoutDemo(keys) : undefined;
        const fill = live && !empty && !demo && !hasIntrinsicSize(model, recipe);
        const reveal = live && !empty && !demo ? revealFor(keys) : undefined;
        const rendered = live && !empty
          ? demo
            ? measureSpecimen(recipe, descriptor, demo.kind)
            : specimen(recipe, descriptor, undefined, fill, reveal?.style)
          : undefined;
        const aid = reveal ?? (demo ? { style: "", labels: [demo.label] } : undefined);
        return (
          `<div class="rfp-recipe">` +
          (rendered ? `<div class="rfp-recipe-stage${fill ? " rfp-stage-fill" : ""}">${rendered}</div>` : "") +
          (empty
            ? `<div class="rfp-recipe-stage"><span class="rfp-empty">emits no declarations</span></div>`
            : "") +
          `<div class="rfp-recipe-foot"><span class="rfp-addr">` +
          esc(`${recipe.subsystem}.${recipe.group}.${recipe.variant}`) +
          `</span><button class="rfp-id" type="button">${esc(recipe.name)}</button>` +
          (aid ? aidNote(aid) : "") +
          `</div></div>`
        );
      })
      .join("");
    out.push(plate(group, `${recipes.length} variant(s)`, `<div class="rfp-recipes">${cards}</div>`));
    out.push(renderComposition(recipes, descriptor));
  }
  return out.join("");
}

/**
 * A composed recipe emits a class LIST, not one class — its referenced recipes plus its own delta.
 * Showing the string without saying why it's two classes is the kind of thing that reads as a bug.
 */
function renderComposition(recipes: readonly UsageRecipe[], descriptor: PreviewDescriptor | undefined): string {
  if (!descriptor?.composition) return "";
  for (const recipe of recipes) {
    const parts = descriptor.composition(recipe);
    if (!parts || parts.length < 2) continue;
    const chips = parts
      .map(
        (p, i) =>
          (i ? `<span class="rfp-plus">+</span>` : "") +
          `<span class="rfp-cls"><b>${esc(p.className)}</b>` +
          `<span>${p.from ? ` · from ${esc(p.from)}` : " · own delta"}</span></span>`,
      )
      .join("");
    return plate(
      "Composition",
      `why <code>${esc(recipe.variant)}</code> carries ${parts.length} classes`,
      `<div class="rfp-compose">${chips}</div>` +
        `<p class="rfp-note-sm">Order matters — the delta lands last, so it wins on equal specificity.</p>`,
    );
  }
  return "";
}

/**
 * The contents cover. Built from the sections that actually rendered, so it shrinks with the theme
 * rather than advertising plates that aren't there. Accent bars borrow the theme's own colour.
 */
function renderIndex(
  bodies: ReadonlyMap<string, string>,
  counts: ReadonlyMap<string, number>,
  accent: string | undefined,
): string {
  const present = SECTIONS.filter(s => bodies.has(s.id));
  if (present.length < 2) return "";

  const cards = present
    .map((section, i) => {
      const n = String(i + 1).padStart(2, "0");
      const count = counts.get(section.id) ?? 0;
      return (
        `<a class="rfp-idx" href="#rfp-${section.id}" style="text-decoration:none;color:inherit">` +
        `<span class="rfp-accent" style="background:${accent ? cssValue(accent) : "var(--rfp-spec)"}"></span>` +
        `<div class="rfp-no">${n} · ${esc(section.eyebrow.toUpperCase())}</div>` +
        `<h3>${section.title} <span>${count} token(s)</span></h3>` +
        (section.note ? `<p>${section.note}</p>` : "") +
        `</a>`
      );
    })
    .join("");

  return (
    `<section class="rfp-section" id="rfp-index"><div class="rfp-section-head"><h2>Index</h2>` +
    `<span class="rfp-count">${present.length} sections</span></div>` +
    `<p class="rfp-note">A section appears only when the theme has tokens of that kind, so this list ` +
    `is the shape of the theme rather than a fixed table of contents.</p>` +
    `<div class="rfp-index">${cards}</div></section>`
  );
}

// ---------------------------------------------------------------------------
// Page chrome
// ---------------------------------------------------------------------------

/**
 * The preview's own styling. Two rules it exists to enforce:
 *
 *  - **Class-only selectors**, all under `.rfp`, emitted AFTER the theme — so a themed `body`/`h1`
 *    rule from the `globals` subsystem can never outrank the tool around it.
 *  - **`--rfp-spec` for specimen geometry.** Filling a swatch with the page ground makes it vanish
 *    once the ground and the stage converge, which is precisely what happens in dark mode; using
 *    the ink instead makes light mode a wall of near-black blobs competing with the theme. A
 *    dedicated mid-tone reads at the same weight on both grounds.
 */
const CHROME_CSS = `
.rfp{--rfp-paper:#f5f6f8;--rfp-card:#fff;--rfp-sunk:#f0f2f5;--rfp-ink:#14171c;--rfp-ink-2:#4d5563;
 --rfp-ink-3:#79818f;--rfp-line:#e3e6ea;--rfp-line-2:#d0d5dd;--rfp-focus:#3b4ea8;
 --rfp-spec:#97a1b0;--rfp-spec-2:#c2c9d4;--rfp-hatch:#dfe3e9;
 --rfp-mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
 --rfp-ui:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
 font-family:var(--rfp-ui);font-size:14px;line-height:1.55;color:var(--rfp-ink);
 background:var(--rfp-paper);-webkit-font-smoothing:antialiased;
 width:100%;min-height:100vh;box-sizing:border-box}
/* Full-bleed geometry. :where() gives these ZERO specificity, so a theme's own globals rules still
   win - the chrome resets the UA gutter without ever outranking the theme it is displaying.
   color-scheme is pinned to light: this sheet does NOT follow the OS (see below). */
:where(html){color-scheme:light}
:where(body){margin:0}
.rfp *{box-sizing:border-box}
.rfp *:focus-visible{outline:2px solid var(--rfp-focus);outline-offset:2px;border-radius:3px}
/* ── Masthead: the theme wearing its own first palette ── */
.rfp-masthead{padding:52px 40px 36px}
.rfp-kicker{font-family:var(--rfp-mono);font-size:11px;letter-spacing:.16em;text-transform:uppercase;opacity:.75;margin:0 0 12px}
.rfp-masthead h1{margin:0;font-size:38px;font-weight:680;letter-spacing:-.028em;text-wrap:balance}
.rfp-lede{margin:12px 0 0;max-width:66ch;opacity:.88;font-size:15px}
.rfp-metrics{margin-top:28px;display:flex;gap:34px;flex-wrap:wrap}
.rfp-metric b{display:block;font-size:26px;font-weight:700;line-height:1.1;font-variant-numeric:tabular-nums}
.rfp-metric span{font-size:12px;opacity:.72;font-family:var(--rfp-mono)}
/* ── Shell ── */
.rfp-shell{display:grid;grid-template-columns:204px minmax(0,1fr);gap:44px;padding:0 40px 96px;align-items:start}
.rfp-rail{position:sticky;top:0;padding:28px 0;max-height:100vh;overflow-y:auto}
.rfp-brand{font-family:var(--rfp-mono);font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;
 color:var(--rfp-ink-3);padding-bottom:12px;margin-bottom:12px;border-bottom:1px solid var(--rfp-line)}
.rfp-nav{display:flex;flex-direction:column;gap:1px}
.rfp-nav a{display:flex;justify-content:space-between;align-items:baseline;gap:10px;padding:5px 8px;
 border-radius:5px;color:var(--rfp-ink-2);text-decoration:none;font-size:13px}
.rfp-nav a:hover{background:var(--rfp-card);color:var(--rfp-ink)}
.rfp-nav a[aria-current="true"]{background:var(--rfp-ink);color:var(--rfp-paper)}
.rfp-nav .rfp-n{font-family:var(--rfp-mono);font-size:11px;font-variant-numeric:tabular-nums;color:var(--rfp-ink-3)}
.rfp-nav a[aria-current="true"] .rfp-n{color:var(--rfp-paper);opacity:.6}
.rfp-main{padding-top:28px;min-width:0}
.rfp-controls{display:flex;flex-wrap:wrap;gap:22px;padding:14px 0 18px;position:sticky;top:0;background:var(--rfp-paper);z-index:5}
.rfp-ctl{display:flex;align-items:center;gap:8px}
.rfp-ctl-label{font-family:var(--rfp-mono);font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--rfp-ink-3)}
.rfp-seg{display:flex;border:1px solid var(--rfp-line-2);border-radius:7px;overflow:hidden;background:var(--rfp-card)}
.rfp-seg button{font:inherit;font-family:var(--rfp-mono);font-size:11.5px;padding:4px 11px;border:0;
 border-left:1px solid var(--rfp-line-2);background:transparent;color:var(--rfp-ink-2);cursor:pointer}
.rfp-seg button:first-child{border-left:0}
.rfp-seg button:hover{background:var(--rfp-sunk);color:var(--rfp-ink)}
.rfp-seg button[aria-pressed="true"]{background:var(--rfp-ink);color:var(--rfp-card)}
/* ── Sections + cards ── */
.rfp-section{padding-top:44px;scroll-margin-top:64px}
.rfp-section-head{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
.rfp-section-head h2{margin:0;font-size:21px;letter-spacing:-.018em;font-weight:640}
.rfp-count{font-family:var(--rfp-mono);font-size:11px;color:var(--rfp-ink-2);background:var(--rfp-card);
 border:1px solid var(--rfp-line);border-radius:999px;padding:2px 10px;white-space:nowrap}
.rfp-note{margin:8px 0 20px;color:var(--rfp-ink-2);font-size:13.5px;max-width:72ch}
.rfp-note-sm{color:var(--rfp-ink-3);font-size:12.5px;margin:10px 0 0;max-width:64ch}
.rfp-card{background:var(--rfp-card);border:1px solid var(--rfp-line);border-radius:14px;padding:18px 20px;margin-top:14px}
.rfp-card-head{display:flex;align-items:baseline;gap:10px;margin-bottom:14px;flex-wrap:wrap}
.rfp-card-name{font-family:var(--rfp-mono);font-size:12.5px;font-weight:600}
.rfp-card-sub{font-family:var(--rfp-mono);font-size:11px;color:var(--rfp-ink-3)}
.rfp-row-label{font-family:var(--rfp-mono);font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;
 color:var(--rfp-ink-3);margin:16px 0 9px;display:flex;align-items:center;gap:8px}
.rfp-divider{display:flex;align-items:center;gap:14px;margin:52px 0 4px}
.rfp-divider span{font-family:var(--rfp-mono);font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;
 color:var(--rfp-ink-3);white-space:nowrap}
.rfp-divider::before,.rfp-divider::after{content:"";height:1px;background:var(--rfp-line);flex:1}
/* ── Index cover ── */
.rfp-index{display:grid;grid-template-columns:repeat(auto-fill,minmax(272px,1fr));gap:14px}
.rfp-idx{position:relative;background:var(--rfp-card);border:1px solid var(--rfp-line);border-radius:14px;
 padding:18px 18px 15px 22px;overflow:hidden}
.rfp-idx .rfp-accent{position:absolute;inset:0 auto 0 0;width:5px}
.rfp-idx .rfp-no{font-family:var(--rfp-mono);font-size:10.5px;font-weight:700;letter-spacing:.12em;color:var(--rfp-ink-3)}
.rfp-idx h3{margin:6px 0 2px;font-size:18px;letter-spacing:-.015em;font-weight:620}
.rfp-idx h3 span{font-family:var(--rfp-mono);font-size:11px;font-weight:500;color:var(--rfp-ink-3)}
.rfp-idx p{margin:7px 0 0;font-size:12.5px;color:var(--rfp-ink-2)}
/* ── Identifiers ── */
.rfp-id{font-family:var(--rfp-mono);font-size:11.5px;color:var(--rfp-ink-2);background:none;border:0;
 padding:1px 4px;margin-left:-4px;border-radius:3px;cursor:copy;text-align:left;display:inline-block;
 max-width:100%;overflow-wrap:anywhere}
.rfp-id:hover{background:var(--rfp-sunk);color:var(--rfp-ink)}
.rfp-id.rfp-copied{background:var(--rfp-ink);color:var(--rfp-card)}
.rfp-var{font-family:var(--rfp-mono);font-size:10.5px;color:var(--rfp-ink-3);display:block;margin-top:1px;overflow-wrap:anywhere}
.rfp-hex{font-family:var(--rfp-mono);font-size:11px;color:var(--rfp-ink-3);font-variant-numeric:tabular-nums;display:block;margin-top:1px}
/* ── Provenance tags ── */
.rfp-tag{font-family:var(--rfp-mono);font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;
 padding:1px 5px;border-radius:4px}
.rfp-src{background:color-mix(in srgb,var(--rfp-focus) 12%,transparent);color:var(--rfp-focus)}
.rfp-gen{background:var(--rfp-sunk);color:var(--rfp-ink-3);border:1px solid var(--rfp-line)}
/* ── Palette ── */
.rfp-pal-top{display:flex;align-items:center;gap:16px}
.rfp-pal-base{width:104px;height:88px;border-radius:12px;flex:none;box-shadow:inset 0 0 0 1px rgba(0,0,0,.1);display:flex;align-items:flex-end;justify-content:center;padding:7px}
.rfp-pal-name{margin:0;font-size:18px;font-weight:680;letter-spacing:-.015em}
.rfp-pal-name small{display:block;font-family:var(--rfp-mono);font-weight:400;color:var(--rfp-ink-3);font-size:11.5px;margin-top:4px}
.rfp-rungs{display:flex;border-radius:9px;overflow:hidden;border:1px solid var(--rfp-line)}
.rfp-rung{flex:1 1 0;min-width:0}
.rfp-rung .rfp-sw{height:54px}
.rfp-rung-foot{padding:6px 2px 7px;text-align:center;background:var(--rfp-sunk);border-top:1px solid var(--rfp-line);
 font-family:var(--rfp-mono);font-size:10px;font-variant-numeric:tabular-nums;color:var(--rfp-ink-2)}
.rfp-rung[data-lands] .rfp-rung-foot{color:var(--rfp-ink);font-weight:700}
.rfp-rung[data-lands] .rfp-rung-foot::before{content:"◆ "}
.rfp-chips{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:10px}
.rfp-chip{border:1px solid var(--rfp-line);border-radius:10px;overflow:hidden;background:var(--rfp-card);min-width:0}
.rfp-chip-sw{height:50px;box-shadow:inset 0 0 0 1px rgba(0,0,0,.05);display:flex;align-items:flex-end;padding:6px}
.rfp-cap{padding:8px 9px 9px;min-width:0}
.rfp-lbl{font-size:12px;font-weight:600;display:flex;align-items:center;gap:6px;justify-content:space-between}
.rfp-val-sm{font-family:var(--rfp-mono);font-size:10.5px;color:var(--rfp-ink-3);margin-top:3px;font-variant-numeric:tabular-nums}
.rfp-ratio{font-family:var(--rfp-mono);font-size:9.5px;padding:1px 6px;border-radius:4px;border:1px solid currentColor;white-space:nowrap}
/* ── Rows ── */
.rfp-rows{display:flex;flex-direction:column}
.rfp-row{display:grid;grid-template-columns:200px minmax(0,1fr) 104px;gap:20px;align-items:baseline;
 padding:11px 0;border-top:1px solid var(--rfp-line)}
.rfp-row:first-child{border-top:0}
.rfp-row.rfp-centred{align-items:center}
.rfp-rowval{font-family:var(--rfp-mono);font-size:11px;color:var(--rfp-ink-3);font-variant-numeric:tabular-nums;text-align:right;overflow-wrap:anywhere}
.rfp-specimen{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:-.015em}
.rfp-leading{font-size:13px;color:var(--rfp-ink-2);max-width:52ch}
.rfp-bar{height:13px;background:var(--rfp-spec);border-radius:3px;max-width:100%}
.rfp-bar.rfp-ghost{background:var(--rfp-spec-2)}
.rfp-gap{display:flex;border:1px dashed var(--rfp-line-2);border-radius:8px;padding:10px;background:var(--rfp-sunk)}
.rfp-gap>i{flex:1 1 0;height:30px;background:var(--rfp-spec-2);border-radius:3px}
.rfp-tracks{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid var(--rfp-line-2);
 border-radius:8px;overflow:hidden;
 background:repeating-linear-gradient(-45deg,var(--rfp-hatch) 0 4px,transparent 4px 8px)}
.rfp-tracks>i{height:38px;background:var(--rfp-spec)}
.rfp-inset{border:1px solid var(--rfp-line-2);border-radius:10px;
 background:repeating-linear-gradient(-45deg,var(--rfp-hatch) 0 4px,transparent 4px 8px)}
.rfp-inset-core{background:var(--rfp-spec);color:var(--rfp-card);border-radius:4px;font-family:var(--rfp-mono);
 font-size:10.5px;font-weight:700;text-align:center;padding:9px 4px}
/* ── Tiles ── */
.rfp-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(146px,1fr));gap:12px}
.rfp-tile{border:1px solid var(--rfp-line);border-radius:12px;padding:14px;background:var(--rfp-card)}
.rfp-stage{height:76px;display:grid;place-items:center;background:var(--rfp-sunk);border-radius:8px;
 margin-bottom:11px;color:var(--rfp-spec)}
.rfp-obj{width:60px;height:60px;background:var(--rfp-spec)}
.rfp-obj.rfp-outlined{background:transparent}
.rfp-obj.rfp-raised{background:var(--rfp-card)}
.rfp-obj.rfp-accent{background:var(--rfp-spec)}
.rfp-numeral{font-family:var(--rfp-mono);font-size:19px;font-variant-numeric:tabular-nums;color:var(--rfp-ink-2)}
.rfp-track{height:34px;border-radius:8px;background:var(--rfp-sunk);border:1px solid var(--rfp-line);position:relative;overflow:hidden}
.rfp-dot{position:absolute;top:6px;left:6px;width:22px;height:22px;border-radius:5px;background:var(--rfp-spec)}
.rfp-play{font:inherit;font-family:var(--rfp-mono);font-size:11.5px;padding:3px 10px;border-radius:5px;
 border:1px solid var(--rfp-line-2);background:var(--rfp-sunk);color:var(--rfp-ink);cursor:pointer;margin-left:auto}
/* ── Tables ── */
.rfp-scroll{overflow-x:auto}
.rfp-diff,.rfp-matrix{border-collapse:collapse;width:100%}
.rfp-diff th,.rfp-matrix th{text-align:left;font-family:var(--rfp-mono);font-size:10.5px;letter-spacing:.1em;
 text-transform:uppercase;color:var(--rfp-ink-3);font-weight:500;padding:0 12px 9px 0;white-space:nowrap}
.rfp-diff td{padding:9px 12px 9px 0;border-top:1px solid var(--rfp-line);vertical-align:middle}
.rfp-matrix{min-width:560px}
.rfp-matrix th{text-align:center;padding:0 8px 10px}
.rfp-matrix th:first-child{text-align:left}
.rfp-matrix td{padding:13px 8px;border-top:1px solid var(--rfp-line);text-align:center}
.rfp-matrix td:first-child{text-align:left;width:208px}
.rfp-none{font-family:var(--rfp-mono);font-size:11px;color:var(--rfp-ink-3);opacity:.55}
.rfp-swatch-cell{display:flex;align-items:center;gap:8px}
.rfp-chip-sm{width:18px;height:18px;border-radius:5px;border:1px solid var(--rfp-line-2);flex:none}
.rfp-arrow{color:var(--rfp-ink-3);font-family:var(--rfp-mono)}
/* ── Recipes + prose ── */
.rfp-recipes{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.rfp-recipe{border:1px solid var(--rfp-line);border-radius:12px;overflow:hidden;background:var(--rfp-card)}
.rfp-recipe-stage{min-height:92px;display:grid;place-items:center;padding:18px;background:var(--rfp-sunk)}
/* A dimensionless recipe (a pure colour rule) has nothing to size it, so it collapses to its text.
   Stretch it edge to edge instead — for a swatch that IS the specimen. Recipes that declare their
   own padding or width keep their natural size, because that size is what is being shown. */
.rfp-recipe-stage.rfp-stage-fill{padding:0}
.rfp-recipe-stage.rfp-stage-fill>.rfp-fill{width:100%;min-height:92px;display:flex;align-items:center;
 justify-content:center;box-sizing:border-box}
.rfp-recipe-foot{padding:9px 12px;border-top:1px solid var(--rfp-line)}
.rfp-addr{font-family:var(--rfp-mono);font-size:11px;color:var(--rfp-ink-3);display:block}
.rfp-empty{font-family:var(--rfp-mono);font-size:10.5px;color:var(--rfp-ink-3);font-style:italic}
.rfp-demo-inset{background:repeating-linear-gradient(-45deg,var(--rfp-hatch) 0 4px,transparent 4px 8px);
 border:1px solid var(--rfp-line-2);border-radius:8px;display:inline-block;box-sizing:border-box}
.rfp-demo-inset>.rfp-inset-core{display:block}
.rfp-demo-gap{display:flex;border:1px dashed var(--rfp-line-2);border-radius:8px;background:var(--rfp-sunk);
 padding:10px;box-sizing:border-box}
.rfp-demo-gap>i{width:26px;height:26px;background:var(--rfp-spec);border-radius:4px;flex:none}
.rfp-aid{display:inline-block;margin-top:5px;font-family:var(--rfp-mono);font-size:9.5px;letter-spacing:.04em;
 padding:1px 6px;border-radius:4px;background:var(--rfp-sunk);color:var(--rfp-ink-3);border:1px dashed var(--rfp-line-2)}
.rfp-matrix td>.rfp-fill{min-width:104px;min-height:44px;display:flex;align-items:center;justify-content:center;
 border-radius:6px;box-sizing:border-box}
.rfp-compose{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.rfp-cls{font-family:var(--rfp-mono);font-size:11.5px;padding:3px 9px;border-radius:6px;
 border:1px solid var(--rfp-line);background:var(--rfp-sunk)}
.rfp-cls b{font-weight:600;color:var(--rfp-ink)}
.rfp-cls span{color:var(--rfp-ink-3)}
.rfp-plus{color:var(--rfp-ink-3);font-family:var(--rfp-mono)}
.rfp-prose{border:1px solid var(--rfp-line);border-radius:14px;padding:26px 28px;background:var(--rfp-card);overflow:hidden}
.rfp-notice{display:grid;grid-template-columns:auto minmax(0,1fr);gap:12px;padding:14px 16px;
 border:1px solid var(--rfp-line-2);border-radius:12px;background:var(--rfp-card);margin-top:16px}
.rfp-notice-mark{font-family:var(--rfp-mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;
 padding:2px 7px;border-radius:5px;background:var(--rfp-ink);color:var(--rfp-card);white-space:nowrap;height:fit-content}
.rfp-notice p{margin:0;color:var(--rfp-ink-2);font-size:13px;max-width:68ch}
.rfp-notice p+p{margin-top:6px}
.rfp-notice strong{color:var(--rfp-ink)}
.rfp-frame{margin:0 auto}
@media (prefers-reduced-motion:reduce){.rfp *{transition:none!important;animation:none!important}}
@media (max-width:900px){
 .rfp-shell{grid-template-columns:minmax(0,1fr);gap:0;padding:0 20px 72px}
 .rfp-masthead{padding:36px 20px 28px}
 .rfp-rail{position:static;max-height:none;padding:20px 0 0}
 .rfp-nav{flex-direction:row;overflow-x:auto;gap:4px;padding-bottom:4px}
 .rfp-nav a{white-space:nowrap}
 .rfp-row{grid-template-columns:130px minmax(0,1fr)}
 .rfp-rowval{grid-column:1/-1;text-align:left}
}
`.trim();

const CHROME_JS = `
(function(){
 var root=document.documentElement;
 function bind(sel,onPick){
  var btns=[].slice.call(document.querySelectorAll(sel));
  btns.forEach(function(b){b.addEventListener("click",function(){
   btns.forEach(function(o){o.setAttribute("aria-pressed",String(o===b));});
   onPick(b.getAttribute("data-value"));});});
 }
 bind("[data-rfp-mode]",function(v){
  var attr=root.getAttribute("data-rfp-mode-attr");if(!attr)return;
  if(v)root.setAttribute(attr,v);else root.removeAttribute(attr);});
 bind("[data-rfp-width]",function(v){
  var frame=document.getElementById("rfp-frame");if(frame)frame.style.maxWidth=v?v+"px":"";});
 var play=document.getElementById("rfp-play"),running=false;
 if(play)play.addEventListener("click",function(){
  running=!running;play.textContent=running?"Reset":"Play";
  document.querySelectorAll(".rfp-dot").forEach(function(d){
   d.style.transform=running?"translateX("+(d.parentElement.clientWidth-34)+"px)":"translateX(0)";});});
 document.addEventListener("click",function(e){
  var btn=e.target.closest?e.target.closest(".rfp-id"):null;if(!btn)return;
  var text=btn.textContent.trim();
  var done=function(){var prev=btn.textContent;btn.classList.add("rfp-copied");btn.textContent="copied";
   setTimeout(function(){btn.classList.remove("rfp-copied");btn.textContent=prev;},900);};
  if(navigator.clipboard){navigator.clipboard.writeText(text).then(done,done);}else{done();}});
 var links=[].slice.call(document.querySelectorAll(".rfp-nav a"));
 if(window.IntersectionObserver){
  var io=new IntersectionObserver(function(es){es.forEach(function(en){if(!en.isIntersecting)return;
   links.forEach(function(a){a.setAttribute("aria-current",String(a.getAttribute("href")==="#"+en.target.id));});});},
   {rootMargin:"-10% 0px -80% 0px"});
  document.querySelectorAll(".rfp-section").forEach(function(s){io.observe(s);});
 }
})();
`.trim();

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
        ? `<link rel="stylesheet" href="./${esc(name)}">`
        : `<style data-rfp-source="${esc(name)}">\n${escapeTextElement(body)}\n</style>`;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function buildPreview(source: PreviewSource, options: PreviewOptions): PreviewOutput {
  const { usage, preview, tokens, model } = source;
  const fileName = options.file ?? DEFAULT_FILE;
  const inline = options.inline ?? true;

  const written = new Set(options.files);
  const stylesheets = (preview?.stylesheets ?? []).filter(name => written.has(name));
  const live = stylesheets.length > 0;
  const tokenName = preview?.tokenName;

  const leaves: TokenLeaf[] = [];
  collectLeaves(tokens, [], undefined, leaves);
  const groups = groupLeaves(leaves);

  // Build each section from the groups that map to it; a section with no content is omitted
  // entirely, so a theme without shadows shows no elevation plate rather than an empty box.
  const bodies = new Map<string, string>();
  const counts = new Map<string, number>();
  let pairings = { total: 0, passing: 0 };

  // Recipes go to their own subsystem's section; whatever has no section lands in Components.
  const recipesBySection = new Map<string, UsageRecipe[]>();
  for (const recipe of usage.recipes) {
    const id = RECIPE_SECTION_OF[recipe.subsystem] ?? "recipes";
    const bucket = recipesBySection.get(id);
    if (bucket) bucket.push(recipe);
    else recipesBySection.set(id, [recipe]);
  }
  const recipeCount = (id: string): number => recipesBySection.get(id)?.length ?? 0;
  for (const [group, items] of groups) {
    const section = SECTION_OF[group] ?? "other";
    counts.set(section, (counts.get(section) ?? 0) + items.length);
  }

  for (const section of SECTIONS) {
    const own = [...groups.entries()].filter(([g]) => (SECTION_OF[g] ?? "other") === section.id);
    const sectionRecipes = recipesBySection.get(section.id) ?? [];
    // A section earns its place on tokens OR recipes — a subsystem can declare rule-sets without
    // contributing a single token of its own.
    if (!own.length && !sectionRecipes.length) continue;
    let body = "";
    if (section.id === "palette") {
      const palette = renderPalette(own.flatMap(([, l]) => l), model, tokenName);
      body = palette.html;
      pairings = palette.pairings;
    }
    else if (section.id === "type") body = renderTypography(own.flatMap(([, l]) => l), tokenName);
    else if (section.id === "space") body = renderSpace(new Map(own), tokenName);
    else if (section.id === "shape") body = renderShape(new Map(own), tokenName);
    else if (section.id === "motion") body = renderMotion(own.flatMap(([, l]) => l), tokenName);
    else body = own.map(([g, l]) => renderGeneric(g, l, tokenName)).join("");

    // …then this subsystem's own recipes, in the same section, under the same card language.
    body += renderRecipes(sectionRecipes, preview, live, model, false);
    if (body) bodies.set(section.id, body);
  }

  const modesHtml = renderModes(model, leaves.length, tokenName);
  const globalsHtml = renderGlobals(model, live);

  const notes: string[] = [];
  if (!live) {
    notes.push(
      preview?.unavailable ??
        `This theme was built with the ${usage.format} adapter, whose output a browser can't load ` +
          `directly — token values below are exact, but recipes are listed by name only.`,
    );
  }
  for (const note of preview?.notes ?? []) notes.push(note);

  // ── Rail ────────────────────────────────────────────────────────────────
  const navItems: string[] = [];
  for (const section of SECTIONS) {
    if (!bodies.has(section.id)) continue;
    navItems.push(
      `<a href="#rfp-${section.id}">${esc(section.eyebrow)}` +
        `<span class="rfp-n">${(counts.get(section.id) ?? 0) + recipeCount(section.id)}</span></a>`,
    );
  }
  if (modesHtml) navItems.push(`<a href="#rfp-modes">Appearance</a>`);
  if (globalsHtml) navItems.push(`<a href="#rfp-globals">Base elements</a>`);
  const componentRecipes = recipesBySection.get("recipes") ?? [];
  navItems.push(`<a href="#rfp-recipes">Components<span class="rfp-n">${componentRecipes.length}</span></a>`);

  // ── Masthead ────────────────────────────────────────────────────────────
  const title = options.title ?? `${usage.format} theme`;
  const totalBytes = options.files.reduce((sum, f) => sum + (options.contents?.[f]?.length ?? 0), 0);
  const subsystems = Object.keys(model.subsystems).length;
  const elements = Object.keys(model.subsystems.globals?.ruleSets?.elements ?? {}).length;
  const metrics = [
    { value: String(leaves.length), label: "tokens" },
    { value: String(subsystems), label: "subsystems" },
    { value: `${usage.recipes.length}${elements ? ` + ${elements}` : ""}`, label: elements ? "recipes + elements" : "recipes" },
    pairings.total ? { value: `${pairings.passing}/${pairings.total}`, label: "WCAG AA+ pairings" } : undefined,
    totalBytes ? { value: bytes(totalBytes), label: options.files[0] ?? "output" } : undefined,
  ].filter((m): m is { value: string; label: string } => m !== undefined);

  const modeAttribute = preview?.modeAttribute;
  const modes = collectModes(model);
  const breakpoints = model.breakpoints ?? {};

  const controls: string[] = [];
  if (modeAttribute && modes.length) {
    const buttons = [`<button type="button" data-rfp-mode data-value="" aria-pressed="true">auto</button>`]
      .concat(modes.map(m => `<button type="button" data-rfp-mode data-value="${esc(m)}" aria-pressed="false">${esc(m)}</button>`))
      .join("");
    controls.push(`<div class="rfp-ctl"><span class="rfp-ctl-label">Appearance</span><div class="rfp-seg" role="group" aria-label="Appearance mode">${buttons}</div></div>`);
  }
  const widths = Object.entries(breakpoints);
  if (widths.length) {
    const buttons = [`<button type="button" data-rfp-width data-value="" aria-pressed="true">full</button>`]
      .concat(widths.map(([n, px]) => `<button type="button" data-rfp-width data-value="${esc(String(px))}" aria-pressed="false">${esc(n)}</button>`))
      .join("");
    controls.push(`<div class="rfp-ctl"><span class="rfp-ctl-label">Width</span><div class="rfp-seg" role="group" aria-label="Viewport width">${buttons}</div></div>`);
  }

  // ── Sections ────────────────────────────────────────────────────────────
  const sectionHtml = SECTIONS.filter(s => bodies.has(s.id))
    .map(
      s =>
        `<section class="rfp-section" id="rfp-${s.id}"><div class="rfp-section-head">` +
        `<h2>${s.title}</h2><span class="rfp-count">${counts.get(s.id) ?? 0} token(s)` +
        `${recipeCount(s.id) ? ` · ${recipeCount(s.id)} recipe(s)` : ""}</span></div>` +
        (s.note ? `<p class="rfp-note">${s.note}</p>` : "") +
        bodies.get(s.id) +
        `</section>`,
    )
    .join("");

  const head = [
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width,initial-scale=1">`,
    `<title>${esc(title)}</title>`,
    // Theme FIRST, chrome last: equal-specificity ties then resolve in the chrome's favour, and a
    // themed element rule (`globals`) can never outrank a class-only chrome selector.
    renderThemeLinks(stylesheets, options.contents, inline),
    preview?.statePinCss && live ? `<style data-rfp-state-pins>\n${escapeTextElement(preview.statePinCss)}\n</style>` : "",
    `<style>\n${CHROME_CSS}\n</style>`,
  ]
    .filter(Boolean)
    .join("\n");

  // The masthead is the ONE place the chrome takes a hue, and it takes the theme's own first
  // palette — the theme colouring itself rather than the tool asserting a brand.
  const brand = mastheadColor(leaves);
  const mastheadStyle = brand
    ? ` style="background:${cssValue(brand.bg)};color:${cssValue(brand.fg)}"`
    : ` style="background:var(--rfp-ink);color:var(--rfp-card)"`;

  const indexHtml = renderIndex(bodies, counts, brand?.bg);

  const body =
    `<div class="rfp">` +
    `<header class="rfp-masthead"${mastheadStyle}>` +
    `<p class="rfp-kicker">Theme specimen · ${esc(usage.format)} · ${esc(options.plan.type)}${live ? "" : " · tokens only"}</p>` +
    `<h1>${esc(title)}</h1>` +
    `<div class="rfp-metrics">` +
    metrics.map(m => `<div class="rfp-metric"><b>${esc(m.value)}</b><span>${esc(m.label)}</span></div>`).join("") +
    `</div></header>` +
    `<div class="rfp-shell">` +
    `<aside class="rfp-rail"><div class="rfp-brand">refract preview</div>` +
    `<nav class="rfp-nav">${navItems.join("")}</nav></aside>` +
    `<main class="rfp-main">` +
    (controls.length ? `<div class="rfp-controls">${controls.join("")}</div>` : "") +
    notes.map(n => `<p class="rfp-note">${esc(n)}</p>`).join("") +
    `<div class="rfp-frame" id="rfp-frame">` +
    indexHtml +
    sectionHtml +
    modesHtml +
    globalsHtml +
    `<section class="rfp-section" id="rfp-recipes"><div class="rfp-section-head">` +
    `<h2>Recipes${live ? " and their states" : ""}</h2>` +
    `<span class="rfp-count">${componentRecipes.length} · ${live ? "rendered live" : "names only"}</span></div>` +
    `<p class="rfp-note">Composed rule-sets — the ones built out of the other subsystems. Each ` +
    `subsystem's own recipes render in its own section, beside the tokens they are made of.</p>` +
    // The empty notice stays HERE and only here: a theme with no recipes at all should be told so
    // once, not once per section.
    renderRecipes(componentRecipes, preview, live, model, usage.recipes.length === 0) +
    `</section>` +
    `</div></main></div></div>` +
    `<script>\n${CHROME_JS}\n</script>`;

  const html =
    `<!doctype html>\n<html lang="en"${modeAttribute ? ` data-rfp-mode-attr="${esc(modeAttribute)}"` : ""}>\n` +
    `<head>\n${head}\n</head>\n<body>\n${body}\n</body>\n</html>\n`;

  return { files: { [fileName]: html } };
}
