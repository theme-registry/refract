/**
 * Build-layer path + transpile helpers (Node-only).
 *
 * Two jobs, both needed to materialize Option-A vendored helpers (§7 10a/10b): locate a
 * vendorable source's single origin (which lives in the package, NOT a second copy) and
 * type-strip it to a standalone ES module the consumer's build output can drop in.
 *
 * Packaging (resolved 2026-07-11): `VENDOR_HELPERS[].source` is package-root-relative. The
 * published package ships only `dist/`, so the vendorable sources are added to `package.json#files`
 * and this module resolves them against the discovered package root — working the SAME way in-repo
 * (root = repo root) and installed (root = the installed package dir).
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type ts from "typescript";

/** Walk up from `startDir` to the first ancestor that contains a `package.json`. */
export const findPackageRoot = (startDir: string = __dirname): string => {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`No package.json found walking up from "${startDir}".`);
    }
    dir = parent;
  }
};

/** Read a package-root-relative vendorable source (must ship via `package.json#files`). */
export const readVendorSource = (source: string): string => {
  const path = join(findPackageRoot(), source);
  if (!existsSync(path)) {
    throw new Error(
      `Vendor helper source "${source}" not found at "${path}". ` +
        `Ensure it is listed in package.json "files" so it ships with the package.`,
    );
  }
  return readFileSync(path, "utf8");
};

/**
 * Lazily resolve the `typescript` peer (Step 10e). `typescript` is an OPTIONAL peer dependency — a
 * consumer who only uses the runtime (`createTheme` + adapters), `./dtcg`, or a `.mjs`/`.js` config
 * with the CSS `emit()` never needs it. It's pulled in ONLY on the two paths that actually transpile
 * TS: loading a `.ts` config and vendoring a shared helper module. If it's absent when one of those
 * runs, we throw a clear, actionable error instead of an opaque module-resolution failure.
 */
async function loadTypescript(): Promise<typeof ts> {
  try {
    const mod = (await import("typescript")) as unknown as { default?: typeof ts } & typeof ts;
    return mod.default ?? mod;
  } catch {
    throw new Error(
      'refract: the optional peer dependency "typescript" is required to transpile a `.ts` ' +
        "theme.config or vendor a shared helper module, but it could not be resolved. Install it " +
        "(`npm i -D typescript`), or use a `.mjs`/`.js` config and avoid the `helpers` opt-in.",
    );
  }
}

/**
 * Type-strip a self-contained TS module to standalone ESM — exactly what the 10a gate proves the
 * vendored artifact does. Reused for the `.ts` config loader (types stripped, `import`s preserved).
 *
 * Async because it lazy-loads the optional `typescript` peer (see {@link loadTypescript}); the
 * `.mjs`/`.js` config + CSS `emit()` paths never call it, so those work with `typescript` absent.
 */
export const transpileToEsm = async (sourceText: string): Promise<string> => {
  const tsc = await loadTypescript();
  return tsc.transpileModule(sourceText, {
    compilerOptions: { module: tsc.ModuleKind.ESNext, target: tsc.ScriptTarget.ES2020 },
  }).outputText;
};

/** The result of a graph compile: the emitted entry to import + a cleanup that unlinks every temp file. */
export interface CompiledTsGraph {
  /** Absolute path of the emitted config entry (an adjacent hidden `.mjs`) to dynamically import. */
  readonly entry: string;
  /** Remove every emitted temp file — call in a `finally` after importing `entry`. */
  readonly cleanup: () => void;
}

// Module-local counter keeps concurrent emit-file names unique without Date/Math.random.
let graphCounter = 0;

/** Extension-stripped absolute key so a source `.ts` and its emitted `.js` name map to one entry. */
const graphKey = (p: string): string =>
  resolve(p).replace(/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/, "");

/**
 * Compile a `.ts` theme config **and its local relative `.ts` graph** to standalone ESM so a `.ts`
 * config can `import` a sibling `theme.raw.ts` (§8b — the 8a `RawTheme` payoff). Upgrades the old
 * single-file `transpileToEsm` path to a `ts.createProgram` compile: relative `.ts`/`.tsx`/`.mts`/
 * `.cts` imports are followed + compiled; **bare specifiers and relative `.mjs`/`.js`/`.json` stay
 * external** (untouched — resolved at their original location).
 *
 * **Adjacent-per-file emit** (settled 2026-07-11, supersedes the kickoff's temp-subdir): each compiled
 * source emits to a hidden unique `.<base>.<pid>-<n>.mjs` **next to its own source**. That's the one
 * layout where a mixed graph resolves — the emitted config sits in the original dir, so bare imports
 * resolve up to the project's `node_modules`, uncompiled relative siblings (`./adapter.mjs`,
 * `./tokens.json`) resolve adjacent, and compiled siblings resolve to their emitted `.mjs`. Parent-dir
 * imports (`../shared/theme.raw`) need no `rootDir`→`outDir` mapping — each file emits by its own source.
 *
 * A `before` transformer rewrites relative specifiers that resolve to a **compiled** source to its
 * emitted `.mjs` (so extensionless `./theme.raw` → `./.theme.raw.<pid>-<n>.mjs`); `.json` / `.mjs` /
 * `.js` / bare specifiers are left untouched (their `with { type: "json" }` attributes preserved).
 * No type-checking — diagnostics are ignored (`noEmitOnError: false`); this is a transpile, not a build.
 *
 * `paths`/tsconfig aliases are **NOT** resolved in v1 (a fixed `compilerOptions` set; the user's
 * tsconfig is ignored) — documented limitation.
 */
export const compileTsConfigGraph = async (configPath: string): Promise<CompiledTsGraph> => {
  const tsc = await loadTypescript();
  const options: ts.CompilerOptions = {
    module: tsc.ModuleKind.ESNext,
    target: tsc.ScriptTarget.ES2020,
    moduleResolution: tsc.ModuleResolutionKind.Bundler,
    resolveJsonModule: true,
    allowJs: false,
    noLib: true,
    skipLibCheck: true,
    noEmitOnError: false,
    declaration: false,
    sourceMap: false,
    types: [],
  };

  const host = tsc.createCompilerHost(options);
  const program = tsc.createProgram([configPath], options, host);

  // Map each compiled TS source (config + its relative `.ts` graph) → an adjacent hidden temp `.mjs`.
  const tempFor = new Map<string, string>();
  const isCompiledTs = (sf: ts.SourceFile): boolean =>
    !sf.isDeclarationFile &&
    !sf.fileName.includes("/node_modules/") &&
    /\.(ts|tsx|mts|cts)$/.test(sf.fileName);
  for (const sf of program.getSourceFiles()) {
    if (!isCompiledTs(sf)) continue;
    const abs = resolve(sf.fileName);
    const base = basename(abs).replace(/\.(ts|tsx|mts|cts)$/, "");
    tempFor.set(graphKey(abs), join(dirname(abs), `.${base}.${process.pid}-${graphCounter++}.mjs`));
  }

  // Does this relative specifier resolve to one of the compiled sources? → its emitted `.mjs`, else undefined.
  const rewriteTarget = (spec: string, containingFile: string): string | undefined => {
    if (!spec.startsWith(".")) return undefined; // bare → external
    const resolved = tsc.resolveModuleName(spec, containingFile, options, host).resolvedModule
      ?.resolvedFileName;
    return resolved ? tempFor.get(graphKey(resolved)) : undefined;
  };

  // Rewrite relative import/export/dynamic-import specifiers that point at a compiled source.
  const rewrite: ts.TransformerFactory<ts.SourceFile> = context => sourceFile => {
    const containing = resolve(sourceFile.fileName);
    const factory = context.factory;
    const specFor = (text: string): ts.StringLiteral | undefined => {
      const temp = rewriteTarget(text, containing);
      return temp ? factory.createStringLiteral(`./${basename(temp)}`) : undefined;
    };
    const visit = (node: ts.Node): ts.Node => {
      if (tsc.isImportDeclaration(node) && tsc.isStringLiteral(node.moduleSpecifier)) {
        const next = specFor(node.moduleSpecifier.text);
        if (next) {
          return factory.updateImportDeclaration(
            node,
            node.modifiers,
            node.importClause,
            next,
            node.attributes,
          );
        }
      } else if (
        tsc.isExportDeclaration(node) &&
        node.moduleSpecifier &&
        tsc.isStringLiteral(node.moduleSpecifier)
      ) {
        const next = specFor(node.moduleSpecifier.text);
        if (next) {
          return factory.updateExportDeclaration(
            node,
            node.modifiers,
            node.isTypeOnly,
            node.exportClause,
            next,
            node.attributes,
          );
        }
      } else if (
        tsc.isCallExpression(node) &&
        node.expression.kind === tsc.SyntaxKind.ImportKeyword &&
        node.arguments.length &&
        tsc.isStringLiteral(node.arguments[0])
      ) {
        const next = specFor(node.arguments[0].text);
        if (next) {
          return factory.updateCallExpression(node, node.expression, node.typeArguments, [
            next,
            ...node.arguments.slice(1),
          ]);
        }
      }
      return tsc.visitEachChild(node, visit, context);
    };
    return tsc.visitNode(sourceFile, visit) as ts.SourceFile;
  };

  // Redirect TS's computed `<source>.js` emit to the adjacent hidden `.mjs` (forces ESM regardless of
  // the project's `package.json#type`); ignore anything unexpected.
  const written: string[] = [];
  const writeFile: ts.WriteFileCallback = (fileName, text) => {
    const target = tempFor.get(graphKey(fileName));
    if (!target) return;
    writeFileSync(target, text, "utf8");
    written.push(target);
  };

  const cleanup = (): void => {
    for (const file of written) rmSync(file, { force: true });
  };

  try {
    program.emit(undefined, writeFile, undefined, false, { before: [rewrite] });
  } catch (err) {
    cleanup();
    throw err;
  }

  const entry = tempFor.get(graphKey(configPath));
  if (!entry || !existsSync(entry)) {
    cleanup();
    throw new Error(`refract: failed to compile the \`.ts\` config graph for "${configPath}".`);
  }
  return { entry, cleanup };
};
