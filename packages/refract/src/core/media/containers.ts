/**
 * Container-query descriptors (§10.5).
 *
 * A named query container has a *size* scale (`sizeName → px`), exactly the shape a breakpoint scale
 * has — so each container reuses {@link buildMediaDescriptor} with an `@container`-prefixing resolver.
 * The result is a per-container descriptor whose `.min/.max/.exact(sizeName)` (and `[sizeName][kind]`)
 * yield `@container <name> (…)` preludes with the same min/max/exact + band-to-next semantics the
 * viewport axis uses. Threshold widths honor the shared media unit config (px default, em/rem).
 */
import { buildMediaDescriptor, type MediaDescriptor } from "./descriptors";
import { containerQueryString, resolveMediaConfig, type MediaConfig } from "./queries";
import type { ContainerModel } from "../model/model";

/** One descriptor per named container: `containerName → MediaDescriptor` over that container's size scale. */
export type ContainerDescriptors = Record<string, MediaDescriptor<string>>;

/**
 * Build a {@link ContainerDescriptors} map from the theme's `containers` config. Each container's
 * `sizes` become the descriptor's "breakpoints"; the resolver emits `@container <name> (…)`. The
 * width unit follows `config` (shared with the viewport media descriptor).
 */
export const buildContainerDescriptors = (
  containers: Record<string, ContainerModel> | undefined,
  config?: MediaConfig,
): ContainerDescriptors => {
  const resolved = resolveMediaConfig(config);
  const out: ContainerDescriptors = {};
  for (const [name, container] of Object.entries(containers ?? {})) {
    out[name] = buildMediaDescriptor(container.sizes, opts =>
      containerQueryString(name, { min: opts.min, max: opts.max }, resolved),
    );
  }
  return out;
};
