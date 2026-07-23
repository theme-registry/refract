/** Subsystems: colors · typography · layout · effects · borders · animation · components · globals. Wired in Steps 1–4 / §10.2 / §14 / §9. */
export { colorsSubsystem } from "./colors";
/** Contrast audit (WCAG 2 + advisory APCA) — reads a built theme, reports/strict-throws. */
export { audit } from "./colors";
export type { AuditResult, AuditOptions, PairingScore, PairingKind, WcagLevel } from "./colors";
export { typographySubsystem } from "./typography";
export { layoutSubsystem } from "./layout";
export { effectsSubsystem } from "./effects";
export { bordersSubsystem } from "./borders";
export { animationSubsystem } from "./animation";
export { componentsSubsystem } from "./components";
export { globalsSubsystem } from "./globals";

/** Per-subsystem raw authoring-input types (§8a) — composed into `RawTheme`. */
export type { ColorsRaw } from "./colors";
export type { TypographyRaw, TypographyPropertyValue } from "./typography";
export type { EffectsRaw, EffectsPropertyValue } from "./effects";
export type { BordersRaw, BordersPropertyValue } from "./borders";
export type { AnimationRaw } from "./animation";
export type { LayoutRaw, ContainerRaw, ContainerVariantRaw } from "./layout";
export type { ComponentsRaw } from "./components";
export type { GlobalsRaw, GlobalsPreset, GlobalsDeclValue, GlobalsDeclarations, GlobalsElement } from "./globals";
