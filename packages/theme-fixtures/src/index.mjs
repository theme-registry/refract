// Shared RawTheme test fixtures — the private, build-free workspace package every adapter package
// (and the cross-adapter `tests/` gate) depends on, so the golden-driving raw themes live in exactly
// one place. Pure ESM data (no imports, no TS syntax) so it loads natively with no transform, even
// through pnpm's node_modules symlink.
export { reactSc, layout, responsiveComponents, fixtures } from "./fixtures.mjs";
export { statesTheme, statesFixtures } from "./fixtures-states.mjs";
