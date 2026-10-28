// Pluggable importers — `defineImporter` fills missing hooks from the importer it extends and hands
// that importer's hook to an override as `next`; the engine keeps the report whatever the hooks do.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  defineImporter,
  dtcgImporter,
  importDTCG,
  IMPORTER_CONTRACT_VERSION,
  type DTCGDocument,
  type Importer,
} from "../src/dtcg";
import { RefractError } from "../src/core";
import { loadImporter, scaffoldRaw } from "../src/build/importCommand";

const load = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as DTCGDocument;

const sample = load("dtcg-import-sample.tokens.json");
const graph = load("dtcg-2025-10.tokens.json");

describe("defineImporter", () => {
  it("with no hooks behaves exactly like the default importer", () => {
    const same = defineImporter({ name: "same", version: IMPORTER_CONTRACT_VERSION });
    for (const doc of [sample, graph]) {
      expect(JSON.stringify(importDTCG(doc, { importer: same }))).toBe(JSON.stringify(importDTCG(doc)));
    }
  });

  it("lets place() change one rule and hand the rest to next", () => {
    const radiiAsSpacing = defineImporter({
      name: "radii-as-spacing",
      version: 1,
      place(t, ctx, next) {
        if (t.path[0] === "radii") return { kind: "token", subsystem: "layout", property: "spacing", member: t.path.at(-1)! };
        return next(t);
      },
    });
    const { raw, report } = importDTCG(sample, { importer: radiiAsSpacing });
    expect(report.placements["radii.round"]).toBe("layout.spacing.round");
    expect((raw.borders as Record<string, unknown> | undefined)?.radius).toBeUndefined();
    // Everything else is the default's.
    expect(report.placements["panel.main.hover"]).toBe("colors.panel-main.hover");
  });

  it("lets value() rewrite what next returns", () => {
    const upper = defineImporter({
      name: "upper",
      version: 1,
      value(t, where, ctx, next) {
        const v = next(t, where);
        return t.type === "color" && typeof v === "string" ? v.toUpperCase() : v;
      },
    });
    const colors = importDTCG(sample, { importer: upper }).raw.colors as Record<string, { base: string }>;
    expect(colors["panel-main"].base).toBe("#24348F");
  });

  it("chains through extends: next is the extended importer's hook", () => {
    const calls: string[] = [];
    const first = defineImporter({
      name: "first",
      version: 1,
      place(t, ctx, next) {
        calls.push(`first:${t.id}`);
        return next(t);
      },
    });
    const second = defineImporter({
      name: "second",
      version: 1,
      extends: first,
      place(t, ctx, next) {
        if (t.id === "radii.round") return { skip: "not wanted here" };
        return next(t);
      },
    });
    const { report } = importDTCG(sample, { importer: second });
    expect(report.unmapped).toContainEqual({ path: "radii.round", reason: "not wanted here" });
    expect(calls).toContain("first:radii.default");
    expect(calls).not.toContain("first:radii.round");
  });

  it("reports a token whose value hook returns nothing, so none is dropped silently", () => {
    const blank = defineImporter({ name: "blank", version: 1, value: (t, where, ctx, next) => (t.id === "radii.round" ? undefined : next(t, where)) });
    const { report } = importDTCG(sample, { importer: blank });
    expect(report.unmapped).toContainEqual({ path: "radii.round", reason: "dimension value can't be read (see diagnostics)" });
    expect(report.placements["radii.round"]).toBeUndefined();
  });

  it("lets parse() filter the graph and finalize() add to the result", () => {
    const colorsOnly = defineImporter({
      name: "colors-only",
      version: 1,
      parse(doc, ctx, next) {
        const g = next(doc);
        const tokens = g.tokens.filter(t => t.type === "color");
        return { ...g, tokens, byId: new Map(tokens.map(t => [t.id, t])) };
      },
      finalize(result, ctx, next) {
        const r = next(result);
        return { ...r, report: { ...r.report, notes: [...r.report.notes, { path: "(document)", message: "colours only" }] } };
      },
    });
    const { raw, report } = importDTCG(sample, { importer: colorsOnly });
    expect(Object.keys(raw)).toEqual(["colors"]);
    expect(report.notes.at(-1)).toEqual({ path: "(document)", message: "colours only" });
  });

  it("reads composites after simple tokens, so ctx.placed() is the final path", () => {
    // The shadow comes first in the document and aliases a `base` member, which only becomes the
    // property itself once the whole `ink` group is in.
    const doc = {
      shadow: { card: { $type: "shadow", $value: { color: "{ink.base}", offsetX: "0px", offsetY: "1px", blur: "2px", spread: "0px" } } },
      ink: { $type: "color", base: { $value: "#112233" }, soft: { $value: "#445566" } },
    } as unknown as DTCGDocument;
    let seen: string | undefined;
    const spy = defineImporter({
      name: "spy",
      version: 1,
      value(t, where, ctx, next) {
        if (t.type === "shadow") seen = ctx.placed("ink.base");
        return next(t, where);
      },
    });
    const { raw } = importDTCG(doc, { importer: spy });
    expect(seen).toBe("colors.ink");
    expect((raw.effects as any).shadow.variants.card[0].color).toBe("colors.ink");
  });
});

describe("ctx.cssValue", () => {
  it("survives a parse that spreads the graph", () => {
    const spread = defineImporter({ name: "spread", version: 1, parse: (doc, ctx, next) => ({ ...next(doc) }) });
    expect(JSON.stringify(importDTCG(graph, { importer: spread }))).toBe(JSON.stringify(importDTCG(graph)));
  });

  it("reads the view through a registry symbol, so another bundled copy of the engine sees it", () => {
    let seen: unknown;
    const probe = defineImporter({
      name: "probe",
      version: 1,
      parse(doc, ctx, next) {
        const g = next(doc);
        // What a second copy of the default parser would attach: only the shared symbol key.
        return Object.assign({ ...g }, { [Symbol.for("@theme-registry/refract.dtcg.legacyView")]: new Map([["panel.main.$root", "from-the-view"]]) });
      },
      value(t, where, ctx, next) {
        if (t.id === "panel.main.$root") seen = ctx.cssValue(t.id);
        return next(t, where);
      },
    });
    importDTCG(sample, { importer: probe });
    expect(seen).toBe("from-the-view");
  });
});

describe("importer contract", () => {
  it("refuses an importer written against another contract version", () => {
    const old = defineImporter({ name: "old", version: 0 });
    expect(() => importDTCG(sample, { importer: old })).toThrow(RefractError);
    try {
      importDTCG(sample, { importer: old });
    } catch (e) {
      expect((e as RefractError).code).toBe("REFRACT_E_IMPORTER");
      expect((e as Error).message).toContain('"old" targets importer contract version 0');
    }
  });

  it("refuses something that isn't an importer", () => {
    expect(() => importDTCG(sample, { importer: { name: "x" } as unknown as Importer })).toThrow(/Not an importer/);
  });
});

describe("loadImporter (--importer)", () => {
  it("resolves a built-in name", async () => {
    expect(await loadImporter("dtcg")).toBe(dtcgImporter);
  });

  it("loads a module's default export", async () => {
    const dir = mkdtempSync(join(tmpdir(), "refract-importer-"));
    writeFileSync(
      join(dir, "none.importer.mjs"),
      `export default {
  name: "none", version: 1,
  parse: () => ({ tokens: [], byId: new Map(), diagnostics: [] }),
  place: () => ({ skip: "none" }), value: () => undefined, finalize: r => r,
};\n`,
    );
    const importer = await loadImporter("./none.importer.mjs", dir);
    expect(importer.name).toBe("none");
    expect(importDTCG(sample, { importer }).report.tokens).toBe(0);
  });

  it("names the built-ins when neither a built-in nor a file matches", async () => {
    await expect(loadImporter("no-such-importer", tmpdir())).rejects.toThrow(/not a built-in \(dtcg\)/);
  });

  it("refuses a module that doesn't export an importer", async () => {
    const dir = mkdtempSync(join(tmpdir(), "refract-importer-"));
    writeFileSync(join(dir, "bad.mjs"), `export default { name: "bad" };\n`);
    await expect(loadImporter("./bad.mjs", dir)).rejects.toThrow(/defineImporter/);
  });

  it("records the importer in the generated raw file's header", () => {
    expect(scaffoldRaw("@theme-registry/refract", {}, '"tokens.json"', dtcgImporter)).toContain(
      'from "tokens.json" with the "dtcg" importer (contract v1).',
    );
  });
});
