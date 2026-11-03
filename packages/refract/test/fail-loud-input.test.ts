/**
 * Input that used to be dropped or misread without an error now throws a coded `RefractError`:
 * a typography recipe's `css` block or unknown key, a typography recipe value naming no variant,
 * an unknown `layout` key, and a plain `{ ref }` alias (no `modifiers`) as a base, variant or mode.
 * Each case pairs with a still-valid neighbour so the check stays narrow.
 */
import { describe, it, expect } from "vitest";
import { createTheme, createNoopAdapter, RefractError } from "@theme-registry/refract";

const build = (raw: unknown) => createTheme(raw as never, { adapter: createNoopAdapter() });
const failure = (raw: unknown): { code?: string; message: string } => {
  try {
    build(raw);
  } catch (e) {
    expect(e).toBeInstanceOf(RefractError);
    return { code: (e as RefractError).code, message: (e as Error).message };
  }
  throw new Error("expected createTheme to throw");
};

const typography = {
  fontFamily: { base: "Arial", variants: { heading: "Georgia" } },
  fontSize: { base: 16, variants: { lg: 20 } },
};

describe("typography recipes fail loud", () => {
  it("still lowers variant names and \"base\"", () => {
    const theme = build({ typography: { ...typography, recipes: { text: { body: { fontFamily: "heading", fontSize: "base" } } } } });
    expect(theme.model.subsystems.typography.ruleSets).toBeDefined();
  });

  it("rejects a css block", () => {
    const { code, message } = failure({ typography: { ...typography, recipes: { text: { body: { fontSize: "lg", css: { textWrap: "balance" } } } } } });
    expect(code).toBe("REFRACT_E_RECIPE_PROPERTY");
    expect(message).toContain('"css"');
    expect(message).toContain("typography.recipes.text.body");
  });

  it("rejects an unknown key", () => {
    expect(failure({ typography: { ...typography, recipes: { text: { body: { fontSzie: "lg" } } } } }).code).toBe("REFRACT_E_RECIPE_PROPERTY");
  });

  it("rejects a value naming no variant (was var(typography.fontFamily.Inter))", () => {
    const { code, message } = failure({ typography: { ...typography, recipes: { text: { body: { fontFamily: "Inter" } } } } });
    expect(code).toBe("REFRACT_E_VARIANT_REF");
    expect(message).toContain('"Inter"');
    expect(message).toContain("known: base, heading");
  });

  it("rejects a property the theme doesn't define", () => {
    expect(failure({ typography: { ...typography, recipes: { text: { body: { lineHeight: "tight" } } } } }).code).toBe("REFRACT_E_VARIANT_REF");
  });

  it("rejects a non-string value", () => {
    expect(failure({ typography: { ...typography, recipes: { text: { body: { fontSize: { ref: "typography.fontSize.lg" } } } } } }).code).toBe(
      "REFRACT_E_VARIANT_REF",
    );
  });

  it("checks responsive overrides too", () => {
    const raw = {
      breakpoints: { sm: 576 },
      typography: { ...typography, recipes: { text: { body: { fontSize: "base", responsive: [{ breakpoint: "sm", fontSize: "huge" }] } } } },
    };
    expect(failure(raw).code).toBe("REFRACT_E_VARIANT_REF");
  });
});

describe("layout is closed", () => {
  it("accepts its known keys", () => {
    expect(() => build({ layout: { spacing: { base: 4 }, gutters: { base: 16 } } })).not.toThrow();
  });

  it("rejects an unknown key (was dropped)", () => {
    const { code, message } = failure({ layout: { spacing: { base: 4 }, padding: { base: 8 } } });
    expect(code).toBe("REFRACT_E_LAYOUT");
    expect(message).toContain('"padding"');
  });
});

describe("plain { ref } aliases are rejected until raw aliases land", () => {
  it("still accepts a colour derivation { ref, modifiers }", () => {
    expect(() =>
      build({ colors: { primary: { base: "#336699", variants: { soft: { modifiers: [{ lighten: 10 }] } } }, accent: "#ff0000" } }),
    ).not.toThrow();
  });

  it("rejects a colour variant { ref } (was an inherited base + a junk -ref var)", () => {
    const { code, message } = failure({ colors: { primary: { base: "#336699", variants: { alias: { ref: "accent" } } }, accent: "#ff0000" } });
    expect(code).toBe("REFRACT_E_VARIANT");
    expect(message).toContain("colors.primary.variants.alias");
  });

  it("rejects a typography variant { ref }", () => {
    expect(failure({ typography: { fontSize: { base: 16, variants: { lg: 20, big: { ref: "typography.fontSize.lg" } } } } }).code).toBe(
      "REFRACT_E_VARIANT",
    );
  });

  it("rejects a typography base { ref } (was emitting nothing)", () => {
    expect(failure({ typography: { fontSize: 16, lineHeight: { base: { ref: "typography.fontSize" } } } }).code).toBe("REFRACT_E_PROPERTY");
    expect(failure({ typography: { fontSize: 16, lineHeight: { ref: "typography.fontSize" } } }).code).toBe("REFRACT_E_PROPERTY");
  });

  it("rejects a mode { ref } without modifiers", () => {
    const raw = { colors: { primary: { base: "#336699", modes: [{ mode: "dark", ref: "accent" }] }, accent: "#ff0000" } };
    expect(failure(raw).code).toBe("REFRACT_E_MODE");
  });
});
