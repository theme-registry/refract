/**
 * Contrast audit (F1) — WCAG 2 contrast ratio + advisory APCA Lc over a built theme's palette
 * (base↔text) and recipe (fg↔bg) pairings. Reports by default; `strict` throws an aggregated error.
 * A non-derivable side (`transparent`, `var()`, a keyword) is `skipped`, never a failure.
 */
import { describe, it, expect } from "vitest";
import { createTheme, createNoopAdapter, audit } from "@theme-registry/refract";

const raw = {
  colors: {
    ink: { base: "#000000", text: "#ffffff" }, // 21:1, AAA
    faint: { base: "#777777", text: "#808080" }, // ~1.13:1, fail
    recipes: {
      solid: { card: { background: "ink", color: "ink.text" } }, // 21:1 via refs
      outline: { ghost: { backgroundColor: "transparent", color: "ink" } }, // bg transparent → skipped
    },
  },
};

const build = () => createTheme(raw, { adapter: createNoopAdapter() });

describe("contrast audit", () => {
  it("scores a max-contrast palette pairing (WCAG 21:1 AAA, APCA advisory)", () => {
    const r = audit(build());
    const ink = r.pairings.find((p) => p.label === "colors.ink")!;
    expect(ink.wcagRatio).toBe(21);
    expect(ink.wcagLevel).toBe("AAA");
    expect(ink.pass).toBe(true);
    // APCA 0.1.9 / 0.98G-4g: white text on black bg (reverse polarity) ≈ -107.9 Lc.
    expect(ink.apcaLc).toBe(-107.9);
  });

  it("flags a low-contrast palette pairing as failing", () => {
    const r = audit(build());
    const faint = r.pairings.find((p) => p.label === "colors.faint")!;
    expect(faint.wcagLevel).toBe("fail");
    expect(faint.pass).toBe(false);
  });

  it("scores recipe fg↔bg pairs and skips a non-derivable side", () => {
    const r = audit(build());
    const card = r.pairings.find((p) => p.label === "colors.solid.card")!;
    expect(card.kind).toBe("recipe");
    expect(card.wcagRatio).toBe(21);
    const ghost = r.pairings.find((p) => p.label === "colors.outline.ghost")!;
    expect(ghost.skipped).toBeTruthy();
    expect(ghost.wcagRatio).toBeUndefined();
  });

  it("summarizes pass/fail/skip and names the worst offender", () => {
    const r = audit(build());
    expect(r.summary.total).toBe(3); // ink, faint, solid.card scored
    expect(r.summary.passed).toBe(2);
    expect(r.summary.failed).toBe(1);
    expect(r.summary.skipped).toBe(1); // outline.ghost
    expect(r.summary.worst?.label).toBe("colors.faint");
    expect(r.ok).toBe(false);
  });

  it("strict mode throws one aggregated error naming the failing pairing", () => {
    expect(() => audit(build(), { strict: true })).toThrow(/fail WCAG AA/);
    expect(() => audit(build(), { strict: true })).toThrow(/colors\.faint/);
  });

  it("does not throw in report mode even when pairings fail", () => {
    expect(() => audit(build())).not.toThrow();
    expect(audit(build()).ok).toBe(false);
  });

  it("respects minWcag — a 21:1 pair still passes at AAA", () => {
    const r = audit(build(), { minWcag: "AAA" });
    expect(r.pairings.find((p) => p.label === "colors.ink")!.pass).toBe(true);
    expect(r.pairings.find((p) => p.label === "colors.faint")!.pass).toBe(false);
  });
});
