/**
 * refract MCP server — a Model Context Protocol server over stdio, on the official
 * `@modelcontextprotocol/sdk`. It is **project-scoped**: it loads the project's
 * `theme.config.(ts|js|mjs)` once at startup (auto-discovered in the cwd, or via `--config <path>`),
 * holds the built theme, and serves the query tools against it — so an agent asks about *this project's*
 * theme without ever resending it. It watches the config and reloads on change.
 *
 * The tool logic lives in the pure `tools.ts`; `callTool` here is the transport-agnostic dispatch core
 * (unit-testable) — the SDK handler is a thin wrapper over it.
 */
import { watch, readFileSync, realpathSync } from "node:fs";
import { dirname, basename } from "node:path";
import { parseArgs } from "node:util";
import { argv } from "node:process";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { RawTheme, Theme, ThemeAdapter, UsageDescriptor } from "@theme-registry/refract";
import { createTheme, createNoopAdapter } from "@theme-registry/refract";
import { toDTCG } from "@theme-registry/refract/dtcg";
import { loadConfig, diffThemes, buildGuide, type ThemeConfig, type ThemeDiff } from "@theme-registry/refract/build";
import * as tools from "./tools";
import type { Builder, NamedTheme } from "./tools";

/** Read this package's version from its package.json (single source of truth for the handshake). */
export function serverVersion(): string {
  try {
    return (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** The manifest schema version this server speaks (matches `refract build --guide`). Echoed in the handshake. */
const GUIDE_SCHEMA = 1;
const RESOURCE_URIS = { llms: "refract://llms.txt", manifest: "refract://manifest.json" } as const;

type Json = Record<string, unknown>;

/** The build options a target inherits from the config, so a candidate validates exactly as it would emit. */
type BuildOpts = Pick<ThemeConfig, "units" | "baseFontSize" | "media">;

/** One configured target, built with its real adapter. */
export interface TargetBuild {
  name: string;
  adapter: ThemeAdapter;
  theme: Theme;
}

/**
 * The loaded project the server holds and serves against. `targets` are built with the project's REAL
 * adapters (so `getClass`/`validateTheme` are honest); `base` answers adapter-independent token/model
 * queries (any target's theme — or a noop build when the config declares no targets).
 */
export interface Held {
  targets: TargetBuild[];
  base: Theme;
  raw: RawTheme;
  path: string;
  buildOpts: BuildOpts;
}

// --- held state ---
let held: Held | null = null;
let configPathArg: string | undefined;

/** Load (or reload) the project's theme config and build it once per target. Throws if it can't be resolved/built. */
export async function loadTheme(configPath?: string): Promise<Held> {
  const { config, path } = await loadConfig({ configPath });
  // Match what `refract build` emits, so resolved values/classes are the project's real ones.
  const buildOpts: BuildOpts = { units: config.units, baseFontSize: config.baseFontSize, media: config.media };
  const targets: TargetBuild[] = config.targets.map((t, i) => ({
    name: t.name ?? t.outDir ?? `target-${i}`,
    adapter: t.adapter,
    theme: createTheme(config.raw, { adapter: t.adapter, ...buildOpts }),
  }));
  // A config with no targets still answers token/model queries; build a noop base for them.
  const base = targets[0]?.theme ?? createTheme(config.raw, { adapter: createNoopAdapter(), ...buildOpts });
  return { targets, base, raw: config.raw, path, buildOpts };
}

/** The set of real-adapter themes `getClass` reads class names from. */
const namedThemes = (state: Held): NamedTheme[] => state.targets.map((t) => ({ name: t.name, theme: t.theme }));

/**
 * Builders that re-compile a candidate against each configured target's real adapter (with the project's
 * build options), so `validateTheme` sees the same throws `refract build` would. When no targets are
 * configured, fall back to a single `core` builder (noop adapter) — core-level checks only, honestly
 * labelled — rather than claiming a target validated it.
 */
function buildersFor(state: Held | null): Builder[] {
  const opts = state?.buildOpts ?? {};
  const list: Builder[] = (state?.targets ?? []).map((t) => ({
    name: t.name,
    build: (raw: RawTheme) => void createTheme(raw, { adapter: t.adapter, ...opts }),
  }));
  if (list.length === 0) {
    list.push({ name: "core", build: (raw: RawTheme) => void createTheme(raw, { adapter: createNoopAdapter(), ...opts }) });
  }
  return list;
}

const EMPTY_DIFF: ThemeDiff = { tokens: [], classes: [], contrast: [], summary: { tokensChanged: 0, classesChanged: 0, pairingsCrossed: 0 } };

/**
 * The `diffTheme` guardrail: build a candidate against the project's real adapters and report the blast
 * radius vs the loaded theme — which tokens moved, which classes changed, which pairings crossed a
 * threshold, and whether every target still builds. The diff runs through a class-emitting target (so
 * `classes` is populated); if the candidate doesn't build there, the diff is empty and `targets` carries
 * the failure. Plan-then-apply, before the agent writes.
 */
function diffHeld(state: Held, candidateRaw: RawTheme): { ok: boolean; diff: ThemeDiff; targets: tools.ValidateResult["perTarget"] } {
  const validation = tools.validateTheme(candidateRaw, buildersFor(state));
  const pick =
    state.targets.find((t) => typeof (t.theme as { renderRecipe?: unknown }).renderRecipe === "function") ?? state.targets[0];
  const baseTheme = pick?.theme ?? state.base;
  let diff = EMPTY_DIFF;
  try {
    diff = diffThemes(baseTheme, createTheme(candidateRaw, { adapter: pick?.adapter ?? createNoopAdapter(), ...state.buildOpts }));
  } catch {
    /* candidate doesn't build — reported via `targets` */
  }
  return { ok: validation.ok, diff, targets: validation.perTarget };
}

// Dirs never worth reloading on (vendored deps, build output). Skipped under the recursive watch.
const WATCH_IGNORE = /(^|[/\\])(node_modules|dist|out|coverage)([/\\]|$)/;
// Source files a theme graph is authored in — a change to any of them may change the built theme.
const WATCH_SOURCE = /\.(ts|mjs|cjs|js|json)$/;
/**
 * Any hidden path segment. A theme graph is never authored in one, and this is the rule that keeps the
 * server from waking on its own output: loading a `.ts` config graph-compiles it to hidden
 * `.<base>.<pid>-<n>.mjs` files emitted **beside each compiled source** (adjacency is load-bearing —
 * it's what keeps relative sibling specifiers resolvable), which are imported and then unlinked. Those
 * writes and deletes match {@link WATCH_SOURCE}, so without this a load wakes the watcher, which
 * reloads, which emits them again — an endless self-triggered loop with no user edit involved, churning
 * the config's directory (visible in an editor as a file tree that never stops refreshing). Also covers
 * `.git`, `.next`, `.turbo`, `.cache` and friends, whose build churn caused spurious reloads too.
 */
const WATCH_HIDDEN = /(^|[/\\])\./;

/** Is this watch event worth rebuilding the theme for? Pure, so the loop guard above is unit-testable. */
export function shouldReload(filename: string): boolean {
  return WATCH_SOURCE.test(filename) && !WATCH_HIDDEN.test(filename) && !WATCH_IGNORE.test(filename);
}

/**
 * Watch the config's directory **recursively** and rebuild on any source-file change — so a theme split
 * across `./tokens/*.ts` (imported transitively by the config) reloads, not just an edit to the config
 * file itself (MCP-6). Debounced; keeps the previous theme on a failed reload. Recursive `fs.watch` is
 * supported on macOS/Windows and modern Linux — falls back to a flat watch where it isn't.
 */
function watchConfig(): void {
  if (!held) return;
  let timer: NodeJS.Timeout | undefined;
  // Second line of defence behind {@link WATCH_HIDDEN}: never overlap two loads, so anything a load
  // writes can't start another one. Edits landing mid-load aren't lost — they re-arm the debounce once.
  let reloading = false;
  let pending = false;
  const reload = (): void => {
    if (reloading) {
      pending = true;
      return;
    }
    reloading = true;
    loadTheme(configPathArg)
      .then((next) => {
        held = next;
        process.stderr.write(`refract-mcp: reloaded theme from ${next.path}\n`);
      })
      .catch((e) => process.stderr.write(`refract-mcp: reload failed (kept previous theme): ${(e as Error).message}\n`))
      .finally(() => {
        reloading = false;
        if (pending) {
          pending = false;
          schedule();
        }
      });
  };
  const schedule = (): void => {
    clearTimeout(timer);
    timer = setTimeout(reload, 150);
  };
  const onChange = (_event: string, filename: string | Buffer | null): void => {
    if (!filename) return;
    if (!shouldReload(filename.toString())) return;
    schedule();
  };
  try {
    const dir = dirname(held.path);
    let watcher;
    try {
      watcher = watch(dir, { recursive: true }, onChange);
    } catch {
      // Platform without recursive support — fall back to a flat watch of the config dir.
      watcher = watch(dir, onChange);
    }
    // Don't let the watcher keep the process alive: when the client closes stdin, the server should exit.
    watcher.unref();
  } catch {
    /* watching is best-effort — a missing dir or platform quirk shouldn't crash the server */
  }
}

/**
 * Render the project's self-documenting guide (`llms.txt` + `manifest.json`) IN MEMORY from the SAME
 * real names the tools return (via `getClass`) + the DTCG token export — so the MCP's resources, the
 * emitted `--guide` files, and the query tools are one source of truth (MCP-5 coherence). The manifest
 * carries `schema: {@link GUIDE_SCHEMA}`.
 */
export function guideFiles(state: Held): Record<string, string> {
  const named = namedThemes(state);
  const recipes = tools.listRecipes(state.base).flatMap((id) => {
    try {
      return [{ ...id, name: tools.getClass(named, id).className }];
    } catch {
      return []; // a target that mints no class name for this recipe
    }
  });
  const descriptor: UsageDescriptor = {
    format: "css",
    summary: [
      "Apply the recipe class names below to your elements (import the emitted stylesheet once).",
      "Token values are CSS custom properties (var(--…)) — runtime theming = override the variables under a selector or [data-theme].",
      "These names are the live compiled theme's — the same ones the MCP getClass / resolveToken tools return.",
    ],
    recipes,
  };
  return buildGuide(descriptor, toDTCG(state.base), { files: [] }).files;
}

// --- tool definitions (schemas carry NO `theme` — it's project-scoped) ---
const TOOL_DEFS = [
  { name: "resolveToken", description: "Resolve a token path (e.g. colors.brand.dark) to its value + its emitted CSS variable name (varName), unit, and derivedFrom (what it derives from) in the loaded theme.",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
  { name: "listTokens", description: "List every token path in the loaded theme.",
    inputSchema: { type: "object", properties: {}, required: [] } },
  { name: "findToken", description: "List token paths that start with a prefix (discover names).",
    inputSchema: { type: "object", properties: { prefix: { type: "string" } }, required: ["prefix"] } },
  { name: "searchTokens", description: "Find token paths matching a query on the path OR the resolved value (fuzzy, case-insensitive).",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "listRecipes", description: "List every recipe as { subsystem, group, variant }.",
    inputSchema: { type: "object", properties: {}, required: [] } },
  { name: "getClass", description: "Get the real class + composed class-list for a recipe (from the project's class-emitting adapter, e.g. CSS — carries its configured prefix).",
    inputSchema: { type: "object", properties: { subsystem: { type: "string" }, group: { type: "string" }, variant: { type: "string" } }, required: ["subsystem", "group", "variant"] } },
  { name: "renderRecipe", description: "The exact CSS one recipe emits (base + its state/breakpoint rules), from the project's class-emitting adapter.",
    inputSchema: { type: "object", properties: { subsystem: { type: "string" }, group: { type: "string" }, variant: { type: "string" } }, required: ["subsystem", "group", "variant"] } },
  { name: "checkContrast", description: "WCAG-2 contrast audit of the loaded theme's colour pairings (+ advisory APCA). Optional minWcag pass bar (AA|AAA|AA-large).",
    inputSchema: { type: "object", properties: { minWcag: { type: "string", description: "pass bar: AA (default) | AAA | AA-large" } }, required: [] } },
  { name: "validateTheme", description: "Validate a candidate raw theme (or the loaded theme) against every configured target adapter — returns ALL problems per target at once.",
    inputSchema: { type: "object", properties: { theme: { type: "object", description: "a candidate raw theme; omit to validate the loaded one" } }, required: [] } },
  { name: "diffTheme", description: "Diff a candidate raw theme against the loaded one — which tokens moved, which classes changed, which contrast pairings crossed a threshold, and whether every target still builds. Plan-then-apply: see the blast radius before you write.",
    inputSchema: { type: "object", properties: { theme: { type: "object", description: "the candidate raw theme to compare against the loaded one" } }, required: ["theme"] } },
  { name: "reload", description: "Reload the project's theme config from disk.",
    inputSchema: { type: "object", properties: {}, required: [] } },
];

/**
 * Transport-agnostic tool dispatch — pure over the passed `state`. Query tools need a loaded theme;
 * `validateTheme` works on a candidate even without one. `reload` is handled by the server (it mutates
 * state + does I/O), not here.
 */
export function callTool(name: string, args: Json, state: Held | null): unknown {
  const loaded = (): Held => {
    if (!state) throw new Error("no theme loaded — launch refract-mcp in a project with a theme.config.(ts|js|mjs), or pass --config <path>");
    return state;
  };
  switch (name) {
    case "resolveToken":
      return tools.resolveToken(loaded().base, args.path as string, namedThemes(loaded()));
    case "listTokens":
      return tools.listTokens(loaded().base);
    case "findToken":
      return tools.findToken(loaded().base, args.prefix as string);
    case "searchTokens":
      return tools.searchTokens(loaded().base, args.query as string);
    case "listRecipes":
      return tools.listRecipes(loaded().base);
    case "getClass":
      return tools.getClass(namedThemes(loaded()), { subsystem: args.subsystem as string, group: args.group as string, variant: args.variant as string });
    case "renderRecipe":
      return tools.renderRecipe(namedThemes(loaded()), { subsystem: args.subsystem as string, group: args.group as string, variant: args.variant as string });
    case "checkContrast":
      return tools.checkContrast(loaded().base, args.minWcag as string | undefined);
    case "validateTheme": {
      // A candidate wins; else the loaded theme. With neither, there is nothing to validate — say so
      // rather than green-lighting `{}` (which builds cleanly and would teach the agent to trust it).
      const candidate = (args.theme as RawTheme | undefined) ?? state?.raw;
      if (candidate === undefined) {
        throw new Error("nothing to validate — pass a candidate `theme`, or launch refract-mcp in a project with a theme.config.(ts|js|mjs)");
      }
      return tools.validateTheme(candidate, buildersFor(state));
    }
    case "diffTheme": {
      // A diff needs a base to compare against — the loaded project theme.
      const candidate = (args.theme as RawTheme | undefined) ?? state?.raw;
      if (candidate === undefined) {
        throw new Error("nothing to diff — pass a candidate `theme`, or launch refract-mcp in a project with a theme.config.(ts|js|mjs)");
      }
      return diffHeld(loaded(), candidate);
    }
    default:
      throw new Error(`unknown tool "${name}"`);
  }
}

/** Run a tool call, handling the async `reload` at the server layer and delegating the rest to `callTool`. */
async function runToolCall(name: string, args: Json): Promise<unknown> {
  if (name === "reload") {
    held = await loadTheme(configPathArg);
    return { reloaded: true, path: held.path };
  }
  return callTool(name, args, held);
}

/** Build the MCP server — tools + the self-documenting `llms.txt` / `manifest.json` resources. */
export function createServer(): Server {
  const server = new Server(
    { name: "refract-mcp", version: serverVersion() },
    {
      capabilities: { tools: {}, resources: { listChanged: true } },
      // The handshake advertises the guide schema this server speaks, so an agent can reconcile the
      // MCP resources, the emitted `--guide` files, and the installed skills against one version.
      instructions: `refract-mcp serves the project's compiled theme as tools + resources (guide schema ${GUIDE_SCHEMA}). Read the "refract://manifest.json" resource for the machine index (schema ${GUIDE_SCHEMA}, real class names + token paths) and "refract://llms.txt" for prose. Use diffTheme to see a candidate edit's blast radius before writing.`,
    },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFS }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await runToolCall(name, (args as Json) ?? {});
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (e) {
      return { content: [{ type: "text", text: (e as Error).message }], isError: true };
    }
  });

  // Resources: the same guide `refract build --guide` emits, rendered live from the loaded theme.
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      { uri: RESOURCE_URIS.llms, name: "llms.txt", description: "Prose guide to consuming this theme (real class names).", mimeType: "text/plain" },
      { uri: RESOURCE_URIS.manifest, name: "manifest.json", description: `Machine index of the theme (schema ${GUIDE_SCHEMA}): class names + DTCG tokens.`, mimeType: "application/json" },
    ],
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    if (!held) throw new Error("no theme loaded — launch refract-mcp in a project with a theme.config.(ts|js|mjs), or pass --config <path>");
    const files = guideFiles(held);
    if (uri === RESOURCE_URIS.llms) return { contents: [{ uri, mimeType: "text/plain", text: files["llms.txt"] ?? "" }] };
    if (uri === RESOURCE_URIS.manifest) return { contents: [{ uri, mimeType: "application/json", text: files["manifest.json"] ?? "" }] };
    throw new Error(`unknown resource "${uri}"`);
  });
  return server;
}

/** Entry: resolve the config, load the theme (best-effort), start watching, then serve over stdio. */
export async function start(args: string[]): Promise<void> {
  const { values } = parseArgs({ args, options: { config: { type: "string" } }, allowPositionals: true });
  configPathArg = values.config;
  try {
    held = await loadTheme(configPathArg);
    process.stderr.write(`refract-mcp: serving theme from ${held.path}\n`);
    watchConfig();
  } catch (e) {
    process.stderr.write(`refract-mcp: no theme loaded (${(e as Error).message}). Query tools will report it; validateTheme still works on a candidate.\n`);
  }
  const transport = new StdioServerTransport();
  // When the client closes the pipe (session over), shut down — fs.watch would otherwise keep the
  // event loop alive and orphan the process.
  transport.onclose = () => process.exit(0);
  await createServer().connect(transport);
}

const realpathOr = (p: string): string => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

/**
 * Is the launched script (`argv[1]`) this very module, resolving symlinks on BOTH sides? The published
 * bin runs through a `node_modules/.bin/refract-mcp` symlink, so a raw path/URL compare misses (the
 * symlink path ≠ the real dist path) and the server silently exits 0 — a hostile failure mode for
 * something agents auto-spawn. Resolving through realpath fixes it. Pure + injectable `real` so the
 * decision is unit-testable without spawning a process.
 */
export function isBinEntry(invokedAs: string | undefined, selfPath: string, real: (p: string) => string = realpathOr): boolean {
  return invokedAs !== undefined && real(invokedAs) === real(selfPath);
}

// Auto-start only when invoked as the bin entry. If the launched file IS this file by name but its path
// won't resolve to this module, say so loudly instead of no-op. A genuine module import (argv[1] is the
// test runner, a different basename) stays silent.
{
  const invokedAs = argv[1];
  const selfPath = fileURLToPath(import.meta.url);
  if (isBinEntry(invokedAs, selfPath)) {
    start(argv.slice(2)).catch((e) => {
      process.stderr.write(`refract-mcp: failed to start — ${(e as Error).message}\n`);
      process.exit(1);
    });
  } else if (invokedAs && basename(invokedAs) === basename(selfPath)) {
    process.stderr.write(
      `refract-mcp: launched as "${invokedAs}" but that path doesn't resolve to this module (${selfPath}); ` +
        `not auto-starting. Use the \`refract-mcp\` bin or \`node ${selfPath}\`.\n`,
    );
  }
}
