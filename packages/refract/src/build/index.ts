/**
 * Build-time layer barrel (Node-only) — `emitTheme` + config plumbing + the vendor registry.
 *
 * Deliberately NOT re-exported from the runtime `.` barrel (`src/index.ts`): it imports `node:fs`
 * + `typescript` and belongs to the build/CLI surface (surfaced via a `./build` subpath + `bin` in
 * Step 10e). Nothing here is on the runtime graph.
 */
export * from "./vendor";
export * from "./paths";
export * from "./guide";
export * from "./preview";
export * from "./emitTheme";
export * from "./emit";
export * from "./config";
export * from "./init";
export * from "./scaffold";
export * from "./createCommand";
export * from "./createInterview";
export * from "./prompt";
export * from "./importCommand";
export * from "./buildCommand";
export * from "./tokensCommand";
export * from "./auditCommand";
export * from "./diff";
export * from "./diffCommand";
export * from "./skillsCommand";
/** The `refract` bin's `main(argv)` dispatch — exposed so the CLI is testable without spawning a process
 *  (the module's entry-guard means importing it here never triggers a run). */
export { main } from "./cli";

/**
 * Re-export the authoring types (§8c) so a config author gets `defineConfig` + `RawTheme` from ONE
 * `/build` import — `import { defineConfig, type RawTheme } from "…/build"` — to type a separate
 * `theme.raw.ts` the graph loader now compiles (§8b). Type-only: no runtime edge, boundary-safe.
 */
export type { RawTheme } from "../core";
/** The output-shape vocabulary (§9) — config authors use it in `defineConfig` target `emit` fields. */
export type { Emit } from "../core";
export type {
  ColorsRaw,
  TypographyRaw,
  EffectsRaw,
  LayoutRaw,
  ComponentsRaw,
} from "../subsystems";
