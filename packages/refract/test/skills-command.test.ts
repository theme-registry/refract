/**
 * Gate for `refract skills` (the bundled-skill installer). Drives `listSkills` / `runSkillsInstall` /
 * `runSkillsUpdate` directly against the real bundled catalog (`packages/refract/skills/`), writing into
 * throwaway temp dirs. Covers: catalog parsing + tiers, the claude (verbatim) vs agents-md (router +
 * body) targets, selection (`--only` / optional), idempotency, and update-from-manifest.
 */
import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listSkills,
  runSkillsInstall,
  runSkillsUpdate,
  AGENT_TARGETS,
} from "../src/build/skillsCommand";

const tmpDirs: string[] = [];
const makeTmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "refract-skills-"));
  tmpDirs.push(dir);
  return dir;
};
afterAll(() => tmpDirs.forEach(d => rmSync(d, { recursive: true, force: true })));

describe("skills catalog", () => {
  it("parses every bundled SKILL.md with a name, description, and tier", () => {
    const skills = listSkills();
    expect(skills.length).toBeGreaterThanOrEqual(14);
    for (const s of skills) {
      expect(s.name).toMatch(/^[a-z][a-z-]+$/);
      expect(s.description.length).toBeGreaterThan(10);
      expect(["core", "optional"]).toContain(s.tier);
      expect(s.raw.startsWith("---")).toBe(true); // frontmatter kept in raw
      expect(s.body.startsWith("---")).toBe(false); // stripped in body
    }
    const byName = new Map(skills.map(s => [s.name, s]));
    expect(byName.get("theme-authoring")?.tier).toBe("core");
    expect(byName.get("colors")?.tier).toBe("core");
    expect(byName.get("adapter-scaffold")?.tier).toBe("optional");
    expect(byName.get("troubleshooting")?.tier).toBe("optional");
  });

  it("exposes exactly the six agent targets", () => {
    expect([...AGENT_TARGETS]).toEqual([
      "claude",
      "codex",
      "opencode",
      "github-copilot",
      "cursor",
      "generic",
    ]);
  });
});

describe("claude target (verbatim per-skill files)", () => {
  it("writes .claude/skills/<name>/SKILL.md with the full source and a manifest", () => {
    const cwd = makeTmp();
    const result = runSkillsInstall({ agents: ["claude"], cwd });

    const hub = join(cwd, ".claude", "skills", "theme-authoring", "SKILL.md");
    expect(existsSync(hub)).toBe(true);
    expect(readFileSync(hub, "utf8")).toContain("name: theme-authoring"); // verbatim frontmatter

    // No agents-md artefacts for a claude-only install.
    expect(existsSync(join(cwd, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(cwd, ".refract", "skills"))).toBe(false);

    const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8"));
    expect(manifest.agents).toEqual(["claude"]);
    expect(manifest.skills).toContain("theme-authoring");
    expect(typeof manifest.refractVersion).toBe("string");
  });
});

describe("agents-md targets (router + on-demand bodies)", () => {
  it("writes an AGENTS.md router pointing at .refract/skills body files", () => {
    const cwd = makeTmp();
    runSkillsInstall({ agents: ["codex"], cwd });

    const router = readFileSync(join(cwd, "AGENTS.md"), "utf8");
    expect(router).toContain("<!-- refract-skills:start -->");
    expect(router).toContain("<!-- refract-skills:end -->");
    expect(router).toContain("(.refract/skills/colors.md)");

    const body = join(cwd, ".refract", "skills", "colors.md");
    expect(existsSync(body)).toBe(true);
    expect(readFileSync(body, "utf8").startsWith("---")).toBe(false); // body only, no frontmatter
  });

  it("routes each family agent to its own instructions file", () => {
    const cwd = makeTmp();
    runSkillsInstall({ agents: ["github-copilot", "cursor"], cwd });
    expect(existsSync(join(cwd, ".github", "copilot-instructions.md"))).toBe(true);
    expect(existsSync(join(cwd, ".cursor", "rules", "refract-skills.mdc"))).toBe(true);
  });

  it("is idempotent — re-installing does not duplicate the router block", () => {
    const cwd = makeTmp();
    runSkillsInstall({ agents: ["codex"], cwd });
    runSkillsInstall({ agents: ["codex"], cwd });
    const router = readFileSync(join(cwd, "AGENTS.md"), "utf8");
    const count = router.split("<!-- refract-skills:start -->").length - 1;
    expect(count).toBe(1);
  });

  it("preserves surrounding AGENTS.md content across an update", () => {
    const cwd = makeTmp();
    writeFileSync(join(cwd, "AGENTS.md"), "# My project\n\nHouse rules.\n", "utf8");
    runSkillsInstall({ agents: ["codex"], cwd });
    const router = readFileSync(join(cwd, "AGENTS.md"), "utf8");
    expect(router).toContain("# My project");
    expect(router).toContain("House rules.");
    expect(router).toContain("<!-- refract-skills:start -->");
  });
});

describe("selection", () => {
  it("installs only core skills by default, optional when asked", () => {
    const core = runSkillsInstall({ agents: ["claude"], cwd: makeTmp() });
    expect(core.skills).not.toContain("adapter-scaffold");
    expect(core.skills).not.toContain("troubleshooting");

    const withOpt = runSkillsInstall({ agents: ["claude"], cwd: makeTmp(), includeOptional: true });
    expect(withOpt.skills).toContain("adapter-scaffold");
    expect(withOpt.skills).toContain("troubleshooting");
  });

  it("honors an explicit --only list and rejects unknown names", () => {
    const result = runSkillsInstall({ agents: ["claude"], cwd: makeTmp(), skills: ["colors", "layout"] });
    expect(result.skills).toEqual(["colors", "layout"]);
    expect(() => runSkillsInstall({ agents: ["claude"], cwd: makeTmp(), skills: ["nope"] })).toThrow(
      /Unknown skill "nope"/,
    );
  });
});

describe("update", () => {
  it("re-syncs the same agents + skills recorded in the manifest", () => {
    const cwd = makeTmp();
    runSkillsInstall({ agents: ["codex"], cwd, skills: ["colors"] });
    const updated = runSkillsUpdate({ cwd });
    expect(updated.agents).toEqual(["codex"]);
    expect(updated.skills).toEqual(["colors"]);
    expect(existsSync(join(cwd, ".refract", "skills", "colors.md"))).toBe(true);
  });

  it("errors when nothing was installed yet", () => {
    expect(() => runSkillsUpdate({ cwd: makeTmp() })).toThrow(/No skills manifest/);
  });
});
