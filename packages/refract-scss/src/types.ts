/**
 * The SCSS adapter's option + output types.
 *
 * `TUnit = string` (like CSS) — SCSS is a text format. What differs from the CSS adapter:
 * tokens lower to compile-time Sass **`$variables`** (not `:root` custom properties), refs render
 * as `$dt-…` (not `var(--…)`), and rule-sets nest their state/breakpoint overrides with `&` /
 * `@media` in idiomatic Sass. Recipes are emitted as **classes** (composition = class list, the CSS
 * option-C model), so the output compiles to the same class surface as CSS from a Sass source.
 */

/** SCSS output unit — a string of Sass source. */
export type ScssUnit = string;

/** The resolved composition class for one component variant (referenced classes + own delta). */
export type ResolvedComponentClass = { className: string; classList: string[] };

export type ScssAdapterOptions = {
  /** Identifier prefix for `$variables` and class names (`$dt-colors-primary`, `.dt-colors-solid-primary`). Default `dt`. */
  prefix?: string;
  /** Bake resolved literal values into declarations instead of `$var` references (drops the `$variables`). */
  inline?: boolean;
  /** Indent width (spaces) for nested Sass blocks. Default `2`. */
  indent?: number;
  /**
   * §W9 — wrap all emitted SCSS in a named cascade `@layer` (compiles to a CSS `@layer`). `true` uses
   * `"refract"`; a string sets a custom name. Off by default (byte-identical). Single-file emit only.
   */
  layer?: string | boolean;
};
