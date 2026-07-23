import { RefractError } from "../errors";

export type MediaUnit = "px" | "em" | "rem";

export type MediaConfig = {
  unit?: MediaUnit;
  baseFontSize?: number;
};

export type MediaQueryOptions = {
  min?: number;
  max?: number;
  orientation?: "landscape" | "portrait";
};

const DEFAULT_MEDIA_CONFIG: Required<MediaConfig> = {
  unit: "px",
  baseFontSize: 16,
};

export const resolveMediaConfig = (
  config?: MediaConfig,
): Required<MediaConfig> => ({
  unit: config?.unit ?? DEFAULT_MEDIA_CONFIG.unit,
  baseFontSize:
    config?.baseFontSize && config.baseFontSize > 0
      ? config.baseFontSize
      : DEFAULT_MEDIA_CONFIG.baseFontSize,
});

export const formatWidth = (value: number, config: Required<MediaConfig>): string => {
  if (config.unit === "px") {
    return `${value}px`;
  }

  const converted = value / config.baseFontSize;
  const trimmed = Number(converted.toFixed(4));
  return `${trimmed}${config.unit}`;
};

export const mediaQueryString = (
  { min, max, orientation }: MediaQueryOptions,
  config: Required<MediaConfig>,
): string => {
  const clauses: string[] = [];

  if (min !== undefined && max !== undefined && min > max) {
    throw new RefractError("REFRACT_E_MEDIA", "Invalid media query: `min` cannot be greater than `max`.");
  }

  if (min !== undefined) {
    clauses.push(`(min-width: ${formatWidth(min, config)})`);
  }

  if (max !== undefined) {
    clauses.push(`(max-width: ${formatWidth(max, config)})`);
  }

  if (orientation) {
    clauses.push(`(orientation: ${orientation})`);
  }

  if (!clauses.length) {
    return "";
  }

  return `@media ${clauses.join(" and ")}`;
};

export const mediaQuery = (
  options: MediaQueryOptions,
  config?: MediaConfig,
): string => mediaQueryString(options, resolveMediaConfig(config));

/**
 * Container-query prelude (§10.5) — the `@container <name> (…)` twin of {@link mediaQueryString}.
 * Shares the width formatting (so container thresholds honor the same px/em/rem unit config), but
 * has no `orientation` clause (invalid under `container-type: inline-size`; rejected in normalize).
 */
export const containerQueryString = (
  name: string,
  { min, max }: Pick<MediaQueryOptions, "min" | "max">,
  config: Required<MediaConfig>,
): string => {
  const clauses: string[] = [];
  if (min !== undefined && max !== undefined && min > max) {
    throw new RefractError("REFRACT_E_MEDIA", "Invalid container query: `min` cannot be greater than `max`.");
  }
  if (min !== undefined) clauses.push(`(min-width: ${formatWidth(min, config)})`);
  if (max !== undefined) clauses.push(`(max-width: ${formatWidth(max, config)})`);
  if (!clauses.length) return "";
  return `@container ${name} ${clauses.join(" and ")}`;
};
