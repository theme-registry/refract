/**
 * The JSON adapter (§11.2) — the second output adapter, the proof that "one Model, many formats"
 * is real. Locks:
 *  1. The full document shape (flat address-keyed `tokens` / `ruleSets` / `keyframes` + config).
 *  2. That the parts DTCG can't carry — recipes, states, responsive overrides, composition-by-
 *     reference — survive as structured data.
 *  3. `refs` modes (`both` / `path` / `value`) on the leaves.
 *  4. `emit(plan)` mapping the §9 vocabulary (single/split/subsystem/components) onto the buckets.
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTheme } from "@theme-registry/refract";
import { emitTheme } from "@theme-registry/refract/build";
import { createJsonAdapter } from "../src";
import type { JsonDoc } from "../src";
import type { Emit } from "@theme-registry/refract";
import { reactSc } from "@theme-registry/theme-fixtures";
import { statesTheme } from "@theme-registry/theme-fixtures";

// Build a theme on the JSON adapter and reach its `extend` surface (`json` / `jsonString`).
type JsonTheme = { json: JsonDoc; jsonString: string };
const buildJson = (raw: unknown, options?: Parameters<typeof createJsonAdapter>[0]): JsonTheme =>
  createTheme(raw as never, { adapter: createJsonAdapter(options) }) as unknown as JsonTheme;

// Emit to a throwaway dir and return { filename -> parsed JSON } (+ the raw string for shape asserts).
const tmpDirs: string[] = [];
afterAll(() => tmpDirs.forEach(d => rmSync(d, { recursive: true, force: true })));
const emitToMap = async (
  emit: Emit,
  raw: unknown = reactSc.rawTheme,
): Promise<Record<string, unknown>> => {
  const outDir = mkdtempSync(join(tmpdir(), "tk-json-"));
  tmpDirs.push(outDir);
  const { files } = await emitTheme({ raw: raw as never, adapter: createJsonAdapter(), outDir, emit });
  const out: Record<string, unknown> = {};
  for (const abs of files) out[abs.slice(outDir.length + 1)] = JSON.parse(readFileSync(abs, "utf8"));
  return out;
};

describe("json adapter — full document", () => {
  it("lowers the whole Model to flat address-keyed buckets (reactSc)", () => {
    const { json, jsonString } = buildJson(reactSc.rawTheme);

    // Buckets present + flat-addressed.
    expect(json.breakpoints).toEqual({ sm: 576, md: 768, lg: 1024, xl: 1280 });
    expect(json.tokens?.["colors.primary"]).toEqual({ value: "rgb(77, 171, 247)" });
    expect(json.tokens?.["colors.primary.text"]).toEqual({ value: "rgb(255, 255, 255)" });

    // A rule-set carries declarations with BOTH the token ref and the resolved value.
    const solidPrimary = json.ruleSets?.["colors.solid.primary"];
    expect(solidPrimary?.kind).toBe("recipe");
    expect(solidPrimary?.declarations["background"]).toEqual({ ref: "colors.primary", value: "rgb(77, 171, 247)" });
    expect(solidPrimary?.declarations.color).toEqual({ ref: "colors.primary.text", value: "rgb(255, 255, 255)" });

    // No redundant `name` field — the key IS the identity.
    expect(solidPrimary).not.toHaveProperty("name");

    // The whole document is a stable snapshot.
    expect(jsonString).toMatchSnapshot();
  });

  it("literal variants stay literal; synthesized steps carry their derivation as data", () => {
    // Explicit variant values (reactSc authors `dark: "#1c7ed6"`) are plain literals.
    const { json } = buildJson(reactSc.rawTheme);
    expect(json.tokens?.["colors.primary.dark"]).toEqual({ value: "rgb(28, 126, 214)" });

    // A `{ base }`-only color SYNTHESIZES its steps → each is a derived ref (ref + fn + arg + value).
    const brand = buildJson({ colors: { brand: { base: "#336699" } } });
    const dark = brand.json.tokens?.["colors.brand.dark"];
    expect(dark).toMatchObject({ ref: "colors.brand", fn: "darken", arg: 10 });
    expect(dark?.value).toBeDefined();
  });
});

describe("json adapter — the parts DTCG can't represent", () => {
  it("keeps states, responsive overrides, and composition-by-reference as data (statesTheme)", () => {
    const { json, jsonString } = buildJson(statesTheme.rawTheme);

    const solid = json.ruleSets?.["colors.solid.primary"];
    // A pure-state override.
    expect(solid?.overrides).toContainEqual({
      state: "hover",
      declarations: { "background": { ref: "colors.primary.dark", value: "rgb(28, 126, 214)" } },
    });
    // A state × breakpoint cross-product override.
    expect(solid?.overrides).toContainEqual(
      expect.objectContaining({ state: "hover", breakpoint: "md" }),
    );

    // Composition survives by reference (NOT flattened) — the graph is visible.
    const button = json.ruleSets?.["components.buttons.primary"];
    expect(button?.references).toContain("colors:solid.primary");
    // The component's own hover delta rides its own override.
    expect(button?.overrides).toContainEqual(expect.objectContaining({ state: "hover" }));

    expect(jsonString).toMatchSnapshot();
  });
});

describe("json adapter — refs modes", () => {
  it("value: resolved literals only, no ref", () => {
    const { json } = buildJson(reactSc.rawTheme, { refs: "value" });
    expect(json.ruleSets?.["colors.solid.primary"].declarations["background"]).toEqual({ value: "rgb(77, 171, 247)" });
    expect(json.tokens?.["colors.primary.dark"]).toEqual({ value: "rgb(28, 126, 214)" });
  });

  it("path: refs only; literals still emit their value", () => {
    const { json } = buildJson(reactSc.rawTheme, { refs: "path" });
    // Referenced declaration → ref, no value.
    expect(json.ruleSets?.["colors.solid.primary"].declarations["background"]).toEqual({ ref: "colors.primary" });
    // A literal token (no ref) → keeps its value (nothing else to stand in).
    expect(json.tokens?.["colors.primary"]).toEqual({ value: "rgb(77, 171, 247)" });
    expect(json.tokens?.["colors.primary.dark"]).toEqual({ value: "rgb(28, 126, 214)" });
    // A synthesized (derived) token → ref + derivation, NO value in path mode.
    const brand = buildJson({ colors: { brand: { base: "#336699" } } }, { refs: "path" });
    expect(brand.json.tokens?.["colors.brand.dark"]).toEqual({ ref: "colors.brand", fn: "darken", arg: 10 });
  });
});

describe("json adapter — emit(plan)", () => {
  it("single (default) → one theme.json equal to the doc", async () => {
    const files = await emitToMap(undefined);
    expect(Object.keys(files)).toEqual(["theme.json"]);
    const { json } = buildJson(reactSc.rawTheme);
    expect(files["theme.json"]).toEqual(json);
  });

  it("split → styles doc (ruleSets/keyframes) + variables doc (tokens/config)", async () => {
    const files = await emitToMap("split");
    expect(Object.keys(files).sort()).toEqual(["styles.json", "variables.json"]);
    const styles = files["styles.json"] as JsonDoc;
    const vars = files["variables.json"] as JsonDoc;
    expect(styles.ruleSets).toBeTruthy();
    expect(styles.tokens).toBeUndefined();
    expect(vars.tokens).toBeTruthy();
    expect(vars.breakpoints).toBeTruthy();
    expect(vars.ruleSets).toBeUndefined();
  });

  it("subsystem → per-subsystem token/style docs; components = styles only", async () => {
    const files = await emitToMap("subsystem");
    // colors splits into both sides.
    expect(files["colors.json"]).toBeTruthy();
    expect(files["colors.variables.json"]).toBeTruthy();
    // components owns no tokens → no variables file.
    expect(files["components.json"]).toBeTruthy();
    expect(files["components.variables.json"]).toBeUndefined();
    // A subsystem file is scoped to its own addresses.
    const colors = files["colors.variables.json"] as JsonDoc;
    expect(Object.keys(colors.tokens ?? {}).every(k => k.startsWith("colors."))).toBe(true);
  });

  it("components (inline, default) → flattened, resolved, no refs", async () => {
    const files = await emitToMap("components");
    // One file per variant by default (`<group>-<variant>.json`).
    const buttons = files["buttons-primary.json"] as JsonDoc;
    const rs = buttons.ruleSets?.["components.buttons.primary"];
    expect(rs).toBeTruthy();
    // Inline bakes values — no `ref` anywhere in the merged declarations. A structured
    // (shadow/transition) token has no single literal, so it bakes to `struct` instead of `value`.
    for (const leaf of Object.values(rs!.declarations)) {
      expect(leaf).not.toHaveProperty("ref");
      expect(leaf.value ?? leaf.struct).toBeDefined();
    }
    // No tree-shaken tokens file in inline mode.
    expect(files["variables.json"]).toBeUndefined();
  });

  it("components (inline:false) → refs kept + tree-shaken tokens file", async () => {
    const files = await emitToMap({ type: "components", inline: false });
    const buttons = files["buttons-primary.json"] as JsonDoc;
    const rs = buttons.ruleSets?.["components.buttons.primary"];
    // At least one declaration keeps its ref.
    const refs = Object.values(rs!.declarations).filter(l => l.ref !== undefined);
    expect(refs.length).toBeGreaterThan(0);
    // The tree-shaken tokens file exists and covers exactly the referenced paths.
    const vars = files["variables.json"] as JsonDoc;
    expect(vars.tokens).toBeTruthy();
    for (const leaf of refs) {
      expect(vars.tokens).toHaveProperty(leaf.ref!);
    }
  });
});

describe("JSON — unified grammar (§12 Phase 4): carries the new model as data", () => {
  it("serialises a recipe state `target` (dec.8) verbatim in the override data", () => {
    const t = createTheme(
      {
        colors: {
          primary: { base: "#4dabf7", variants: { dark: "#1c7ed6" } },
          recipes: {
            solid: {
              primary: {
                background: "primary",
                variants: { lg: { background: "primary.dark" } },
                states: [
                  { state: "hover", background: "primary.dark" },
                  { state: "hover", target: "lg", background: "primary" },
                ],
              },
            },
          },
        },
      },
      { adapter: createJsonAdapter({ prefix: "dt" }) },
    ) as any;
    const overrides = (t.json as JsonDoc).ruleSets!["colors.solid.primary"].overrides;
    // both hovers are carried; the second keeps its `target` (data-complete for the new model)
    expect(overrides).toHaveLength(2);
    expect(overrides[0]).toMatchObject({ state: "hover" });
    expect(overrides[0].target).toBeUndefined();
    expect(overrides[1]).toMatchObject({ state: "hover", target: "lg" });
  });
});
