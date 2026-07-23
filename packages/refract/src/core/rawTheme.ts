/**
 * The `RawTheme` authoring type (§8a) — the top-level shape a user's raw theme is authored in.
 *
 * The raw theme is the file users *live in* (edited/extended constantly), so it's richly typed for
 * autocomplete + typo detection. It composes the per-subsystem authoring-input types (each defined
 * beside its subsystem and built from the `core/normalize` vocabulary) under their nested keys.
 *
 * **Strict-closed** (no top-level index signature): an unknown/misspelled top-level key is a type
 * error on a literal — that's the whole point. The `createTheme` spine still ignores unknown
 * top-level keys at runtime, and a power user who genuinely needs to bypass can cast. Breakpoint
 * names stay loose `string` in v1 (TS can't infer them from the sibling `breakpoints` key within one
 * literal anyway) — the normalize vocabulary underneath is generic, so generic threading is a
 * documented future enhancement.
 *
 * Authoring type ONLY — no runtime/output change. `createTheme` bridges to its loose spine with a
 * single boundary cast; the subsystem hooks still consume each `rawTheme[key]` slice as
 * `Record<string, unknown>`.
 */
import type { Breakpoints, Containers } from "./normalize";
import type {
  ColorsRaw,
  TypographyRaw,
  EffectsRaw,
  BordersRaw,
  AnimationRaw,
  LayoutRaw,
  ComponentsRaw,
  GlobalsRaw,
} from "../subsystems";

export interface RawTheme {
  /**
   * §W6b — borrow tokens from a *parent* theme you don't own. `prefix` is that theme's CSS-variable
   * prefix, so a path-form external (`{ external: "colors.brand" }`) lowers to `var(--<prefix>-colors-brand)`.
   * A literal-form external (`{ external: "--mat-sys-bg" }`) needs no prefix. Defaults to `"dt"`.
   */
  extends?: { prefix?: string };
  /** Breakpoint name → min-width (px). Omit for the default breakpoints. */
  breakpoints?: Breakpoints;
  /** Named query containers (§10.5) — `name → { type?, sizes }`; referenced by recipe container overrides. */
  containers?: Containers;
  /**
   * Appearance-mode registry — the declared set of mode names. Every property-level `modes` key is
   * validated against this (typo-detection, like breakpoints/containers). Omit for the default
   * `["dark", "light"]`. `dark`/`light` auto-bind to `@media (prefers-color-scheme)`; any other name
   * is a `[data-theme="…"]` manual toggle only.
   */
  modes?: string[];
  colors?: ColorsRaw;
  typography?: TypographyRaw;
  effects?: EffectsRaw;
  /** Stroke geometry (width/style/offset/radius) + border/outline recipes (§14). Color = value-level `colors.*` ref. */
  borders?: BordersRaw;
  /** Motion tokens (duration/easing/delay) + keyframes + animation-shorthand recipes (§10.2). */
  animation?: AnimationRaw;
  layout?: LayoutRaw;
  components?: ComponentsRaw;
  /** Bare-element base layer (§9) — a normalization `preset` + themed `elements` (declarations +
   *  states / responsive / variants) bound to raw selectors. */
  globals?: GlobalsRaw;
}
