import { describe, it, expect } from "vitest";
import {
  mergeComponentRuleSet,
  parseRuleSetReference,
} from "../src/core/model";
import type { RuleSet, ThemeModel } from "../src/core/model";

// §9c — the format-neutral component merge. Tests run purely against hand-built
// ThemeModels (no adapter / build imports) and assert the LOCKED precedence, the
// bucketed shape, referencedPaths enumeration, unresolved-reference throws, and that
// the source RuleSet objects are deep-unchanged after the call.

const rs = (r: Partial<RuleSet>): RuleSet => ({ declarations: {}, overrides: [], ...r });

/** A model where component `card.default` references colors `solid.primary` + typography `text.body`. */
const model = (): ThemeModel => ({
  breakpoints: { md: 768 },
  subsystems: {
    colors: {
      ruleSets: {
        solid: {
          primary: rs({
            declarations: {
              background: { ref: "colors.primary" },
              color: { ref: "colors.primary.text" },
            },
            overrides: [
              { state: "hover", declarations: { background: { ref: "colors.primary.dark" } } },
              {
                breakpoint: "md",
                query: "min",
                declarations: { background: { ref: "colors.primary.md" } },
              },
            ],
          }),
        },
      },
    },
    typography: {
      ruleSets: {
        text: {
          body: rs({
            declarations: {
              color: { ref: "typography.color.body" },
              "font-size": { ref: "typography.fontSize.md" },
            },
          }),
        },
      },
    },
    components: {
      ruleSets: {
        card: {
          default: rs({
            references: ["colors:solid.primary", "typography:text.body"],
            declarations: {
              color: { value: "#123456" }, // own css delta — wins over both referenced `color`s
              padding: { value: "8px" },
            },
            overrides: [
              { state: "hover", declarations: { color: { value: "#654321" } } },
              {
                breakpoint: "md",
                query: "min",
                declarations: { padding: { value: "12px" } },
              },
            ],
          }),
        },
      },
    },
  },
});

describe("parseRuleSetReference", () => {
  it("splits subsystem:group.variant", () => {
    expect(parseRuleSetReference("colors:solid.primary")).toEqual({
      subsystem: "colors",
      group: "solid",
      variant: "primary",
    });
  });

  it("keeps dots after the first in the variant", () => {
    expect(parseRuleSetReference("layout:padding.button-lg.x")).toEqual({
      subsystem: "layout",
      group: "padding",
      variant: "button-lg.x",
    });
  });

  it("returns undefined for malformed refs", () => {
    expect(parseRuleSetReference("nocolon")).toBeUndefined();
    expect(parseRuleSetReference("colors:nodot")).toBeUndefined();
    expect(parseRuleSetReference(":solid.primary")).toBeUndefined();
  });
});

describe("mergeComponentRuleSet — base precedence", () => {
  it("unions referenced declarations in reference order, own css delta last/highest", () => {
    const merged = mergeComponentRuleSet(model(), "card", "default");
    expect(merged.base).toEqual({
      background: { ref: "colors.primary" }, // from colors:solid.primary
      color: { value: "#123456" }, // own delta overrides BOTH referenced `color`s
      "font-size": { ref: "typography.fontSize.md" }, // from typography:text.body
      padding: { value: "8px" }, // own only
    });
  });

  it("later reference wins over an earlier one on a shared property key", () => {
    const m = model();
    // Give typography a `background` too — it appears AFTER colors in reference order → wins.
    m.subsystems.typography!.ruleSets!.text.body.declarations.background = {
      ref: "typography.bg",
    };
    // Remove the own delta's non-conflicting props to isolate the reference-order conflict.
    const merged = mergeComponentRuleSet(m, "card", "default");
    expect(merged.base.background).toEqual({ ref: "typography.bg" });
  });
});

describe("mergeComponentRuleSet — states", () => {
  it("merges per-state overrides, own delta last", () => {
    const merged = mergeComponentRuleSet(model(), "card", "default");
    expect(merged.states).toEqual({
      hover: {
        background: { ref: "colors.primary.dark" }, // from the referenced recipe's :hover
        color: { value: "#654321" }, // own :hover delta wins
      },
    });
  });
});

describe("mergeComponentRuleSet — responsive", () => {
  it("buckets by (breakpoint, query, orientation, state) and merges declarations", () => {
    const merged = mergeComponentRuleSet(model(), "card", "default");
    expect(merged.responsive).toEqual([
      {
        breakpoint: "md",
        query: "min",
        declarations: {
          background: { ref: "colors.primary.md" }, // referenced recipe's md override
          padding: { value: "12px" }, // own md override
        },
      },
    ]);
  });

  it("keeps distinct entries per query/orientation/state and separates a state+breakpoint bucket", () => {
    const m = model();
    m.subsystems.colors!.ruleSets!.solid.primary.overrides.push(
      { breakpoint: "md", query: "max", declarations: { color: { ref: "colors.max" } } },
      {
        breakpoint: "md",
        query: "min",
        state: "hover",
        declarations: { color: { ref: "colors.md.hover" } },
      },
    );
    const merged = mergeComponentRuleSet(m, "card", "default");
    // md/min (existing), md/max (new), md/min+hover (new) → 3 distinct buckets.
    expect(merged.responsive).toHaveLength(3);
    expect(merged.responsive.find(e => e.query === "max")).toMatchObject({
      breakpoint: "md",
      query: "max",
      declarations: { color: { ref: "colors.max" } },
    });
    expect(merged.responsive.find(e => e.state === "hover")).toMatchObject({
      breakpoint: "md",
      query: "min",
      state: "hover",
      declarations: { color: { ref: "colors.md.hover" } },
    });
  });
});

describe("mergeComponentRuleSet — referencedPaths", () => {
  it("enumerates exactly the distinct token paths across all buckets, first-appearance order, skipping value-only refs", () => {
    const merged = mergeComponentRuleSet(model(), "card", "default");
    expect(merged.referencedPaths).toEqual([
      "colors.primary", // base background
      "typography.fontSize.md", // base font-size
      "colors.primary.dark", // hover background
      "colors.primary.md", // md background
    ]);
    // value-only refs (own deltas #123456 / #654321 / 8px / 12px) never appear.
    expect(merged.referencedPaths).not.toContain("#123456");
  });
});

describe("mergeComponentRuleSet — unconditional override folds into base", () => {
  it("an override with declarations but no breakpoint/state merges into base", () => {
    const m = model();
    m.subsystems.components!.ruleSets!.card.default.overrides.push({
      target: "ghost",
      declarations: { outline: { value: "1px solid" } },
    });
    const merged = mergeComponentRuleSet(m, "card", "default");
    expect(merged.base.outline).toEqual({ value: "1px solid" });
  });
});

describe("mergeComponentRuleSet — errors", () => {
  it("throws on an unresolved reference", () => {
    const m = model();
    m.subsystems.components!.ruleSets!.card.default.references = ["colors:solid.ghost"];
    expect(() => mergeComponentRuleSet(m, "card", "default")).toThrow(
      'mergeComponentRuleSet: unresolved reference "colors:solid.ghost"',
    );
  });

  it("throws on a missing component rule-set", () => {
    expect(() => mergeComponentRuleSet(model(), "card", "nope")).toThrow(
      'mergeComponentRuleSet: no component rule-set "card.nope"',
    );
  });
});

describe("mergeComponentRuleSet — input immutability", () => {
  it("does not mutate the authored RuleSets (deep-unchanged) and clones Refs", () => {
    const m = model();
    const snapshot = structuredClone(m);
    const merged = mergeComponentRuleSet(m, "card", "default");
    expect(m).toEqual(snapshot); // source model deep-unchanged

    // Merged Refs are clones — mutating one must not touch the authored declaration.
    merged.base.background.ref = "MUTATED";
    expect(m.subsystems.colors!.ruleSets!.solid.primary.declarations.background).toEqual({
      ref: "colors.primary",
    });
  });
});
