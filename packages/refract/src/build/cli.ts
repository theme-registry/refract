/**
 * `refract` CLI (Node-only, §7 Step 10c) — a thin subcommand dispatcher over the build layer.
 *
 * Arg parsing is hand-wired on `node:util`'s `parseArgs` (no new dep). Commands:
 *   - `init`   — scaffold a runnable `theme.config.(ts|js|mjs)` (`--js`/`--mjs`/`--force`).
 *   - `import` — seed a `theme.raw.ts` (+ config) from a DTCG `tokens.json` (`--out`/`--raw-only`/…).
 *   - `build`  — load the config → `emitTheme` per target (`--config`/`--out`/`--target`).
 *   - `tokens` — DTCG export (`toDTCG` → `tokens.json`); adapter-free, reads only the config's `raw`.
 *
 * The command implementations (`runInit`/`runImport`/`runBuild`/`runTokens`) live in their own modules and
 * return data, so the gate test drives them directly; this file only maps argv → those calls + prints
 * summaries. It imports zero adapters — the config's own `import` is the adapter seam (10b).
 */
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { runBuild } from "./buildCommand";
import { runImport, parseBreakpointsFlag } from "./importCommand";
import { runInit, type ConfigVariant } from "./init";
import {
  AGENT_TARGETS,
  listSkills,
  runSkillsInstall,
  runSkillsUpdate,
  type AgentTarget,
  type InstallScope,
} from "./skillsCommand";
import { runTokens } from "./tokensCommand";
import { runAudit } from "./auditCommand";
import { runDiff } from "./diffCommand";
import { runCreate } from "./createCommand";
import { createReportLines, promptCreateAnswers } from "./createInterview";
import { Prompter, bold, dim } from "./prompt";
import { createTheme } from "../core/createTheme";
import { createNoopAdapter } from "../core/noopAdapter";
import type { RawTheme } from "../core";
import type { WcagLevel } from "../subsystems/colors/audit";

const HELP = `refract — build a refract theme to disk.

Usage:
  refract create [--seed <color>] [--colors <n|list>] [--scheme <name>] [--manual]
                   [--feel <neutral|compact|editorial|technical>] [--ratio <name>]
                   [--base-size <px>] [--contrast <AA|AAA|none>] [--reset <name>]
                   [--format <ts|js|json>] [--out <file>] [--no-semantics]
                   [--no-neutral] [--no-shadows] [--yes] [--force]
  refract init [--js | --mjs] [--force]
  refract import <tokens.json> [--out <file>] [--raw-only] [--force]
                   [--breakpoint-group <name>] [--breakpoints <n:px,…>]
  refract build [--config <path>] [--target <name|index>] [--out <dir>]
  refract tokens [--config <path>] [--out <file>]
  refract diff <candidate> [--config <path>] [--max-class-changes <n>]
                   [--max-token-changes <n>] [--fail-below <AA|AAA|AA-large>]
  refract audit [--config <path>] [--strict] [--min-wcag <AA|AAA|AA-large>] [--large]
  refract skills <install|list|update> [--agent <a,b|all>] [--global|--local]
                   [--only <names>] [--optional]
  refract help

Commands:
  create   Design a theme.raw.(ts|js|json) from one seed colour and a short interview.
  init     Scaffold a runnable theme.config.(ts|js|mjs) in the current directory.
  import   Seed a theme.raw.ts (+ theme.config.ts) from a DTCG tokens.json (one-shot).
  build    Load the config and emit every target's files to its outDir.
  tokens   Export the theme's tokens as a DTCG tokens.json (adapter-free).
  diff     Show a candidate theme's blast radius vs the config (tokens/classes/contrast); thresholds gate CI.
  audit    Score colour pairings for WCAG-2 contrast (+ advisory APCA). Reports; --strict fails.
  skills   Install the bundled AI skills into your agent CLI(s) (claude/codex/…).
`;

/**
 * Uniform error reporter for a command's catch block. Surfaces a `RefractError`'s stable `code`
 * (`[REFRACT_E_…] message`) so an agent or CI log sees the machine-readable code, and lists each
 * collect-all `failure` — a plain `Error` just prints its message. Returns the exit code (1).
 */
function reportError(cmd: string, err: unknown): number {
  const e = err as { code?: string; message?: string; failures?: readonly string[] };
  const code = typeof e.code === "string" && e.code.startsWith("REFRACT_E_") ? `[${e.code}] ` : "";
  process.stderr.write(`refract ${cmd}: ${code}${e.message ?? String(err)}\n`);
  if (e.failures) for (const f of e.failures) process.stderr.write(`  - ${f}\n`);
  return 1;
}

async function cmdInit(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      js: { type: "boolean", default: false },
      mjs: { type: "boolean", default: false },
      force: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  if (values.js && values.mjs) {
    process.stderr.write("refract init: pass at most one of --js / --mjs.\n");
    return 1;
  }
  const variant: ConfigVariant = values.mjs ? "mjs" : values.js ? "js" : "ts";

  try {
    const result = runInit({ variant, force: Boolean(values.force) });
    if (result.rawTheme) {
      process.stdout.write(`Found ${result.rawTheme.filename} — wired it up.\n`);
    }
    process.stdout.write(`Created ${result.path}\n`);
    process.stdout.write(
      result.rawTheme
        ? `Next: run \`refract build\`.\n`
        : `Next: edit the starter theme in the config (or run \`refract create\` to design one), then \`refract build\`.\n`,
    );
    return 0;
  } catch (err) {
    return reportError("init", err);
  }
}

/**
 * `refract create` — the guided raw-theme scaffolder.
 *
 * Flags only here: the question flow lives in `createInterview.ts` so `create-refract-theme` runs
 * the identical script, and the generation lives in `scaffold.ts`. Every prompt has a flag and every
 * flag has a default, so this command is fully scriptable (`--yes`) and never blocks in CI.
 */
async function cmdCreate(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      seed: { type: "string" },
      colors: { type: "string" },
      scheme: { type: "string" },
      manual: { type: "boolean", default: false },
      feel: { type: "string" },
      ratio: { type: "string" },
      "base-size": { type: "string" },
      contrast: { type: "string" },
      reset: { type: "string" },
      format: { type: "string" },
      out: { type: "string" },
      "no-semantics": { type: "boolean", default: false },
      "no-neutral": { type: "boolean", default: false },
      "no-shadows": { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
      force: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  const p = new Prompter(values.yes ? false : undefined);
  try {
    p.write();
    p.write(`  ${bold("refract")} ${dim("· raw-theme scaffold")}`);
    p.write();

    const answers = await promptCreateAnswers(p, {
      seed: values.seed,
      colors: values.colors,
      scheme: values.scheme,
      manual: values.manual,
      feel: values.feel,
      ratio: values.ratio,
      baseSize: values["base-size"],
      contrast: values.contrast,
      reset: values.reset,
      format: values.format,
      noSemantics: values["no-semantics"],
      noNeutral: values["no-neutral"],
      noShadows: values["no-shadows"],
    });

    const result = runCreate({ ...answers, out: values.out, force: Boolean(values.force) });

    p.write();
    for (const line of createReportLines(result, countVariables(result.raw))) p.write(line);
    p.write();
    p.write(`  ${bold(result.path.split(/[\\/]/).pop() ?? "")} written`);
    p.write();
    p.write(`  ${dim("Next — wire up a build:")}  ${bold("refract init")}`);
    p.write();
    return 0;
  } catch (err) {
    return reportError("create", err);
  } finally {
    p.close();
  }
}

/** Compile the generated theme with the null adapter purely to count what it emits, for the report. */
function countVariables(raw: RawTheme): number {
  try {
    const theme = createTheme(raw, { adapter: createNoopAdapter() });
    return Object.keys(theme.tokens as Record<string, unknown>).length;
  } catch {
    return 0;
  }
}


async function cmdImport(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      out: { type: "string" },
      "raw-only": { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      "breakpoint-group": { type: "string" },
      breakpoints: { type: "string" },
    },
    allowPositionals: true,
  });

  const input = positionals[0];
  if (!input) {
    process.stderr.write("refract import: pass the DTCG document to import, e.g. `refract import tokens.json`.\n");
    return 1;
  }
  if (positionals.length > 1) {
    process.stderr.write(`refract import: unexpected extra argument "${positionals[1]}".\n`);
    return 1;
  }

  try {
    const result = runImport({
      input,
      out: values.out,
      rawOnly: Boolean(values["raw-only"]),
      force: Boolean(values.force),
      breakpointGroup: values["breakpoint-group"],
      breakpoints: values.breakpoints ? parseBreakpointsFlag(values.breakpoints) : undefined,
    });
    process.stdout.write(`Imported ${result.inputFile}\n`);
    process.stdout.write(`  raw    → ${result.rawFile}\n`);
    if (result.configFile) process.stdout.write(`  config → ${result.configFile}\n`);
    const seeded = Object.entries(result.counts).map(([k, n]) => `${k} (${n})`).join(", ");
    if (seeded) process.stdout.write(`  seeded: ${seeded}\n`);
    process.stdout.write(`Next: review the inferred tokens, then add recipes/components and run \`refract build\`.\n`);
    return 0;
  } catch (err) {
    return reportError("import", err);
  }
}

async function cmdBuild(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      config: { type: "string" },
      target: { type: "string" },
      out: { type: "string" },
    },
    allowPositionals: false,
  });

  try {
    const result = await runBuild({
      configPath: values.config,
      target: values.target,
      out: values.out,
    });
    process.stdout.write(`Built from ${result.configPath}\n`);
    for (const t of result.targets) {
      const label = t.name ? `${t.name} [${t.adapter}]` : t.adapter;
      process.stdout.write(`  ${label} → ${t.outDir} (${t.files.length} file(s))\n`);
      for (const f of t.files) process.stdout.write(`      ${f}\n`);
    }
    return 0;
  } catch (err) {
    return reportError("build", err);
  }
}

async function cmdTokens(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      config: { type: "string" },
      out: { type: "string" },
    },
    allowPositionals: false,
  });

  try {
    const result = await runTokens({
      configPath: values.config,
      out: values.out,
    });
    process.stdout.write(`Exported tokens from ${result.configPath}\n`);
    process.stdout.write(`  ${result.groupCount} group(s) → ${result.outFile}\n`);
    return 0;
  } catch (err) {
    return reportError("tokens", err);
  }
}

const WCAG_LEVELS: ReadonlySet<string> = new Set(["AAA", "AA", "AA-large"]);

async function cmdDiff(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      config: { type: "string" },
      "max-class-changes": { type: "string" },
      "max-token-changes": { type: "string" },
      "fail-below": { type: "string" },
    },
    allowPositionals: true,
  });

  const candidate = positionals[0];
  if (!candidate) {
    process.stderr.write("refract diff: pass the candidate theme, e.g. `refract diff candidate.ts`.\n");
    return 1;
  }
  const failBelow = values["fail-below"];
  if (failBelow !== undefined && !WCAG_LEVELS.has(failBelow)) {
    process.stderr.write(`refract diff: --fail-below must be one of AAA | AA | AA-large (got "${failBelow}").\n`);
    return 1;
  }

  try {
    const result = await runDiff({
      configPath: values.config,
      candidatePath: candidate,
      maxClassChanges: values["max-class-changes"] !== undefined ? Number(values["max-class-changes"]) : undefined,
      maxTokenChanges: values["max-token-changes"] !== undefined ? Number(values["max-token-changes"]) : undefined,
      failBelow,
    });
    const { diff } = result;
    process.stdout.write(`Diffed ${result.candidatePath}\n  vs ${result.configPath}\n`);
    process.stdout.write(
      `  ${diff.summary.tokensChanged} token(s), ${diff.summary.classesChanged} class(es), ${diff.summary.pairingsCrossed} pairing(s) crossed a threshold\n`,
    );
    for (const t of diff.tokens.slice(0, 20)) {
      const arrow = t.kind === "changed" ? `${t.before} → ${t.after}` : t.kind === "added" ? `+ ${t.after}` : `- ${t.before}`;
      process.stdout.write(`    token ${t.path}: ${arrow}\n`);
    }
    if (diff.tokens.length > 20) process.stdout.write(`    … +${diff.tokens.length - 20} more token(s)\n`);
    for (const c of diff.classes) process.stdout.write(`    class ${c.kind.padEnd(7)} ${c.name}\n`);
    for (const c of diff.contrast.filter((x) => x.crossed)) {
      process.stdout.write(`    contrast ${c.label}: ${c.before?.level ?? "—"} → ${c.after?.level ?? "—"}\n`);
    }
    if (result.violations.length) {
      process.stderr.write(`✗ diff gate failed:\n`);
      for (const v of result.violations) process.stderr.write(`    ${v}\n`);
      return 1;
    }
    return 0;
  } catch (err) {
    return reportError("diff", err);
  }
}

async function cmdAudit(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      config: { type: "string" },
      strict: { type: "boolean", default: false },
      "min-wcag": { type: "string" },
      large: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  const minWcag = values["min-wcag"];
  if (minWcag !== undefined && !WCAG_LEVELS.has(minWcag)) {
    process.stderr.write(`refract audit: --min-wcag must be one of AAA | AA | AA-large (got "${minWcag}").\n`);
    return 1;
  }

  try {
    const { configPath, result } = await runAudit({
      configPath: values.config,
      strict: values.strict,
      minWcag: minWcag as WcagLevel | undefined,
      largeText: values.large,
    });
    process.stdout.write(`Audited ${configPath}\n`);
    for (const p of result.pairings) {
      if (p.skipped) {
        process.stdout.write(`  ~ ${p.label} — skipped (${p.skipped})\n`);
      } else {
        const flag = p.pass ? "✓" : "✗";
        process.stdout.write(`  ${flag} ${p.label} — ${p.wcagRatio}:1 ${p.wcagLevel} · APCA Lc ${p.apcaLc}\n`);
      }
    }
    const s = result.summary;
    process.stdout.write(`${s.passed}/${s.total} pass, ${s.failed} fail, ${s.skipped} skipped\n`);
    // Report mode: a failing audit is not a CLI error (exit 0). --strict makes `runAudit` throw first.
    return 0;
  } catch (err) {
    return reportError("audit", err);
  }
}

/** Parse an `--agent` value (`"all"` or a comma list) into validated targets. */
function parseAgents(raw: string): AgentTarget[] {
  if (raw.trim() === "all") return [...AGENT_TARGETS];
  const names = raw.split(",").map(s => s.trim()).filter(Boolean);
  const bad = names.filter(n => !AGENT_TARGETS.includes(n as AgentTarget));
  if (bad.length > 0) {
    throw new Error(
      `unknown agent(s) ${bad.map(b => `"${b}"`).join(", ")}. Known: ${AGENT_TARGETS.join(", ")}.`,
    );
  }
  return names as AgentTarget[];
}

/** Interactively gather install options when none were passed and a TTY is attached. */
async function promptSkillsInstall(): Promise<{
  agents: AgentTarget[];
  scope: InstallScope;
  includeOptional: boolean;
}> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    process.stdout.write("Install refract skills for which agent(s)?\n");
    AGENT_TARGETS.forEach((a, i) => process.stdout.write(`  ${i + 1}) ${a}\n`));
    const pick = await rl.question("Enter numbers (comma-separated), or 'all': ");
    const agents =
      pick.trim() === "all" || pick.trim() === ""
        ? [...AGENT_TARGETS]
        : pick
            .split(",")
            .map(s => AGENT_TARGETS[Number(s.trim()) - 1])
            .filter((a): a is AgentTarget => Boolean(a));
    if (agents.length === 0) throw new Error("no agents selected.");

    const scopeAns = (await rl.question("Scope — [l]ocal (project) or [g]lobal (home)? [l]: "))
      .trim()
      .toLowerCase();
    const scope: InstallScope = scopeAns.startsWith("g") ? "global" : "local";

    const optAns = (await rl.question("Include optional skills (adapter-scaffold, troubleshooting)? [y/N]: "))
      .trim()
      .toLowerCase();
    return { agents, scope, includeOptional: optAns.startsWith("y") };
  } finally {
    rl.close();
  }
}

async function cmdSkills(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv;

  if (sub === "list") {
    try {
      for (const s of listSkills()) {
        process.stdout.write(`  ${s.name.padEnd(26)} [${s.tier}]  ${s.description.split(/\s*Triggers:/)[0].trim().slice(0, 80)}\n`);
      }
      return 0;
    } catch (err) {
      return reportError("skills list", err);
    }
  }

  const { values } = parseArgs({
    args: rest,
    options: {
      agent: { type: "string" },
      global: { type: "boolean", default: false },
      local: { type: "boolean", default: false },
      only: { type: "string" },
      optional: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  if (values.global && values.local) {
    process.stderr.write("refract skills: pass at most one of --global / --local.\n");
    return 1;
  }
  const scope: InstallScope = values.global ? "global" : "local";

  try {
    if (sub === "update") {
      const result = runSkillsUpdate({ scope });
      process.stdout.write(`Updated ${result.skills.length} skill(s) for ${result.agents.join(", ")} (${result.scope}).\n`);
      return 0;
    }

    if (sub === "install" || sub === undefined) {
      let agents: AgentTarget[];
      let includeOptional = Boolean(values.optional);
      let installScope = scope;

      if (values.agent) {
        agents = parseAgents(values.agent);
      } else if (process.stdin.isTTY) {
        const answers = await promptSkillsInstall();
        agents = answers.agents;
        includeOptional = answers.includeOptional;
        if (!values.global && !values.local) installScope = answers.scope;
      } else {
        process.stderr.write("refract skills install: pass --agent <a,b|all> (no TTY for prompts).\n");
        return 1;
      }

      const result = runSkillsInstall({
        agents,
        scope: installScope,
        skills: values.only ? values.only.split(",").map(s => s.trim()).filter(Boolean) : undefined,
        includeOptional,
      });
      process.stdout.write(
        `Installed ${result.skills.length} skill(s) for ${result.agents.join(", ")} (${result.scope}):\n`,
      );
      for (const f of result.files) process.stdout.write(`  ${f}\n`);
      process.stdout.write(`  manifest → ${result.manifestPath}\n`);
      return 0;
    }

    process.stderr.write(`refract skills: unknown subcommand "${sub}". Use install | list | update.\n`);
    return 1;
  } catch (err) {
    return reportError("skills", err);
  }
}

/** Dispatch a parsed argv (without the node/script prefix). Returns a process exit code. */
export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case "create":
      return cmdCreate(rest);
    case "init":
      return cmdInit(rest);
    case "import":
      return cmdImport(rest);
    case "build":
      return cmdBuild(rest);
    case "tokens":
      return cmdTokens(rest);
    case "diff":
      return cmdDiff(rest);
    case "audit":
      return cmdAudit(rest);
    case "skills":
      return cmdSkills(rest);
    case undefined:
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(HELP);
      return 0;
    default:
      process.stderr.write(`refract: unknown command "${command}".\n\n${HELP}`);
      return 1;
  }
}

// Executed as the `bin` entry: run and map the exit code. Guarded so importing this module (tests)
// doesn't trigger a run. `require.main === module` is the CJS "am I the entry" check; the CLI bundle
// ships as CJS (see rollup.config.mjs), where `require`/`module` are the real CommonJS globals.
if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  main(process.argv.slice(2)).then(
    code => process.exit(code),
    err => {
      process.stderr.write(`refract: ${(err as Error).stack ?? err}\n`);
      process.exit(1);
    },
  );
}
