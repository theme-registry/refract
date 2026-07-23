/**
 * Contrast audit (opt-in) — scores a built theme's colour pairings for **WCAG 2** contrast ratio
 * (the compliance standard) plus an **advisory APCA** Lc reading. It reports; it never mutates the
 * theme and never "fixes" a colour. `audit()` returns structured results by default; a caller (or the
 * `refract audit --strict` CLI) can throw on failures.
 *
 * Which pairings: every palette's `base` ↔ `text`, and every recipe's foreground (`color`) ↔
 * background (`background-color` / `background`) across all subsystems' rule-sets (base + state
 * overrides). A side that isn't a derivable colour (`transparent`, a `var()`, a keyword literal) is
 * reported as `skipped`, not a failure.
 *
 * Colour math is inlined here on purpose: `utils.ts` is vendored to consumers (`build/vendor.ts`) and
 * kept dependency-free / minimal, so we don't widen its export surface for a non-vendored sibling. We
 * reuse only the already-exported {@link parseColor}.
 */
import type { Theme, Ref } from "../../core";
import { RefractError } from "../../core/errors";
import { parseColor, type RGBTuple } from "./utils";

// ── WCAG 2.x ──────────────────────────────────────────────────────────────
// Relative luminance per WCAG 2: linearize each sRGB channel, weight by the luma coefficients.
const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const relLuminance = ([r, g, b]: RGBTuple): number =>
  0.2126 * srgbToLinear(r / 255) + 0.7152 * srgbToLinear(g / 255) + 0.0722 * srgbToLinear(b / 255);

/** WCAG 2 contrast ratio (1–21) between two sRGB colours; order-independent. */
const wcagRatio = (a: RGBTuple, b: RGBTuple): number => {
  const la = relLuminance(a);
  const lb = relLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
};

export type WcagLevel = "AAA" | "AA" | "AA-large" | "fail";
const LEVEL_RANK: Record<WcagLevel, number> = { fail: 0, "AA-large": 1, AA: 2, AAA: 3 };

/** Map a ratio to a level. For normal text 3–4.5 is "AA-large" (passes only at large sizes). */
const wcagLevel = (ratio: number, large: boolean): WcagLevel => {
  if (large) return ratio >= 4.5 ? "AAA" : ratio >= 3 ? "AA" : "fail";
  return ratio >= 7 ? "AAA" : ratio >= 4.5 ? "AA" : ratio >= 3 ? "AA-large" : "fail";
};

// ── APCA (advisory) ───────────────────────────────────────────────────────
// APCA 0.1.9 / formula 0.98G-4g (SAPC). Advisory only — NOT a WCAG substitute — and the draft may
// still shift, so the constants are pinned here. Returns a signed Lc (polarity-aware).
const APCA = {
  mainTRC: 2.4,
  sRco: 0.2126729, sGco: 0.7151522, sBco: 0.072175,
  normBG: 0.56, normTXT: 0.57, revTXT: 0.62, revBG: 0.65,
  blkThrs: 0.022, blkClmp: 1.414,
  scaleBoW: 1.14, loBoWoffset: 0.027,
  scaleWoB: 1.14, loWoBoffset: 0.027,
  deltaYmin: 0.0005, loClip: 0.1,
} as const;

const apcaY = ([r, g, b]: RGBTuple): number =>
  APCA.sRco * Math.pow(r / 255, APCA.mainTRC) +
  APCA.sGco * Math.pow(g / 255, APCA.mainTRC) +
  APCA.sBco * Math.pow(b / 255, APCA.mainTRC);

/** Signed APCA lightness contrast (Lc) of `text` over `bg`. Positive = dark-on-light, negative = light-on-dark. */
const apcaLc = (text: RGBTuple, bg: RGBTuple): number => {
  const clamp = (y: number): number => (y > APCA.blkThrs ? y : y + Math.pow(APCA.blkThrs - y, APCA.blkClmp));
  const yTxt = clamp(apcaY(text));
  const yBg = clamp(apcaY(bg));
  if (Math.abs(yBg - yTxt) < APCA.deltaYmin) return 0;
  let out: number;
  if (yBg > yTxt) {
    const sapc = (Math.pow(yBg, APCA.normBG) - Math.pow(yTxt, APCA.normTXT)) * APCA.scaleBoW;
    out = sapc < APCA.loClip ? 0 : sapc - APCA.loBoWoffset;
  } else {
    const sapc = (Math.pow(yBg, APCA.revBG) - Math.pow(yTxt, APCA.revTXT)) * APCA.scaleWoB;
    out = sapc > -APCA.loClip ? 0 : sapc + APCA.loWoBoffset;
  }
  return out * 100;
};

// ── audit ─────────────────────────────────────────────────────────────────

export type PairingKind = "palette" | "recipe";

export interface PairingScore {
  kind: PairingKind;
  /** Human label, e.g. `colors.brand` or `components.buttons.primary (:hover)`. */
  label: string;
  /** Resolved foreground colour string, or `undefined` when it isn't a derivable colour. */
  fg?: string;
  /** Resolved background colour string, or `undefined` when it isn't a derivable colour. */
  bg?: string;
  /** WCAG 2 contrast ratio (1–21, 2 dp). Absent when skipped. */
  wcagRatio?: number;
  /** WCAG level at the configured text size. Absent when skipped. */
  wcagLevel?: WcagLevel;
  /** Advisory APCA Lc (signed, 1 dp). Absent when skipped. */
  apcaLc?: number;
  /** Whether this pairing met the pass bar (`minWcag`). Absent when skipped. */
  pass?: boolean;
  /** Set when a side isn't a derivable colour — then the score fields are absent. */
  skipped?: string;
}

export interface AuditOptions {
  /** Throw an aggregated error when any pairing fails, instead of only reporting. Default `false`. */
  strict?: boolean;
  /** Treat the foreground as large text (relaxed WCAG thresholds). Default `false`. */
  largeText?: boolean;
  /** The pass bar. Default `"AA"`. `"AA-large"` accepts the 3:1 tier. */
  minWcag?: WcagLevel;
  /** Audit component/recipe fg↔bg pairs. Default `true`. */
  includeRecipes?: boolean;
  /** Audit palette base↔text pairs. Default `true`. */
  includePalettes?: boolean;
}

export interface AuditResult {
  pairings: PairingScore[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    /** The lowest-ratio scored pairing (the worst offender), if any were scored. */
    worst?: PairingScore;
  };
  /** `true` when no scored pairing failed the pass bar. */
  ok: boolean;
}

const round = (n: number, dp: number): number => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

/** Resolve a rule-set declaration `Ref` to a colour string, or `undefined` if it isn't one. */
const refToColor = (theme: Theme, ref: Ref): string | undefined => {
  if (ref.ref !== undefined) {
    try {
      return String(theme.resolveToken(ref.ref));
    } catch {
      return undefined;
    }
  }
  if (typeof ref.value === "string") return ref.value;
  return undefined;
};

const FG_KEY = "color";
const BG_KEYS = ["background-color", "background"] as const;
const pickBg = (decls: Record<string, Ref> | undefined): Ref | undefined => {
  if (!decls) return undefined;
  for (const k of BG_KEYS) if (decls[k]) return decls[k];
  return undefined;
};

/** Score one fg/bg pairing (colours already resolved to strings), or a skipped record. */
const scorePair = (
  kind: PairingKind,
  label: string,
  fg: string | undefined,
  bg: string | undefined,
  options: Required<Pick<AuditOptions, "largeText" | "minWcag">>,
): PairingScore => {
  let fgRgb: RGBTuple | undefined;
  let bgRgb: RGBTuple | undefined;
  try {
    if (fg !== undefined) fgRgb = parseColor(fg).rgb;
  } catch { /* not a derivable colour */ }
  try {
    if (bg !== undefined) bgRgb = parseColor(bg).rgb;
  } catch { /* not a derivable colour */ }

  if (!fgRgb || !bgRgb) {
    return { kind, label, fg, bg, skipped: !fgRgb && !bgRgb ? "no derivable fg/bg" : !fgRgb ? "fg not a colour" : "bg not a colour" };
  }

  const ratio = wcagRatio(fgRgb, bgRgb);
  const level = wcagLevel(ratio, options.largeText);
  const pass = LEVEL_RANK[level] >= LEVEL_RANK[options.minWcag];
  return {
    kind, label, fg, bg,
    wcagRatio: round(ratio, 2),
    wcagLevel: level,
    apcaLc: round(apcaLc(fgRgb, bgRgb), 1),
    pass,
  };
};

/**
 * Audit a built theme's colour pairings. Pure — reads `theme.tokens` / `theme.resolveToken` /
 * `theme.model` only. In `strict` mode, throws one aggregated error listing every failing pairing.
 */
export const audit = (theme: Theme, options: AuditOptions = {}): AuditResult => {
  const opts = {
    largeText: options.largeText ?? false,
    minWcag: options.minWcag ?? ("AA" as WcagLevel),
  };
  const includeRecipes = options.includeRecipes ?? true;
  const includePalettes = options.includePalettes ?? true;
  const pairings: PairingScore[] = [];

  // Palettes: base ↔ text. A palette advertises a pairing by having a `colors.<name>.text` token.
  if (includePalettes) {
    for (const path of Object.keys(theme.tokens)) {
      const m = /^colors\.([^.]+)\.text$/.exec(path);
      if (!m) continue;
      const base = `colors.${m[1]}`;
      let fg: string | undefined, bg: string | undefined;
      try { fg = String(theme.resolveToken(path)); } catch { /* skip */ }
      try { bg = String(theme.resolveToken(base)); } catch { /* skip */ }
      pairings.push(scorePair("palette", base, fg, bg, opts));
    }
  }

  // Recipes: every subsystem's rule-sets — the base declarations + each state/breakpoint override.
  if (includeRecipes) {
    for (const [subsystem, subModel] of Object.entries(theme.model.subsystems)) {
      if (!subModel.ruleSets) continue;
      for (const [group, ruleSetGroup] of Object.entries(subModel.ruleSets)) {
        for (const [variant, ruleSet] of Object.entries(ruleSetGroup)) {
          const baseFg = ruleSet.declarations[FG_KEY];
          const baseBg = pickBg(ruleSet.declarations);
          const label = `${subsystem}.${group}.${variant}`;
          if (baseFg && baseBg) {
            pairings.push(scorePair("recipe", label, refToColor(theme, baseFg), refToColor(theme, baseBg), opts));
          }
          // Overrides (e.g. :hover) can swap bg or fg — score the effective pairing at that condition.
          for (const override of ruleSet.overrides ?? []) {
            const oFg = override.declarations?.[FG_KEY] ?? baseFg;
            const oBg = pickBg(override.declarations) ?? baseBg;
            if (!override.declarations || (!override.declarations[FG_KEY] && !pickBg(override.declarations))) continue;
            if (!oFg || !oBg) continue;
            const cond = override.state ?? override.breakpoint ?? override.query ?? "override";
            pairings.push(scorePair("recipe", `${label} (${cond})`, refToColor(theme, oFg), refToColor(theme, oBg), opts));
          }
        }
      }
    }
  }

  const scored = pairings.filter(p => !p.skipped);
  const failed = scored.filter(p => p.pass === false);
  const worst = scored.reduce<PairingScore | undefined>(
    (w, p) => (w === undefined || (p.wcagRatio ?? Infinity) < (w.wcagRatio ?? Infinity) ? p : w),
    undefined,
  );
  const result: AuditResult = {
    pairings,
    summary: {
      total: scored.length,
      passed: scored.length - failed.length,
      failed: failed.length,
      skipped: pairings.length - scored.length,
      worst,
    },
    ok: failed.length === 0,
  };

  if (options.strict && failed.length > 0) {
    const list = failed.map(p => `${p.label} (${p.wcagRatio}:1, ${p.wcagLevel})`).join(", ");
    throw new RefractError(
      "REFRACT_E_AUDIT",
      `refract audit: ${failed.length} pairing(s) fail WCAG ${opts.minWcag} — ${list}. ` +
        `Adjust the colour(s), lower --min-wcag, or drop --strict to report without failing.`,
      failed.map(p => `${p.label} (${p.wcagRatio}:1, ${p.wcagLevel})`),
    );
  }

  return result;
};
