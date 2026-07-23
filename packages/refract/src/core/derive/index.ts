/**
 * Derivation layer for the clean-room tree (Step 0e).
 *
 * The cycle-safe derivation resolver (`resolveToken` / `resolveTokenMap`) + the registry
 * merge (`buildDerivationRegistry`). Ported from `core/common/resolveTokens.ts`; pure
 * Model/Ref data → literals, no CSS. Not yet wired into `theme.tokens` / `theme.resolveToken`
 * — that's Step 0f.
 */
export type { DerivationFn, DerivationRegistry } from "./resolveTokens";
export { buildDerivationRegistry, resolveToken, resolveTokenMap } from "./resolveTokens";
export { bakeCrossPropertyDerivations } from "./crossProperty";
