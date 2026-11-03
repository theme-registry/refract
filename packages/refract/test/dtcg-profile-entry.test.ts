/**
 * The Refract DTCG profile entry points: importDTCGProfile / fromDTCGProfile (./dtcg),
 * toDTCG(raw, { profile: true }), loadDTCG / loadDTCGProfile (./build, from disk), a config whose
 * raw is a profile file path, `refract tokens --profile`, and `refract validate`.
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTheme, createNoopAdapter, RefractError } from "../src/core";
import { importDTCGProfile, fromDTCGProfile, toDTCG } from "../src/dtcg";
import { loadDTCG, loadDTCGProfile, loadConfig, runTokens, runValidate, main } from "../src/build";

const fixtures = fileURLToPath(new URL("./fixtures/dtcg-profile/", import.meta.url));
const read = (name: string) => JSON.parse(readFileSync(join(fixtures, name), "utf8"));
const build = (raw: unknown) => createTheme(raw as never, { adapter: createNoopAdapter() });
const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "refract-profile-"));
  dirs.push(d);
  return d;
};
afterAll(() => dirs.forEach(d => rmSync(d, { recursive: true, force: true })));

const raw = { colors: { accent: { base: "#e64980", modes: [{ mode: "dark", base: "#f783ac" }] } }, layout: { spacing: { base: 4, variants: { md: 12 } } } };

describe("./dtcg", () => {
  it("importDTCGProfile reads a single file and a resolver set", () => {
    expect(importDTCGProfile(read("base.tokens.json")).report.modes).toEqual([]);
    const set = importDTCGProfile({ resolver: read("resolver.json"), files: { "base.tokens.json": read("base.tokens.json"), "dark.tokens.json": read("dark.tokens.json") } });
    expect(set.report.modes).toEqual(["dark"]);
    expect(fromDTCGProfile(read("base.tokens.json"))).toEqual(importDTCGProfile(read("base.tokens.json")).raw);
  });

  it("toDTCG(raw, { profile: true }) writes files that read back to the same model", () => {
    const files = toDTCG(raw as never, { profile: true });
    expect(Object.keys(files.files)).toEqual(["base.tokens.json", "dark.tokens.json"]);
    expect(build(fromDTCGProfile(files)).model).toEqual(build(raw).model);
  });

  it("toDTCG(theme, { profile: true }) explains that it needs the raw theme", () => {
    expect(() => toDTCG(build(raw) as never, { profile: true })).toThrow(RefractError);
    expect(() => toDTCG(build(raw) as never, { profile: true })).toThrow(/takes the raw theme/);
  });

  it("plain toDTCG(theme) is unchanged", () => {
    expect(toDTCG(build(raw))).toHaveProperty("color");
  });
});

describe("./build", () => {
  it("loadDTCG reads a resolver and its files from disk", async () => {
    const theme = build(await loadDTCG(join(fixtures, "resolver.json")));
    expect(theme.model.subsystems.colors.properties!.surface.modes?.[0].mode).toBe("dark");
    expect((await loadDTCGProfile(join(fixtures, "base.tokens.json"))).report.tokens).toBeGreaterThan(5);
  });

  it("loadDTCG names a missing file", async () => {
    await expect(loadDTCG(join(fixtures, "nope.json"))).rejects.toThrow(/doesn't exist/);
  });

  it("a config's raw can be a profile file path, relative to the config", async () => {
    const dir = tmp();
    writeFileSync(join(dir, "theme.config.mjs"), `export default { raw: "${join(fixtures, "resolver.json").replace(/\\/g, "/")}", targets: [] };\n`);
    const { config } = await loadConfig({ cwd: dir });
    expect(typeof config.raw).toBe("object");
    expect(build(config.raw).model.subsystems.colors.properties!.surface.modes).toBeDefined();
  });

  it("refract tokens --profile writes the resolver and token files", async () => {
    const dir = tmp();
    writeFileSync(join(dir, "theme.config.mjs"), `export default { raw: ${JSON.stringify(raw)}, targets: [] };\n`);
    const result = await runTokens({ cwd: dir, profile: true });
    expect(result.files?.map(f => f.slice(dir.length + 1))).toEqual(["tokens/resolver.json", "tokens/base.tokens.json", "tokens/dark.tokens.json"]);
    expect(build(await loadDTCG(join(dir, "tokens/resolver.json"))).model).toEqual(build(raw).model);
  });

  it("refract validate reports a valid profile and fails an invalid one", async () => {
    const ok = await runValidate(join(fixtures, "resolver.json"));
    expect(ok.report.modes).toEqual(["dark"]);
    expect(ok.report.generated.length).toBeGreaterThan(0);

    const dir = tmp();
    const bad = join(dir, "bad.tokens.json");
    writeFileSync(bad, JSON.stringify({ $extensions: { "com.theme-registry.refract.profile": { version: 1 } }, color: {} }));
    await expect(runValidate(bad)).rejects.toThrow(/"color" isn't a subsystem/);
    expect(await main(["validate", bad])).toBe(1);
    expect(await main(["validate", join(fixtures, "resolver.json")])).toBe(0);
    expect(existsSync(bad)).toBe(true);
  });
});
