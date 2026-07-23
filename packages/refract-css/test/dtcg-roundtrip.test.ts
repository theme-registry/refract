/**
 * DTCG recipe round-trip (F2) — opt-in `toDTCG(theme, { includeRecipes: true })` stashes the built
 * rule-set / keyframe / container IR under the reverse-DNS `com.theme-registry.refract` `$extensions`
 * key, and `fromDTCGTheme` reinjects it via createTheme's overlay so `refract → DTCG → refract`
 * preserves recipes. The extension is refract-specific: other DTCG tools ignore it, and standard
 * property-token output stays byte-identical when the flag is off.
 */
import { describe, it, expect } from "vitest";
import { createTheme } from "@theme-registry/refract";
import { createCssAdapter } from "../src";
import { toDTCG, fromDTCGTheme, readRefractExtension, REFRACT_DTCG_EXTENSION } from "@theme-registry/refract/dtcg";

const raw = {
  colors: {
    brand: { base: "#4c6ef5", text: "#fff" },
    recipes: {
      solid: { brand: { background: "brand", color: "brand.text", states: { hover: { background: "brand.dark" } } } },
    },
  },
  components: {
    recipes: { buttons: { primary: { colors: "solid.brand", css: { padding: "8px 14px", cursor: "pointer" } } } },
  },
};

const build = () => createTheme(raw, { adapter: createCssAdapter() });

describe("DTCG recipe round-trip", () => {
  it("emits no $extensions by default — standard output stays byte-identical", () => {
    const t = build();
    expect(toDTCG(t).$extensions).toBeUndefined();
    expect(toDTCG(t, { includeRecipes: false }).$extensions).toBeUndefined();
    // flag-off and no-options produce the same document
    expect(toDTCG(t, { includeRecipes: false })).toEqual(toDTCG(t));
  });

  it("stashes the built rule-set IR under the reverse-DNS key with a schema version", () => {
    const t = build();
    const doc = toDTCG(t, { includeRecipes: true });
    const ext = doc.$extensions?.[REFRACT_DTCG_EXTENSION] as any;
    expect(ext).toBeTruthy();
    expect(ext.version).toBe(1);
    // the payload is the built IR verbatim
    expect(ext.ruleSets.colors.solid).toEqual(t.model.subsystems.colors.ruleSets!.solid);
    expect(ext.ruleSets.components.buttons).toEqual(t.model.subsystems.components.ruleSets!.buttons);
    // property tokens still emit normally alongside the extension (interoperable surface intact)
    expect(Object.keys(doc).some((k) => !k.startsWith("$"))).toBe(true);
  });

  it("round-trips recipes losslessly via fromDTCGTheme", () => {
    const t = build();
    const doc = toDTCG(t, { includeRecipes: true });
    const t2 = fromDTCGTheme(doc, { adapter: createCssAdapter() });
    // the rule-set IR survives verbatim for every subsystem that had recipes
    expect(t2.model.subsystems.colors.ruleSets).toEqual(t.model.subsystems.colors.ruleSets);
    expect(t2.model.subsystems.components.ruleSets).toEqual(t.model.subsystems.components.ruleSets);
    // and the emitted recipe classes come back identically
    expect(t.css).toContain(".dt-colors-solid-brand {");
    expect(t2.css).toContain(".dt-colors-solid-brand {");
    expect(t2.css).toContain(".dt-components-buttons-primary");
  });

  it("round-trips the full property Model — modes / derivations / external — losslessly (§12 Phase 2)", () => {
    const t = createTheme(
      {
        extends: { prefix: "dt" },
        colors: {
          bg: { base: "#101418" },
          brand: {
            base: "#4c6ef5",
            // a derived variant (`{ ref, modifiers }`) — the portable surface would flatten this to a literal
            variants: { deep: { modifiers: [{ darken: 10 }] } },
            // an appearance-mode override list — not carried by the portable token surface at all
            modes: [{ mode: "dark", base: "#1c1c1c", text: "#eee" }],
            text: "#fff",
          },
          // an external passthrough — parent-owned var; the portable surface omits it
          surface: { external: "colors.bg" },
        },
      },
      { adapter: createCssAdapter() },
    );
    const doc = toDTCG(t, { includeRecipes: true });

    // the portable surface omits the external token (no coercion-hostile var() colour to re-import)
    expect((doc.color as any)?.surface).toBeUndefined();

    const t2 = fromDTCGTheme(doc, { adapter: createCssAdapter() });
    // the whole colours property Model comes back verbatim: derived variant refs, the modes list, external
    expect(t2.model.subsystems.colors.properties).toEqual(t.model.subsystems.colors.properties);
    // and the emitted CSS is byte-identical (dark-mode blocks + derived var + external var passthrough)
    expect(t2.css).toBe(t.css);
  });

  it("a plain DTCG document (no refract extension) round-trips to a recipe-less theme", () => {
    const t = build();
    const doc = toDTCG(t); // no extension
    const t2 = fromDTCGTheme(doc, { adapter: createCssAdapter() });
    expect(t2.model.subsystems.components?.ruleSets).toBeUndefined();
    expect(t2.model.subsystems.colors.properties).toBeTruthy(); // property tokens still imported
  });

  it("throws on an unreadable extension version", () => {
    const t = build();
    const doc = toDTCG(t, { includeRecipes: true });
    (doc.$extensions![REFRACT_DTCG_EXTENSION] as any).version = 2;
    expect(() => readRefractExtension(doc)).toThrow(/Unsupported refract DTCG extension version 2/);
    expect(() => fromDTCGTheme(doc, { adapter: createCssAdapter() })).toThrow(/version 2/);
  });

  it("validates reinjected refs — an overlay rule-set ref to a missing token throws", () => {
    const t = build();
    const doc = toDTCG(t, { includeRecipes: true });
    // inject a component rule-set whose declaration references a token that doesn't exist
    (doc.$extensions![REFRACT_DTCG_EXTENSION] as any).ruleSets.components.bad = {
      x: { declarations: { color: { ref: "colors.nope" } }, overrides: [] },
    };
    expect(() => fromDTCGTheme(doc, { adapter: createCssAdapter() })).toThrow(/unknown token 'colors\.nope'/);
  });
});
