/**
 * The files a scaffolded theme package gets, beyond the theme and the build config.
 *
 * What this creates is a **publishable design-system package** — not an app. The distinction matters:
 * an app starter would overlap `create-next-app` and commit us to chasing framework releases forever,
 * while a theme package is the thing refract uniquely enables and nothing else scaffolds. Someone who
 * wants to add a theme to an app they already have runs `refract create` instead.
 */

/** Adapters the scaffolder can wire, in the order they're offered. */
export interface AdapterChoice {
  readonly id: "css" | "scss" | "json" | "styled-components";
  readonly label: string;
  readonly pkg: string;
  readonly factory: string;
  readonly outDir: string;
  /** The file this adapter emits that the package `exports` should point at. */
  readonly entryFile: string;
  readonly hint: string;
}

export const ADAPTERS: readonly AdapterChoice[] = [
  {
    id: "css",
    label: "CSS",
    pkg: "@theme-registry/refract-css",
    factory: "createCssAdapter",
    outDir: "dist/css",
    entryFile: "theme.css",
    hint: "custom properties + recipe classes — the common choice",
  },
  {
    id: "styled-components",
    label: "styled-components",
    pkg: "@theme-registry/refract-styled-components",
    factory: "createStyledComponentsAdapter",
    outDir: "dist/sc",
    entryFile: "theme.ts",
    hint: "TS/JS modules — a theme object + tree-shakeable recipes",
  },
  {
    id: "scss",
    label: "SCSS",
    pkg: "@theme-registry/refract-scss",
    factory: "createScssAdapter",
    outDir: "dist/scss",
    entryFile: "theme.scss",
    hint: "variables + mixins (experimental)",
  },
  {
    id: "json",
    label: "JSON",
    pkg: "@theme-registry/refract-json",
    factory: "createJsonAdapter",
    outDir: "dist/json",
    entryFile: "theme.json",
    hint: "a structured document for other tools (experimental)",
  },
];

export interface ProjectSpec {
  /** The package name, as typed. */
  readonly name: string;
  /** Adapters to wire as build targets. */
  readonly adapters: readonly AdapterChoice[];
  /** Version range to depend on refract with, e.g. `^0.1.2`. */
  readonly refractRange: string;
  /** The raw-theme file the config will import, e.g. `theme.raw.ts`. */
  readonly rawFilename: string;
  /** Wire the MCP server — adds the dependency and writes `.mcp.json`. */
  readonly mcp?: boolean;
}

/**
 * `.mcp.json` — project-scoped MCP wiring, so anyone who opens the repo gets an agent pointed at
 * *this* theme. The server reads the build config at startup, which is why it takes `--config`
 * rather than a theme argument.
 */
export function mcpConfig(configFile = "theme.config.ts"): string {
  return `${JSON.stringify(
    {
      mcpServers: {
        refract: {
          command: "npx",
          args: ["-y", "@theme-registry/refract-mcp", "--config", configFile],
        },
      },
    },
    null,
    2,
  )}\n`;
}

/**
 * `package.json` for the generated project.
 *
 * Deliberately publishable from the first commit: real `exports`, a `files` allowlist, and
 * `prepublishOnly` wired to the build — so `npm publish` produces something consumable rather than a
 * folder of source. `version` starts at `0.0.0` so the author's first release is theirs to choose.
 */
export function packageJson(spec: ProjectSpec): string {
  // Every entry must point at a file the build actually emits — an `exports` map that lies is worse
  // than no map at all. The styled-components adapter emits TS *source* modules (its `language`
  // default), so that entry is the source file consumers' bundlers compile, not a runtime artefact.
  const exportsMap: Record<string, unknown> = { "./package.json": "./package.json" };
  for (const a of spec.adapters) {
    if (a.id === "css") exportsMap["./css"] = `./${a.outDir}/${a.entryFile}`;
    if (a.id === "scss") exportsMap["./scss"] = `./${a.outDir}/${a.entryFile}`;
    if (a.id === "json") exportsMap["./tokens"] = `./${a.outDir}/${a.entryFile}`;
    if (a.id === "styled-components") exportsMap["./sc"] = `./${a.outDir}/${a.entryFile}`;
  }

  // `typescript` is an OPTIONAL peer of refract, but this scaffold writes a `.ts` config (and a
  // tsconfig), and the build transpiles that config — so for this project it isn't optional at all.
  // Without it the very first `npm run build` fails on a fresh install.
  // `@types/node` because the generated tsconfig asks for the node type library — and the JSON
  // flavour's config genuinely uses `readFileSync` and `import.meta.url`, so it isn't decorative.
  const devDeps: Record<string, string> = {
    "@theme-registry/refract": spec.refractRange,
    "@types/node": "^24",
    typescript: "^5.4.2",
  };
  for (const a of spec.adapters) devDeps[a.pkg] = spec.refractRange;
  // Declared as well as referenced in `.mcp.json`: the config runs it through `npx`, but pinning it
  // here keeps the agent on the same version as the theme it's answering questions about.
  if (spec.mcp) devDeps["@theme-registry/refract-mcp"] = spec.refractRange;

  return `${JSON.stringify(
    {
      name: spec.name,
      version: "0.0.0",
      description: `Design tokens and theme output for ${spec.name}, built with refract.`,
      license: "MIT",
      type: "module",
      files: ["/dist"],
      exports: exportsMap,
      scripts: {
        build: "refract build",
        typecheck: "tsc -p tsconfig.json",
        audit: "refract audit",
        tokens: "refract tokens --out dist/tokens.json",
        diff: "refract diff",
        prepublishOnly: "npm run build",
      },
      devDependencies: Object.fromEntries(Object.entries(devDeps).sort(([a], [b]) => a.localeCompare(b))),
    },
    null,
    2,
  )}\n`;
}

/** A `tsconfig.json` that types the theme file without trying to compile anything. */
export function tsconfig(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        types: ["node"],
      },
      include: ["theme.raw.ts", "theme.config.ts"],
    },
    null,
    2,
  )}\n`;
}

export function gitignore(): string {
  return ["node_modules/", "dist/", ".DS_Store", "*.log", ""].join("\n");
}

/**
 * The README the author will actually edit. Says what the package is, how to build it, and — the part
 * a generated readme usually omits — what each generated file is *for*, so the first change they make
 * lands in the right one.
 */
export function readme(spec: ProjectSpec): string {
  const targets = spec.adapters.map(a => `\`${a.outDir}\``).join(" · ");
  return `# ${spec.name}

Design tokens and theme output, built with [refract](https://github.com/theme-registry/refract).

## Files

| File | What it's for |
| --- | --- |
| \`${spec.rawFilename}\` | **Your design.** Colours, type scale, spacing — every token lives here. This is the file you edit. |
| \`theme.config.ts\` | **Build wiring.** Which adapters run and where their output lands. Edit when you add a format, not when you change a colour. |

## Commands

\`\`\`sh
npm run build     # compile the theme → ${targets}
npm run audit     # score every colour pairing for WCAG contrast
npm run tokens    # export DTCG tokens.json
\`\`\`

## Changing the theme

Tonal ladders, the type scale and the spacing ramp are **synthesized** from the declarations in
\`${spec.rawFilename}\` — so retuning is usually one value, not a table:

- a new brand colour → change \`colors.primary.base\`; every step re-derives
- a tighter type scale → change \`typography.fontSize.ratio\` to \`"major-second"\`
- more generous spacing → change the multipliers in \`layout.spacing.steps\`

Run \`npm run audit\` after changing a colour: the palette was generated to clear WCAG AA, and it's
easy to lose that by hand.

## Publishing

\`version\` starts at \`0.0.0\` — set your own before the first release. \`prepublishOnly\` runs the
build, so \`npm publish\` always ships freshly compiled output.
`;
}

/** The build config, wiring every chosen adapter to the detected raw theme. */
export function themeConfig(spec: ProjectSpec, rawImport: { head: string; expression: string }): string {
  const imports = spec.adapters.map(a => `import { ${a.factory} } from "${a.pkg}";`).join("\n");
  const targets = spec.adapters
    .map(a => `    { adapter: ${a.factory}(), outDir: "${a.outDir}" },`)
    .join("\n");

  return `import { defineConfig } from "@theme-registry/refract/build";
${imports}
${rawImport.head}
// Build wiring for ${spec.name}. \`refract build\` reads this file, builds the theme once, and writes
// each target's files into its \`outDir\`. Adapter options go here, at construction.
//
// Your tokens live in \`${spec.rawFilename}\` — edit them there, not here.
export default defineConfig({
  raw: ${rawImport.expression},
  targets: [
${targets}
  ],
});
`;
}
