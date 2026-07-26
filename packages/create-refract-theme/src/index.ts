/**
 * `npm create refract-theme` — scaffold a publishable design-system package.
 *
 * The interview is refract's own (`promptCreateAnswers`), so the questions here are identical to
 * `refract create`'s and can't drift from them; this binary adds only the project questions — what to
 * call it, and which formats to emit — plus the files that make the result publishable.
 */
import { parseArgs } from "node:util";
import { Prompter, bold, dim, green, promptCreateAnswers, createReportLines } from "@theme-registry/refract/build";
import { createTheme, createNoopAdapter } from "@theme-registry/refract";
import { scaffoldProject, isDirectoryUsable } from "./scaffoldProject";
import { ADAPTERS, type AdapterChoice } from "./templates";

/** npm-safe package name: optional scope, lowercase, no leading dot/underscore. */
const NAME_PATTERN = /^(?:@[a-z0-9-*~][a-z0-9-*._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

const HELP = `create-refract-theme — scaffold a design-system package powered by refract.

Usage:
  npm create refract-theme [name] -- [options]

Options:
  --name <name>          Package name (also the directory).
  --dir <path>           Where to create it (default: ./<name>).
  --adapters <a,b>       css · styled-components · scss · json (default: css).
  --seed <color>         Primary colour (default: #4c6ef5).
  --colors <n|list>      Brand colour count, or a comma list with --manual.
  --scheme <name>        Harmony scheme when more than one fits the count.
  --manual               Enter each brand colour instead of deriving them.
  --feel <name>          neutral · compact · editorial · technical.
  --ratio <name>         Type scale, e.g. major-third.
  --base-size <px>       Base font size (default: 16).
  --contrast <bar>       AA · AAA · none (default: AA).
  --reset <name>         preflight · normalize · none.
  --format <fmt>         ts · js · json (default: ts).
  --no-semantics         Skip success/info/warning/danger.
  --no-neutral           Skip the neutral ramp.
  --no-shadows           Skip shadow tints and the effects ramp.
  -y, --yes              Take every default; ask nothing.
  --force                Scaffold into a non-empty directory.
  -h, --help             Show this.
`;

export async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      name: { type: "string" },
      dir: { type: "string" },
      adapters: { type: "string" },
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
      "no-semantics": { type: "boolean", default: false },
      "no-neutral": { type: "boolean", default: false },
      "no-shadows": { type: "boolean", default: false },
      yes: { type: "boolean", short: "y", default: false },
      force: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    process.stdout.write(HELP);
    return 0;
  }

  const p = new Prompter(values.yes ? false : undefined);
  try {
    p.write();
    p.write(`  ${bold("refract")} ${dim("· new theme package")}`);
    p.write();

    const name = values.name ?? positionals[0] ?? await p.text("Package name", "my-theme", v =>
      NAME_PATTERN.test(v) ? undefined : `"${v}" isn't a valid npm package name.`);
    if (!NAME_PATTERN.test(name)) {
      process.stderr.write(`create-refract-theme: "${name}" isn't a valid npm package name.\n`);
      return 1;
    }

    const adapters = values.adapters
      ? values.adapters.split(",").map(s => s.trim()).filter(Boolean)
      : (await p.multiselect<AdapterChoice["id"]>(
          "Output formats",
          ADAPTERS.map(a => ({ value: a.id, label: a.label, hint: a.hint })),
          [0],
        ));
    if (!adapters.length) {
      process.stderr.write("create-refract-theme: pick at least one output format.\n");
      return 1;
    }
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

    const result = scaffoldProject({
      name,
      directory: values.dir,
      adapters: adapters as AdapterChoice["id"][],
      answers,
      force: Boolean(values.force),
    });

    let variableCount = 0;
    try {
      variableCount = Object.keys(
        createTheme(result.create.raw, { adapter: createNoopAdapter() }).tokens as Record<string, unknown>,
      ).length;
    } catch {
      /* the report degrades to 0 rather than failing a successful scaffold */
    }

    p.write();
    for (const line of createReportLines(result.create, variableCount)) p.write(line);
    p.write();
    p.write(`  ${green("✓")} ${bold(name)} ${dim(`· ${result.files.length} files`)}`);
    for (const f of result.files) p.write(`      ${dim(f)}`);
    p.write();
    p.write(`  ${dim("Next:")}`);
    p.write(`      cd ${name}`);
    p.write(`      npm install`);
    p.write(`      npm run build`);
    p.write();
    return 0;
  } catch (err) {
    const e = err as { code?: string; message?: string };
    const code = typeof e.code === "string" && e.code.startsWith("REFRACT_E_") ? `[${e.code}] ` : "";
    process.stderr.write(`create-refract-theme: ${code}${e.message ?? String(err)}\n`);
    return 1;
  } finally {
    p.close();
  }
}

export { scaffoldProject, isDirectoryUsable } from "./scaffoldProject";
export { ADAPTERS } from "./templates";
export type { AdapterChoice, ProjectSpec } from "./templates";

// Executed as the bin entry. Guarded so importing this module (tests) never triggers a run.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then(
    code => process.exit(code),
    err => {
      process.stderr.write(`create-refract-theme: ${String(err)}\n`);
      process.exit(1);
    },
  );
}
