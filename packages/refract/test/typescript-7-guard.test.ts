/**
 * §19 — a `typescript` that RESOLVES but doesn't expose the compiler API must fail loud.
 *
 * TypeScript 7 (the native port) is the real case: `npm i -D typescript` now resolves to 7.x, whose
 * main entry is `./lib/version.cjs` and exports only `{ version, versionMajorMinor }` — the compiler
 * API moved behind `./unstable/*` subpaths with a different shape. The old loader only caught
 * *resolution* failure, so this module sailed through and every `.ts` theme.config died three frames
 * later on the opaque `Cannot read properties of undefined (reading 'ESNext')`.
 *
 * Sibling of `typescript-optional.test.ts` (which mocks it as *absent*); the two error paths need
 * separate files because `vi.mock` applies to the whole module graph.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Exactly what TS 7's main entry gives you: a version, and nothing refract can drive.
vi.mock("typescript", () => ({ default: { version: "7.0.2", versionMajorMinor: "7.0" } }));

const tmpDirs: string[] = [];
const makeTmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "tk-ts7-"));
  tmpDirs.push(dir);
  return dir;
};
afterAll(() => tmpDirs.forEach(d => rmSync(d, { recursive: true, force: true })));

describe("typescript 7 guard", () => {
  it("a `.ts` config names the installed version and the two ways out", async () => {
    const { loadConfig } = await import("../src/build/config");
    const dir = makeTmp();
    writeFileSync(
      join(dir, "theme.config.ts"),
      `const config = { raw: {}, targets: [] };\nexport default config;\n`,
      "utf8",
    );

    // The opaque failure this replaces — assert we never see it again.
    await expect(loadConfig({ cwd: dir })).rejects.not.toThrow(/reading 'ESNext'/);

    const error = await loadConfig({ cwd: dir }).catch((e: unknown) => e as Error);
    expect(error.message).toContain("7.0.2"); // the actual installed version, so the fix is obvious
    expect(error.message).toContain("transpileModule");
    expect(error.message).toContain("typescript@5");
    expect(error.message).toContain(".mjs"); // the escape hatch that needs no typescript at all
  });

  it("the `helpers` vendoring path fails the same way (it transpiles too)", async () => {
    const { transpileToEsm } = await import("../src/build/paths");
    await expect(transpileToEsm("export const x = 1;")).rejects.toThrow(
      /does not expose the compiler API refract needs/,
    );
  });
});
