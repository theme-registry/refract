/**
 * SC-decorated media — the `wrapMedia` half of the adapter contract's media pattern.
 *
 * Core builds the plain {@link MediaDescriptor} (breakpoints → `@media (min-width:…)` strings);
 * this decorates it into styled-components **tagged-template** helpers so a consumer writes
 * `theme.media.md.min\`color: red;\`` (or `theme.media.min("md")\`…\``) and gets an SC `css` block
 * scoped to that query. Re-ported from the dormant legacy SC adapter onto the clean-room
 * `core/media` (imports only core — self-contained for the Step 9 package extraction).
 */
import { css } from "styled-components";
import type { Interpolation, RuleSet } from "styled-components";
import type {
  MediaDescriptor,
  MediaGroupDescriptor,
  MediaQueryOptions,
  MediaVariant,
} from "@theme-registry/refract";

type MediaTemplate = (
  styles: TemplateStringsArray,
  ...interpolations: Interpolation<object>[]
) => RuleSet<object>;

/** A media tagged-template that also carries the raw `@media` query string it wraps. */
export type MediaTemplateWithQuery = MediaTemplate & { readonly query: string };

export type WrappedMediaGroup = Record<MediaVariant, MediaTemplateWithQuery>;

/** The SC-decorated media descriptor put on `theme.media` — tagged templates instead of strings. */
export type WrappedMediaDescriptor<TBreakpoint extends string> = {
  min: (key: TBreakpoint, options?: MediaOrientationOptions) => MediaTemplateWithQuery;
  max: (key: TBreakpoint, options?: MediaOrientationOptions) => MediaTemplateWithQuery;
  between: (
    from: TBreakpoint,
    to: TBreakpoint,
    options?: MediaOrientationOptions,
  ) => MediaTemplateWithQuery;
} & Record<TBreakpoint, WrappedMediaGroup>;

type MediaOrientationOptions = Pick<MediaQueryOptions, "orientation">;

const RESERVED_DESCRIPTOR_KEYS = new Set(["min", "max", "between", "exact"]);

/** Decorate a core {@link MediaDescriptor} into SC tagged-template helpers. */
export const wrapMediaDescriptor = <TBreakpoint extends string>(
  descriptor: MediaDescriptor<TBreakpoint>,
): WrappedMediaDescriptor<TBreakpoint> => {
  const wrapped = {
    min: (key: TBreakpoint, options?: MediaOrientationOptions) =>
      wrapQuery(descriptor.min(key, options)),
    max: (key: TBreakpoint, options?: MediaOrientationOptions) =>
      wrapQuery(descriptor.max(key, options)),
    between: (from: TBreakpoint, to: TBreakpoint, options?: MediaOrientationOptions) =>
      wrapQuery(descriptor.between(from, to, options)),
  } as WrappedMediaDescriptor<TBreakpoint>;

  for (const key of Object.keys(descriptor) as TBreakpoint[]) {
    if (RESERVED_DESCRIPTOR_KEYS.has(key)) continue;
    (wrapped as Record<string, unknown>)[key] = wrapMediaGroup(
      descriptor[key] as MediaGroupDescriptor,
    );
  }

  return wrapped;
};

export const wrapMediaGroup = (group: MediaGroupDescriptor): WrappedMediaGroup => {
  const wrapped = {} as WrappedMediaGroup;
  (Object.keys(group) as MediaVariant[]).forEach(variant => {
    wrapped[variant] = wrapQuery(group[variant]);
  });
  return wrapped;
};

const wrapQuery = (query: string): MediaTemplateWithQuery =>
  Object.assign(buildTemplate(query), { query }) as MediaTemplateWithQuery;

const buildTemplate = (query: string): MediaTemplate => {
  if (!query) {
    return (styles, ...interpolations) => css`
      ${css(styles, ...interpolations)}
    `;
  }
  return (styles, ...interpolations) => css`
    ${query} {
      ${css(styles, ...interpolations)}
    }
  `;
};
