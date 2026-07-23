/**
 * `diffThemes` — the blast radius of a candidate theme edit, computed against a base (§5 agent-native).
 *
 * refract stores every synthesized rung/variant as a `{ ref, fn, arg }` graph, not a frozen literal, so
 * a candidate theme can be *built and compared* before it's applied — the claim no token file can make:
 * see what a change does before you make it. This is the shared engine behind `refract diff <candidate>`
 * (a human CLI + a CI gate) and the MCP `diffTheme` tool (an agent's plan-then-apply guardrail).
 *
 * Three axes, each adapter-independent except `classes`:
 *   - `tokens`   — which resolved token values moved (added / removed / changed).
 *   - `classes`  — which emitted recipe classes changed CSS (only when the themes emit classes, e.g. the
 *                  CSS adapter — read via the duck-typed `renderRecipe` / `getClass`).
 *   - `contrast` — which WCAG pairings crossed a pass/level threshold (via {@link audit}).
 */
import type { Theme } from "../core";
import { audit, type PairingScore } from "../subsystems/colors/audit";

export type ChangeKind = "added" | "removed" | "changed";

export interface TokenChange {
  path: string;
  before: string | null;
  after: string | null;
  kind: ChangeKind;
}

export interface ClassChange {
  /** The emitted class name (or the `subsystem.group.variant` id when no adapter names it). */
  name: string;
  kind: ChangeKind;
}

export interface ContrastScore {
  ratio?: number;
  level?: string;
  pass?: boolean;
}

export interface ContrastChange {
  label: string;
  before: ContrastScore | null;
  after: ContrastScore | null;
  /** True when the pass verdict or the WCAG level changed — the threshold-crossing an agent cares about. */
  crossed: boolean;
}

export interface ThemeDiff {
  tokens: TokenChange[];
  classes: ClassChange[];
  contrast: ContrastChange[];
  summary: {
    tokensChanged: number;
    classesChanged: number;
    /** Pairings whose pass verdict or level crossed a threshold. */
    pairingsCrossed: number;
  };
}

/** The CSS-style surface a class-emitting adapter attaches to the theme (duck-typed — absent on noop). */
type ClassEmittingTheme = Theme & {
  renderRecipe?: (subsystem: string, group: string, variant: string) => string;
  getClass?: (subsystem: string, group: string, variant: string) => string | undefined;
};

const resolvedValue = (theme: Theme, path: string): string | null => {
  try {
    return String(theme.resolveToken(path));
  } catch {
    return null;
  }
};

const diffTokens = (base: Theme, candidate: Theme): TokenChange[] => {
  const paths = new Set([...Object.keys(base.tokens), ...Object.keys(candidate.tokens)]);
  const out: TokenChange[] = [];
  for (const path of paths) {
    const inBase = path in base.tokens;
    const inCandidate = path in candidate.tokens;
    const before = inBase ? resolvedValue(base, path) : null;
    const after = inCandidate ? resolvedValue(candidate, path) : null;
    if (inBase && !inCandidate) out.push({ path, before, after: null, kind: "removed" });
    else if (!inBase && inCandidate) out.push({ path, before: null, after, kind: "added" });
    else if (before !== after) out.push({ path, before, after, kind: "changed" });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
};

/** Enumerate every recipe identity a theme's Model declares (`subsystem.group.variant`). */
const recipeIds = (theme: Theme): Array<{ subsystem: string; group: string; variant: string }> => {
  const out: Array<{ subsystem: string; group: string; variant: string }> = [];
  for (const [subsystem, sub] of Object.entries(theme.model.subsystems)) {
    for (const [group, ruleSetGroup] of Object.entries(sub.ruleSets ?? {})) {
      for (const variant of Object.keys(ruleSetGroup)) out.push({ subsystem, group, variant });
    }
  }
  return out;
};
const hasRecipe = (theme: Theme, s: string, g: string, v: string): boolean =>
  Boolean(theme.model.subsystems[s]?.ruleSets?.[g]?.[v]);

const diffClasses = (base: Theme, candidate: Theme): ClassChange[] => {
  const b = base as ClassEmittingTheme;
  const c = candidate as ClassEmittingTheme;
  // Class-level diff needs an adapter that emits classes on at least one side; otherwise there's nothing
  // to compare (noop themes have no CSS). Report empty rather than inventing names.
  if (!b.renderRecipe && !c.renderRecipe) return [];
  const seen = new Set<string>();
  const ids = [...recipeIds(base), ...recipeIds(candidate)].filter((id) => {
    const key = `${id.subsystem}.${id.group}.${id.variant}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const out: ClassChange[] = [];
  for (const { subsystem, group, variant } of ids) {
    const inBase = hasRecipe(base, subsystem, group, variant);
    const inCandidate = hasRecipe(candidate, subsystem, group, variant);
    const name =
      c.getClass?.(subsystem, group, variant) ??
      b.getClass?.(subsystem, group, variant) ??
      `${subsystem}.${group}.${variant}`;
    if (inBase && !inCandidate) out.push({ name, kind: "removed" });
    else if (!inBase && inCandidate) out.push({ name, kind: "added" });
    else {
      const before = b.renderRecipe?.(subsystem, group, variant) ?? "";
      const after = c.renderRecipe?.(subsystem, group, variant) ?? "";
      if (before !== after) out.push({ name, kind: "changed" });
    }
  }
  return out.sort((a, b2) => a.name.localeCompare(b2.name));
};

const diffContrast = (base: Theme, candidate: Theme): ContrastChange[] => {
  const score = (p?: PairingScore): ContrastScore | null =>
    p ? { ratio: p.wcagRatio, level: p.wcagLevel, pass: p.pass } : null;
  const byLabel = (pairings: readonly PairingScore[]): Map<string, PairingScore> =>
    new Map(pairings.map((p) => [p.label, p]));
  const before = byLabel(audit(base).pairings);
  const after = byLabel(audit(candidate).pairings);
  const labels = new Set([...before.keys(), ...after.keys()]);
  const out: ContrastChange[] = [];
  for (const label of labels) {
    const b = before.get(label);
    const a = after.get(label);
    const bs = score(b);
    const as = score(a);
    const changed = bs?.ratio !== as?.ratio || bs?.level !== as?.level || Boolean(b) !== Boolean(a);
    if (!changed) continue;
    const crossed = (b?.pass ?? null) !== (a?.pass ?? null) || (b?.wcagLevel ?? null) !== (a?.wcagLevel ?? null);
    out.push({ label, before: bs, after: as, crossed });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
};

/**
 * Diff a candidate theme against a base. Both should be built with the same adapter; pass a
 * class-emitting adapter (e.g. CSS) on both sides to populate `classes`, or any adapter for the
 * adapter-independent `tokens` / `contrast` axes.
 */
export function diffThemes(base: Theme, candidate: Theme): ThemeDiff {
  const tokens = diffTokens(base, candidate);
  const classes = diffClasses(base, candidate);
  const contrast = diffContrast(base, candidate);
  return {
    tokens,
    classes,
    contrast,
    summary: {
      tokensChanged: tokens.length,
      classesChanged: classes.length,
      pairingsCrossed: contrast.filter((c) => c.crossed).length,
    },
  };
}
