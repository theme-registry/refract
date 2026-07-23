/**
 * `@theme-registry/refract` — the core package barrel (Model-first, adapter-required surface).
 *
 * Post monorepo split (context.md §3) core ships ZERO adapter *implementations* — every adapter
 * (CSS/SC/SCSS/JSON) is now its own sibling package (`@theme-registry/refract-css`, …). Core keeps
 * everything adapter-*enabling*: the `ThemeModel`/`RawTheme`/`Ref` types, `createTheme`, the
 * `defineAdapter`/`ThemeAdapter` contract, and the trivial built-in `createNoopAdapter` (a null
 * adapter for callers — like the DTCG export — that only read `theme.tokens`/`resolveToken`/`model`).
 *
 * Headline entry points:
 *  - `createTheme(raw, { adapter })` — the entry point. `adapter` is **required** (core ships no
 *    real output adapter); it builds the format-neutral {@link ThemeModel} first, then lowers via the
 *    adapter. Install the adapter package for the format you want.
 *  - `defineAdapter(spec)` — author a custom adapter (fills the defaulted render methods).
 *  - `createNoopAdapter()` — the built-in null adapter (renders nothing; for token-only consumers).
 *  - Model / adapter / theme types — `ThemeModel`, `SubsystemModel`, `RuleSet`, `RuleSetGroup`,
 *    `PropertyModel`, `Ref`, `ThemeAdapter`, `AdapterSpec`, `RenderContext`, `Theme`, `CreateThemeOptions`.
 *  - The subsystem descriptors (`colorsSubsystem` … `componentsSubsystem`) for extension.
 *
 * The shared adapter-authoring helpers (naming overrides, `createNamer`, `sanitizeSegment`) live at
 * the dedicated `./adapter-kit` subpath; the OKLCH colour-math helpers at `./color-math`; the DTCG
 * interop (`fromDTCG` / `toDTCG` / `parseDTCGDocument`) at `./dtcg`; the Node-only build API +
 * `defineConfig` at `./build`. None of those ride this `.` barrel (they'd drag Node/typescript or
 * adapter-only concerns onto the runtime surface).
 */
export * from "./core";
export * from "./subsystems";
