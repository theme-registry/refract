/**
 * Scaffold a theme package to disk — pure of prompting, so the whole thing is testable in a tmpdir.
 *
 * It writes no generator of its own: `runCreate` designs the theme and `rawThemeImport` decides how a
 * config reaches it, both from `@theme-registry/refract/build`. This module only owns the *project* —
 * the package.json, the tsconfig, the readme, and the directory they land in.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { runCreate, rawThemeImport, type CreateResult, type InterviewAnswers } from "@theme-registry/refract/build";
import {
  ADAPTERS,
  gitignore,
  packageJson,
  readme,
  themeConfig,
  tsconfig,
  type AdapterChoice,
  type ProjectSpec,
} from "./templates";

export interface ScaffoldProjectOptions {
  /** Package name — also the directory name unless `directory` is given. */
  readonly name: string;
  /** Where to create the project (default: `<cwd>/<name>`). */
  readonly directory?: string;
  /** Adapters to wire. Defaults to CSS alone. */
  readonly adapters?: readonly AdapterChoice["id"][];
  /** The theme interview's answers, passed straight through to `runCreate`. */
  readonly answers: InterviewAnswers;
  /** Create into a non-empty directory instead of refusing (default `false`). */
  readonly force?: boolean;
  /** Override the refract version range written into `package.json` (default: the installed one). */
  readonly refractRange?: string;
}

export interface ScaffoldProjectResult {
  readonly directory: string;
  /** Files written, relative to `directory`, in creation order. */
  readonly files: readonly string[];
  /** The theme generation result — carries the contrast report the CLI prints. */
  readonly create: CreateResult;
  readonly adapters: readonly AdapterChoice[];
  readonly refractRange: string;
}

/**
 * Identify the copy of refract this initializer will generate with.
 *
 * The version pins the scaffolded project, so it can never depend on a refract whose generator it
 * didn't actually run. The name is needed for a subtler reason: `runCreate` otherwise discovers it
 * via refract's `readOwnPackageName()`, which walks up from `__dirname` — undefined in ESM, so that
 * path throws for any ESM consumer of the `./build` subpath. Resolving it here sidesteps that.
 */
export function resolveRefractPackage(from: string = import.meta.url): { name: string; range: string } {
  try {
    const require = createRequire(from);
    const pkgPath = require.resolve("@theme-registry/refract/package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string; version?: string };
    return {
      name: pkg.name ?? "@theme-registry/refract",
      range: pkg.version ? `^${pkg.version}` : "latest",
    };
  } catch {
    return { name: "@theme-registry/refract", range: "latest" };
  }
}

/** A directory is safe to scaffold into when it's absent, or present but empty of anything but VCS noise. */
export function isDirectoryUsable(dir: string): boolean {
  if (!existsSync(dir)) return true;
  const entries = readdirSync(dir).filter(e => e !== ".git" && e !== ".DS_Store");
  return entries.length === 0;
}

/**
 * Create the project. Order matters only in that the theme is generated before the config, because
 * the config's import line depends on which format the theme landed in.
 */
export function scaffoldProject(options: ScaffoldProjectOptions): ScaffoldProjectResult {
  const directory = resolve(options.directory ?? join(process.cwd(), options.name));

  if (!options.force && !isDirectoryUsable(directory)) {
    throw new Error(
      `"${directory}" already exists and isn't empty. Pick another name, or pass --force to scaffold into it anyway.`,
    );
  }
  mkdirSync(directory, { recursive: true });

  const chosen = (options.adapters?.length ? options.adapters : ["css"])
    .map(id => ADAPTERS.find(a => a.id === id))
    .filter((a): a is AdapterChoice => Boolean(a));

  const refract = resolveRefractPackage();
  const refractRange = options.refractRange ?? refract.range;

  // The theme first — `runCreate` owns generation, contrast and serialization.
  const create = runCreate({
    ...options.answers,
    cwd: directory,
    force: true,
    packageName: refract.name,
  });
  const rawFilename = create.path.split(/[\\/]/).pop() as string;
  const spec: ProjectSpec = { name: options.name, adapters: chosen, refractRange, rawFilename };

  const rawImport = rawThemeImport({
    path: create.path,
    filename: rawFilename,
    ext: `.${create.format}`,
  });

  const files: Array<[string, string]> = [
    ["package.json", packageJson(spec)],
    ["theme.config.ts", themeConfig(spec, rawImport)],
    ["tsconfig.json", tsconfig()],
    [".gitignore", gitignore()],
    ["README.md", readme(spec)],
  ];
  for (const [name, body] of files) writeFileSync(join(directory, name), body, "utf8");

  return {
    directory,
    files: [rawFilename, ...files.map(([name]) => name)],
    create,
    adapters: chosen,
    refractRange,
  };
}
