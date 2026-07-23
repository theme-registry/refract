/**
 * `refract skills` — install the bundled AI skills into a project's agent CLI(s) (Node-only).
 *
 * The canonical skill sources ship *inside this package* (`skills/<name>/SKILL.md`, added to
 * `package.json#files`), so `node_modules/@theme-registry/refract/skills/` is the version-locked
 * source of truth — upgrade refract, re-run `skills update`, and the skills match the installed API.
 *
 * One source, many agent formats (the same one-model-many-adapters idea refract is built on):
 *   - **claude** natively loads `.claude/skills/<name>/SKILL.md`, so we copy each file verbatim.
 *   - Every other agent (codex, opencode, github-copilot, cursor, generic) loads a flat instructions
 *     file on *every* request, so inlining a dozen skill bodies would bloat each turn. Instead we
 *     write a small **router** into that agent's instructions file (a table pointing at
 *     `.refract/skills/<name>.md`) and drop the full bodies as on-demand files — reconstructing
 *     Claude's progressive disclosure manually.
 *
 * The command implementations return data (`runSkillsInstall`/`List`/`Update`), so tests drive them
 * directly; the CLI wrapper (`cli.ts`) maps argv + interactive prompts onto them.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { findPackageRoot } from "./paths";

export type SkillTier = "core" | "optional";

/** One skill's parsed metadata + content. */
export interface SkillMeta {
  readonly name: string;
  readonly description: string;
  readonly tier: SkillTier;
  /** The full file (frontmatter + body) — what the claude target copies verbatim. */
  readonly raw: string;
  /** The markdown body after the frontmatter — what the agents-md targets drop as an on-demand file. */
  readonly body: string;
  readonly sourcePath: string;
}

export type AgentTarget = "claude" | "codex" | "opencode" | "github-copilot" | "cursor" | "generic";
export type InstallScope = "local" | "global";

export const AGENT_TARGETS: readonly AgentTarget[] = [
  "claude",
  "codex",
  "opencode",
  "github-copilot",
  "cursor",
  "generic",
];

/**
 * How each agent consumes skills. `claude` gets native per-skill directories; every other agent
 * shares the "agents-md" shape (a router in its instructions file + on-demand body files), differing
 * only in *which* file it reads. Adding a bespoke per-agent adapter later means one more entry here.
 */
const AGENT_ROUTER: Record<AgentTarget, { kind: "claude" | "agents-md"; routerFile: string }> = {
  claude: { kind: "claude", routerFile: ".claude/skills" },
  codex: { kind: "agents-md", routerFile: "AGENTS.md" },
  opencode: { kind: "agents-md", routerFile: "AGENTS.md" },
  "github-copilot": { kind: "agents-md", routerFile: ".github/copilot-instructions.md" },
  cursor: { kind: "agents-md", routerFile: ".cursor/rules/refract-skills.mdc" },
  generic: { kind: "agents-md", routerFile: "AGENTS.md" },
};

const ROUTER_START = "<!-- refract-skills:start -->";
const ROUTER_END = "<!-- refract-skills:end -->";
const MANIFEST_REL = join(".refract", "skills.lock");
const BODY_DIR_REL = join(".refract", "skills");

/** Locate the bundled catalog. Defaults to `<packageRoot>/skills` (ships via package.json#files). */
export function skillsCatalogDir(override?: string): string {
  return override ?? join(findPackageRoot(), "skills");
}

/** Read this package's `name` + `version` (recorded in the manifest so `update` matches the API). */
function readOwnPackageMeta(): { name: string; version: string } {
  const pkg = JSON.parse(readFileSync(join(findPackageRoot(), "package.json"), "utf8")) as {
    name?: string;
    version?: string;
  };
  return { name: pkg.name ?? "@theme-registry/refract", version: pkg.version ?? "0.0.0" };
}

/** Parse the leading `--- … ---` frontmatter for the fields we need; body is everything after. */
function parseSkillFile(raw: string, sourcePath: string): SkillMeta {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  const front = match ? match[1] : "";
  const body = match ? raw.slice(match[0].length).replace(/^\s+/, "") : raw;
  const field = (key: string): string | undefined => {
    const line = new RegExp(`^${key}:\\s*(.*)$`, "m").exec(front);
    return line ? line[1].trim() : undefined;
  };
  const name = field("name") ?? dirname(sourcePath).split(/[\\/]/).pop() ?? "unnamed";
  const tier = field("tier") === "optional" ? "optional" : "core";
  return { name, description: field("description") ?? "", tier, raw, body, sourcePath };
}

/** Read every `<catalog>/<name>/SKILL.md`, sorted by name. */
export function listSkills(catalogDir?: string): SkillMeta[] {
  const dir = skillsCatalogDir(catalogDir);
  if (!existsSync(dir)) {
    throw new Error(`Skills catalog not found at "${dir}". Reinstall @theme-registry/refract.`);
  }
  return readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(dir, entry.name, "SKILL.md"))
    .filter(existsSync)
    .map(path => parseSkillFile(readFileSync(path, "utf8"), path))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The one-line "use it for" cell — the description up to (but not including) its `Triggers:` list. */
function shortDescription(skill: SkillMeta): string {
  const beforeTriggers = skill.description.split(/\s*Triggers:/)[0].trim();
  const firstSentence = beforeTriggers.split(/\.\s/)[0].trim();
  return (firstSentence || beforeTriggers).replace(/\|/g, "\\|");
}

/** Render the shared router block (identical content for every agents-md target). */
function renderRouter(skills: SkillMeta[]): string {
  const rows = skills
    .map(s => `| [${s.name}](${BODY_DIR_REL}/${s.name}.md) | ${shortDescription(s)} |`)
    .join("\n");
  return [
    ROUTER_START,
    "",
    "## refract theme skills",
    "",
    "These skills document the [refract](https://github.com/4i4-team/theme-toolkit) theme toolkit.",
    "When a task matches a row below, read the linked file before working.",
    "",
    "| Skill | Use it for |",
    "| --- | --- |",
    rows,
    "",
    ROUTER_END,
  ].join("\n");
}

/** Insert or replace the marked router block in an existing instructions file (idempotent). */
function upsertRouterBlock(existing: string, block: string): string {
  const start = existing.indexOf(ROUTER_START);
  const end = existing.indexOf(ROUTER_END);
  if (start !== -1 && end !== -1 && end > start) {
    return existing.slice(0, start) + block + existing.slice(end + ROUTER_END.length);
  }
  const trimmed = existing.replace(/\s+$/, "");
  return trimmed ? `${trimmed}\n\n${block}\n` : `${block}\n`;
}

function writeFileEnsuring(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

export interface SkillsInstallOptions {
  readonly agents: readonly AgentTarget[];
  /** `local` (default) writes into the project; `global` into the user's home dir. */
  readonly scope?: InstallScope;
  /** Explicit skill names to install. Omit to install all `core` skills (+ optional if `includeOptional`). */
  readonly skills?: readonly string[];
  /** When `skills` is omitted, also install `optional`-tier skills. Default `false`. */
  readonly includeOptional?: boolean;
  /** Project dir for `local` scope (default `process.cwd()`). */
  readonly cwd?: string;
  /** Home dir for `global` scope (default `os.homedir()`); injectable for tests. */
  readonly home?: string;
  /** Override the bundled catalog dir (tests). */
  readonly catalogDir?: string;
}

export interface SkillsInstallResult {
  readonly scope: InstallScope;
  readonly agents: readonly AgentTarget[];
  readonly skills: readonly string[];
  readonly files: readonly string[];
  readonly manifestPath: string;
}

interface SkillsManifest {
  readonly schema: 1;
  readonly packageName: string;
  readonly refractVersion: string;
  readonly scope: InstallScope;
  readonly agents: readonly AgentTarget[];
  readonly skills: readonly string[];
}

/** Resolve the selection from options: explicit names, or all core (+ optional). */
function selectSkills(catalog: SkillMeta[], options: SkillsInstallOptions): SkillMeta[] {
  if (options.skills && options.skills.length > 0) {
    const byName = new Map(catalog.map(s => [s.name, s]));
    const chosen: SkillMeta[] = [];
    for (const name of options.skills) {
      const skill = byName.get(name);
      if (!skill) {
        throw new Error(
          `Unknown skill "${name}". Available: ${catalog.map(s => s.name).join(", ")}.`,
        );
      }
      chosen.push(skill);
    }
    return chosen;
  }
  return catalog.filter(s => s.tier === "core" || options.includeOptional);
}

/**
 * Install (or re-sync) the selected skills for the selected agents. Pure w.r.t. its options — the CLI
 * layer handles prompting; this does the filesystem work and returns what it wrote.
 */
export function runSkillsInstall(options: SkillsInstallOptions): SkillsInstallResult {
  const scope: InstallScope = options.scope ?? "local";
  const base = scope === "global" ? (options.home ?? homedir()) : (options.cwd ?? process.cwd());
  const catalog = listSkills(options.catalogDir);
  const selected = selectSkills(catalog, options);
  if (options.agents.length === 0) throw new Error("Pick at least one agent target.");

  const files = new Set<string>();
  const needsAgentsMd = options.agents.some(a => AGENT_ROUTER[a].kind === "agents-md");

  // Shared on-demand body files (written once, referenced by every agents-md router).
  if (needsAgentsMd) {
    for (const skill of selected) {
      const path = join(base, BODY_DIR_REL, `${skill.name}.md`);
      writeFileEnsuring(path, skill.body);
      files.add(path);
    }
  }

  for (const agent of options.agents) {
    const target = AGENT_ROUTER[agent];
    if (target.kind === "claude") {
      // Native: one directory per skill, the file copied verbatim.
      for (const skill of selected) {
        const path = join(base, target.routerFile, skill.name, "SKILL.md");
        writeFileEnsuring(path, skill.raw);
        files.add(path);
      }
    } else {
      // Router into this agent's instructions file (idempotent via the marker block).
      const routerPath = join(base, target.routerFile);
      const existing = existsSync(routerPath) ? readFileSync(routerPath, "utf8") : "";
      writeFileEnsuring(routerPath, upsertRouterBlock(existing, renderRouter(selected)));
      files.add(routerPath);
    }
  }

  const { name: packageName, version: refractVersion } = readOwnPackageMeta();
  const manifest: SkillsManifest = {
    schema: 1,
    packageName,
    refractVersion,
    scope,
    agents: [...options.agents],
    skills: selected.map(s => s.name),
  };
  const manifestPath = join(base, MANIFEST_REL);
  writeFileEnsuring(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return {
    scope,
    agents: [...options.agents],
    skills: selected.map(s => s.name),
    files: [...files].sort(),
    manifestPath,
  };
}

/** Re-sync a prior install from its `.refract/skills.lock` (upgrades the skill bodies to this version). */
export function runSkillsUpdate(
  options: { scope?: InstallScope; cwd?: string; home?: string; catalogDir?: string } = {},
): SkillsInstallResult {
  const scope: InstallScope = options.scope ?? "local";
  const base = scope === "global" ? (options.home ?? homedir()) : (options.cwd ?? process.cwd());
  const manifestPath = join(base, MANIFEST_REL);
  if (!existsSync(manifestPath)) {
    throw new Error(
      `No skills manifest at "${manifestPath}". Run \`refract skills install\` first.`,
    );
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as SkillsManifest;
  return runSkillsInstall({
    agents: manifest.agents,
    scope,
    skills: manifest.skills,
    cwd: options.cwd,
    home: options.home,
    catalogDir: options.catalogDir,
  });
}
