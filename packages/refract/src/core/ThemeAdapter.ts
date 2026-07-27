/**
 * The adapter contract — the ONE interface `src/next/` core commits to.
 *
 * An adapter turns the format-neutral `ThemeModel` into some output format (CSS,
 * SCSS, styled-components, JSON, React-Native). Core builds and enumerates the
 * Model; it knows no output format — the adapter does. Core imports only this
 * interface, never a concrete adapter.
 *
 * Two-level shape:
 *   ThemeAdapter   identity (`name`/`version`) + `bind(model, ctx)`
 *   BoundAdapter   the render surface, with `model`/`ctx` already bound so the
 *                  methods read cleanly: `renderRecipe(subsystem, group, variant)`.
 *
 * `createTheme` builds the Model, calls `bind(model, ctx)` ONCE, and curries the
 * bound surface onto the public theme (`theme.renderRecipe(group, variant)`, …).
 *
 * @typeParam TUnit the output unit. CSS/SCSS → `string`; JSON → a doc fragment;
 *   React-Native → a style object. Only `join` + the render methods vary by it;
 *   `recipeName` is always `string` (identity is format-independent).
 */

import type { ThemeModel, Literal } from "./model";
import type { MediaDescriptor, ContainerDescriptors } from "./media";

/**
 * Build-time emit output — self-contained files an adapter writes to disk.
 *
 * `files` are the static artifacts a downstream project consumes directly (a CSS stylesheet, a
 * theme module, …). `vendorHelpers` are **live** helper modules the adapter vendors for the app's
 * runtime needs (color-math for adjusting a colour live, an SC media module, …); each MUST be
 * self-contained ES-module source — zero refract import — so the app keeps working after it drops
 * refract at runtime. The build layer (`emitTheme`) writes both to disk.
 */
export interface EmitOutput {
  /** Static consume-as-is artifacts, keyed by filename (`"theme.css"`). */
  files: Record<string, string>;
  /** Self-contained live helper modules, keyed by filename (`"color-math.js"`, `"media.ts"`). */
  vendorHelpers?: Record<string, string>;
}

/**
 * `emit` — the per-target directive for HOW a theme is written to disk (§9). Core owns only this
 * **vocabulary** (so config authors get autocomplete) + light normalization (see `resolveEmitPlan`
 * in `src/build/emit.ts`); each ADAPTER decides which modes it honors and how it realizes them.
 * An adapter that doesn't recognize a mode throws a clear error rather than mis-emitting.
 *
 * The four intents:
 *  - `single`     — one file (default `theme.css`); `file` renames it.
 *  - `split`      — two files: rules (`file`, default `styles.css`) + variables (`variables`,
 *                   default `variables.css`). Load-order contract, no `@import`.
 *  - `subsystem`  — a styles+variables pair per subsystem (`filename(subsystem, kind)` names both).
 *  - `components` — the merged/flattened per-component export (`inline` defaults true).
 *
 * Discriminator inference (only `single`/`split` may omit `type`): `undefined`/`{}`/`{ file }` →
 * single; presence of the `variables` key → split. `subsystem`/`components` always need `type` (or
 * the string form).
 *
 * ---
 * **CSS adapter semantics** (the reference realization — the only adapter shipping `emit` today; SC
 * and future adapters may honor a subset or map the intent onto their own shape):
 *
 * - **single** — one stylesheet: all subsystems' `:root` variables + every rule, in one file.
 *   The global adapter `inline` option bakes resolved values instead of `var(--…)` whole-file.
 *
 * - **split / subsystem** — every multi-file mode obeys a **load-order contract, NO `@import`**: the
 *   styles file(s) reference vars by name and assume the variables file loads first. Responsive
 *   `:root` var overrides route to the variables side, responsive rule overrides to the styles side.
 *   The global `inline` option is **rejected** here (baking values leaves no variables to split out —
 *   the adapter throws). In `subsystem` mode the `components` subsystem owns no properties, so it
 *   emits **styles only** (no `components.variables.css`), and that file is the normal option-C
 *   composition (delta classes referencing sibling-subsystem classes) — NOT flattened.
 *
 * - **components** — the ONLY mode that flattens each component variant into one self-contained
 *   rule-set (its referenced recipes' declarations + own `css` delta, delta winning on conflict).
 *   `inline` **defaults true** → baked literal values, zero `var(`, fully portable/dependency-free.
 *   `inline: false` → the same rules with `var(--…)` refs PLUS a **tree-shaken** variables file
 *   containing ONLY the tokens the exported components reference. `variables` names that file
 *   (default `variables.css`); `variables: false` **suppresses** it (the consumer supplies the vars).
 *   **File assignment = the `filename` return value** — variants returning the same name are
 *   concatenated into that file (default `` `${group}-${variant}.css` `` = one file per variant;
 *   `() => "components.css"` collapses all; a per-group fn bundles a group while others stay split).
 *
 * NOTE (docs location): post-cutover author docs (AGENT / examples) were removed in the clean-room
 * rebuild and not yet re-authored, so this TSDoc + the `tmp-build-example/theme.config.ts` comments
 * are the current author-facing reference for `emit`.
 */
export type Emit =
  | undefined
  | "single"
  | "split"
  | "subsystem"
  | "components"
  | { type?: "single"; file?: string }
  | { type?: "split"; file?: string; variables?: string }
  | { type: "subsystem"; filename?: (subsystem: string, kind: "styles" | "variables") => string }
  | {
      type: "components";
      inline?: boolean;
      filename?: (c: { group: string; variant: string }) => string;
      variables?: string | false;
    };

/**
 * The normalized, discriminated form of {@link Emit} — every default filled, `type` always present.
 * `resolveEmitPlan` (build layer) produces it; an adapter's `emit(plan)` switches on `plan.type`.
 */
export type NormalizedEmit =
  | { type: "single"; file: string }
  | { type: "split"; file: string; variables: string }
  | { type: "subsystem"; filename: (subsystem: string, kind: "styles" | "variables") => string }
  | {
      type: "components";
      inline: boolean;
      filename: (c: { group: string; variant: string }) => string;
      variables: string | false;
    };

/** One recipe's real identity in a format — a CSS class, an SC export, a JSON key. */
export interface UsageRecipe {
  readonly subsystem: string;
  readonly group: string;
  readonly variant: string;
  /** The name a downstream consumer actually uses (`recipeName` for this rule-set). */
  readonly name: string;
}

/**
 * How to consume an adapter's built output — the source the build-time self-documenting guide
 * (`llms.txt` + `manifest.json`) is rendered from. The adapter that produced the format is the
 * thing that knows its consumption shape, so it describes it here from its REAL naming surface;
 * `defineAdapter` supplies a generic default (recipe identities via `recipeName`) for adapters that
 * don't override it.
 */
export interface UsageDescriptor {
  /** The output format id (the adapter's `name`). */
  readonly format: string;
  /** Prose lines describing how to consume the output — the `llms.txt` narrative. Relative-path first. */
  readonly summary: readonly string[];
  /** The real recipe identities in this format, so a downstream agent never guesses a name. */
  readonly recipes: readonly UsageRecipe[];
}

/** How one recipe is marked up in a preview document. `tag` omitted ⇒ the preview picks a sensible element. */
export interface PreviewMarkup {
  /** The element to render (`"button"`, `"div"`, …). Omit to let the preview choose by group name. */
  readonly tag?: string;
  /** Attributes to set on it — for CSS, `{ class: "<the real class list>" }`. */
  readonly attrs: Readonly<Record<string, string>>;
}

/**
 * How to render a **human-facing** preview of an adapter's built output — the audience-flipped sibling
 * of {@link UsageDescriptor} (which serves the machine-facing `llms.txt` guide). Feeds `preview.html`.
 *
 * The build layer can always render *token* plates on its own (they come from the format-neutral DTCG
 * export), so this describes only the half it cannot know: whether the emitted artifacts are **loadable
 * by a browser as-is**, and if so, in what order and with what markup. That is true for CSS and, today,
 * nothing else — SCSS needs compiling, styled-components emits JS modules, JSON has no rendered form.
 * Those adapters return an empty `stylesheets` with an honest {@link PreviewDescriptor.unavailable}
 * message, and the page degrades to tokens-only instead of rendering unstyled boxes.
 *
 * It is passed the **normalized emit plan and the real emitted file names**, because both answers
 * depend on them: `split` has a load-order contract, `subsystem`/`components` name files through a
 * user-supplied function (so names can never be re-derived from the plan alone), and `components`
 * emits self-contained merged rules keyed by a different class than the composition list every other
 * mode uses.
 */
export interface PreviewDescriptor {
  /**
   * Emitted file names that a browser can load as-is, **in load order** (e.g. `split` puts its
   * variables file first). Empty ⇒ no live rendering is possible for this format; say why in
   * {@link unavailable}. The build layer intersects this with the files actually written, so a
   * stale name can never produce a page pointing at a missing artifact.
   */
  readonly stylesheets: readonly string[];
  /** Mark up one recipe. Omit ⇒ recipes are listed by name only, never rendered. */
  readonly markup?: (recipe: UsageRecipe) => PreviewMarkup | undefined;
  /**
   * Optional grouping key per recipe, used for page layout only — `subsystem` mode groups by
   * subsystem, `components` mode by the file each component was written to. Omit ⇒ one flat section.
   */
  readonly groupBy?: (recipe: UsageRecipe) => string | undefined;
  /**
   * The attribute to set on `<html>` to force an appearance mode (CSS emits `:root[data-theme="…"]`,
   * so the CSS adapter answers `"data-theme"`). Absent ⇒ the preview renders no mode toggle, because
   * it would have no way to switch. The theme's own `prefers-color-scheme` blocks still apply.
   */
  readonly modeAttribute?: string;
  /** Why a live render isn't possible, in the author's own words. Shown when `stylesheets` is empty. */
  readonly unavailable?: string;
  /** Caveats worth surfacing on the page even when rendering does work (e.g. "`variables: false` — …"). */
  readonly notes?: readonly string[];
}

/** The Model-derived context bound alongside the Model. */
export interface RenderContext<TBreakpoint extends string = string> {
  /** Core-built media descriptor (breakpoints → `@media` builder) for responsive rules. */
  readonly media: MediaDescriptor<TBreakpoint>;
  /** Per-named-container descriptors (§10.5) — `name → @container builder`. Empty when no `containers`. */
  readonly containers: ContainerDescriptors;
  /** Resolve a token path to its concrete literal — for inline / value-mode output. */
  readonly resolve: (path: string) => Literal;
}

/**
 * The render surface an author's `bind` returns: the required primitives, plus
 * optional overrides / lifecycle. All methods are already bound to `model`/`ctx`,
 * so none of them take those. `defineAdapter` fills in the defaulted aggregators.
 */
export interface BoundSpec<TUnit = string> {
  // ── REQUIRED — the only genuinely format-specific work ──

  /** A recipe's identity in this format (CSS class, SCSS mixin, RN key, …). Always a string. */
  recipeName(subsystem: string, group: string, variant: string): string;

  /** Render ONE rule-set: base declarations + all its state/responsive rules. */
  renderRecipe(subsystem: string, group: string, variant: string): TUnit;

  /** Render ONE subsystem's tokens (its `:root` variables in CSS). */
  renderVariables(subsystem: string): TUnit;

  /** Combine units — the one primitive the defaulted aggregators need.
   *  CSS/SCSS: `parts.join("\n\n")`; JSON: merge fragments; RN: merge objects. */
  join(parts: TUnit[]): TUnit;

  // ── DEFERRED — lazy per-recipe delivery (not wired yet) ──

  /** Render ONE variable by token path, e.g. `"colors.primary"` → `"--dt-color--primary: #4dabf7;"`.
   *  The finer-grained sibling of `renderVariables`; feeds the core `renderRecipeStandalone`
   *  helper. Optional until lazy delivery lands. (*Which* paths a recipe needs is core
   *  knowledge — a Model walk — not an adapter concern.) */
  renderToken?(path: string): TUnit;

  // ── OPTIONAL aggregator overrides (defaults cover the common case) ──

  renderAllRecipes?(): TUnit;
  renderAllVariables?(): TUnit;
  renderAll?(): TUnit;

  // ── OPTIONAL lifecycle ──

  /** Attach runtime-only helpers to the theme root (the `theme.media` pattern). */
  extend?(theme: Record<string, unknown>): Record<string, unknown>;

  /**
   * Describe how to consume this output — feeds the build-time self-documenting guide (`llms.txt` +
   * `manifest.json`) so a published/zipped theme travels with instructions for a downstream agent
   * that has neither refract nor its skills. Optional: `defineAdapter` supplies a generic default
   * (recipe identities via `recipeName`); an adapter overrides it to add format-specific import prose. */
  describeUsage?(): UsageDescriptor;

  /**
   * Describe how to render a human-facing `preview.html` of this emit — see {@link PreviewDescriptor}.
   * Receives the normalized plan and the file names `emit(plan)` actually produced.
   *
   * **Unlike `describeUsage`, this has NO default**: an absent implementation means "I don't know how
   * to show this in a browser", and the preview falls back to token plates only. That's the correct
   * behavior for a third-party adapter that has never heard of previews, so the contract stays additive. */
  describePreview?(plan: NormalizedEmit, files: readonly string[]): PreviewDescriptor;

  /**
   * Build-time emit: self-contained files (adapter vendors its own runtime helpers). `plan` is the
   * normalized output-shape directive (§9); omitted ⇒ `single`/`theme.css` (back-compat). The
   * adapter switches on `plan.type` and throws a clear error for modes it doesn't support. */
  emit?(plan?: NormalizedEmit): EmitOutput;
}

/**
 * The full bound render surface — a `BoundSpec` with the DEFAULTED aggregators
 * guaranteed present (supplied by `defineAdapter`). This is what `createTheme`
 * curries onto the public theme.
 */
export interface BoundAdapter<TUnit = string> extends BoundSpec<TUnit> {
  /** All rule-sets combined (default: `join` over every `renderRecipe`). */
  renderAllRecipes(): TUnit;
  /** All subsystems' variables combined (default: `join` over every `renderVariables`). */
  renderAllVariables(): TUnit;
  /** The full output (default: `join([renderAllVariables, renderAllRecipes])`). */
  renderAll(): TUnit;
  /** How to consume the output (default: format + recipe identities from `recipeName`). */
  describeUsage(): UsageDescriptor;
}

/** What an adapter AUTHOR writes: identity + a `bind` that returns the render surface. */
export interface AdapterSpec<TUnit = string> {
  /** Stable adapter id, e.g. `"css"`, `"scss"`, `"styled-components"`, `"json"`. */
  readonly name: string;
  /** Contract version external packages pin to. */
  readonly version: number;
  /**
   * The states this adapter can render (`["hover", "disabled", …]`) — the validation set for recipe
   * `state:` refs. **The adapter owns state knowledge** (CSS knows `:hover`/`[disabled]`; an inline
   * or JSON adapter may know none). Surfaced at the adapter level (not `bind`) because recipe
   * normalization runs *before* `bind`; core threads it into `normalizeRecipeGroup` generically,
   * with no CSS import. Absent ⇒ no state validation (any state name accepted).
   */
  readonly allowedStates?: ReadonlyArray<string>;
  /** Bind the Model + context once; return the render primitives. */
  bind(model: ThemeModel, ctx: RenderContext): BoundSpec<TUnit>;
}

/** The full adapter core/`createTheme` consumes: `bind` returns a complete `BoundAdapter`. */
export interface ThemeAdapter<TUnit = string> {
  readonly name: string;
  readonly version: number;
  /** The adapter's known-state set (see {@link AdapterSpec.allowedStates}); core validates against it. */
  readonly allowedStates?: ReadonlyArray<string>;
  bind(model: ThemeModel, ctx: RenderContext): BoundAdapter<TUnit>;
}
