/**
 * `refract init` — scaffold a runnable `theme.config.(ts|js|mjs)` (Node-only, §7 Step 10c).
 *
 * The config is the primary build interface + the adapter seam (10b): it is USER CODE that `import`s
 * the adapter it wants. `init` writes a starter that is runnable out of the box — it uses the CSS
 * adapter package (`@theme-registry/refract-css`) + `defineConfig` (refract's `./build` subpath), a
 * minimal inline `raw`, and one CSS target — plus commented lines showing how to add another adapter
 * target (e.g. an SC package) once installed. Post monorepo split every adapter lives in its own
 * sibling package, so the scaffold imports the CSS adapter from `refract-css`, not from core. Adapter
 * *options* are passed at construction in the config (`createCssAdapter({ … })`), never as CLI flags
 * (a flag can't carry an imported object).
 *
 * Default variant is `.ts`; `--js` / `--mjs` pick the ESM variants. All three share one ESM body
 * (the `.ts` file only differs by extension — it lets the author add types later); the difference is
 * purely Node's module-resolution semantics (`.mjs` is always ESM; `.js` follows the project type).
 * `init` refuses to clobber an existing config unless `--force`.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findPackageRoot } from "./paths";

export type ConfigVariant = "ts" | "js" | "mjs";

/**
 * The sibling package the CSS adapter ships from post monorepo split. `defineConfig`/`RawTheme` still
 * come from core (`${packageName}/build`); only the adapter itself moved to its own package.
 */
export const CSS_ADAPTER_PACKAGE = "@theme-registry/refract-css";

export interface InitOptions {
  /** Project dir to scaffold into (default `process.cwd()`). */
  readonly cwd?: string;
  /** Which config flavor to write (default `"ts"`). */
  readonly variant?: ConfigVariant;
  /** Overwrite an existing config instead of refusing (default `false`). */
  readonly force?: boolean;
  /** Package name to import from in the scaffold (default: this package's own `name`). */
  readonly packageName?: string;
}

export interface InitResult {
  /** Absolute path of the written config. */
  readonly path: string;
  readonly variant: ConfigVariant;
  /** The package name the scaffold imports from. */
  readonly packageName: string;
}

/** Read this package's own `name` (so the scaffold imports the currently-installed package name). */
export function readOwnPackageName(): string {
  const pkgPath = join(findPackageRoot(), "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string };
  return pkg.name ?? "@theme-registry/refract";
}

/** The scaffolded config body — one shared ESM template across ts/js/mjs. */
export function scaffoldConfig(packageName: string): string {
  return `import { defineConfig } from "${packageName}/build";
import { createCssAdapter } from "${CSS_ADAPTER_PACKAGE}";

// refract build config. \`refract build\` reads this file, builds the theme once, and writes
// each target's emitted files into that target's \`outDir\`. The config is your code: it \`import\`s
// the adapters it wants and passes their options at construction (not via CLI flags).
export default defineConfig({
  // The raw theme — authored in refract's nested slices. Extend with typography/effects/layout.
  raw: {
    breakpoints: { sm: 576, md: 768, lg: 1024, xl: 1280 },
    colors: {
      // Starter palette passes its own contrast audit (WCAG AA): white text clears 4.5:1 on both
      // bases. Keep that when you retune — the auditor is a shipped feature; the default should model it.
      primary: { base: "#1864ab", text: "#fff", variants: { dark: "#0b4a86", light: "#a5d8ff" } },
      neutral: { base: "#495057", text: "#fff", variants: { light: "#f1f3f5", dark: "#212529" } },
      recipes: {
        solid: {
          primary: { background: "primary", color: "primary.text" },
          neutral: { background: "neutral.light", color: "neutral.dark" },
        },
      },
    },
  },
  targets: [
    // The CSS adapter (from @theme-registry/refract-css). Pass its options here, at construction.
    { adapter: createCssAdapter(/* { colors: { prefix: "app" } } */), outDir: "dist/theme" },

    // Add another adapter target once its package is installed, e.g.:
    // import { createStyledComponentsAdapter } from "@theme-registry/refract-styled-components";
    // { adapter: createStyledComponentsAdapter(), outDir: "dist/theme-sc" },
  ],
});
`;
}

/**
 * Scaffold `theme.config.<variant>` into `cwd`. Throws if the file exists and `force` is not set
 * (never silently clobbers a user's config).
 */
export function runInit(options: InitOptions = {}): InitResult {
  const cwd = options.cwd ?? process.cwd();
  const variant = options.variant ?? "ts";
  const packageName = options.packageName ?? readOwnPackageName();

  const path = join(cwd, `theme.config.${variant}`);
  if (existsSync(path) && !options.force) {
    throw new Error(
      `theme.config.${variant} already exists at "${path}". Pass --force to overwrite it.`,
    );
  }

  writeFileSync(path, scaffoldConfig(packageName), "utf8");
  return { path, variant, packageName };
}
