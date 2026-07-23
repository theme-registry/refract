/**
 * Media types + helpers for the clean-room tree — breakpoints → `@media` builder.
 *
 * Self-contained (no intra-core deps): the numeric-breakpoint machinery core hands
 * to adapters, which decorate it (`wrapMedia`) for their target. Ported from the
 * original `core/media` during the barrel flip (Step 6).
 */
export * from "./descriptors";
export * from "./queries";
export * from "./defaults";
export * from "./containers";
