/**
 * Step 10e — the standing Node-only packaging-boundary gate.
 *
 * The invariant: the runtime `.` graph (`src/index.ts`) and the `./dtcg` subpath (`src/dtcg/index.ts`)
 * must NEVER pull in `typescript`, `node:*`, or any Node builtin at runtime. Only the deliberately
 * off-barrel build layer (`src/build/`, reachable via the `./build` subpath + the `refract` bin) is
 * allowed to. Before 10e this was enforced ad-hoc per sub-step (a manual `dist/` grep); this test makes
 * it a committed regression gate so a careless `import "node:fs"` added to a core/subsystem/adapter
 * file that `.` re-exports fails loudly.
 *
 * PRIMARY check = STRUCTURAL: walk the static RUNTIME import graph from each entry over `src/` (no
 * dist build required — runs in-repo like every other gate) and assert no reachable module imports a
 * forbidden specifier. Type-only imports are erased (they carry no runtime edge) — this is why the
 * `./dtcg` graph, which imports `Theme`/`Literal` type-only from core, stays self-contained.
 *
 * SECONDARY check = a `dist/` grep over the built bundles (belt-and-suspenders on the ACTUAL shipped
 * artifacts). It SKIPS gracefully when `dist/` is absent so the suite never needs a build.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUNTIME_ENTRIES = ["src/index.ts", "src/dtcg/index.ts"];

// A specifier is forbidden on the runtime graph if it is `typescript`, a `node:`-prefixed builtin, or
// a bare Node builtin name (`fs`, `path`, …). Everything else is allowed, so the gate forbids by
// denylist, not allowlist. Post monorepo split refract core ships ZERO adapter implementations, so its
// `.`/`./dtcg` runtime graph reaches NO runtime external at all (it's pure) — the adapter packages
// (and their real peers like `styled-components`) live elsewhere and run their own boundary checks.
const NODE_BUILTINS = new Set(builtinModules);
const isForbidden = (spec: string): boolean =>
  spec === "typescript" || spec.startsWith("node:") || NODE_BUILTINS.has(spec);

const isRelative = (spec: string): boolean => spec.startsWith(".");

/** Resolve a relative specifier from `fromFile` to a concrete `src` file (extensionless `.ts` / dir index). */
function resolveRelative(fromFile: string, spec: string): string {
  const base = resolve(dirname(fromFile), spec);
  const candidates = [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), base];
  const hit = candidates.find(c => c.endsWith(".ts") && existsSync(c));
  if (hit) return hit;
  throw new Error(`Cannot resolve runtime import "${spec}" from "${fromFile}" (tried ${candidates.join(", ")}).`);
}

interface Edges {
  /** Relative (followed) import specifiers — runtime edges into other `src` modules. */
  readonly relatives: string[];
  /** Bare (external) import specifiers reached at runtime from this module. */
  readonly externals: string[];
}

/**
 * Extract this module's RUNTIME import edges. Pure type-only `import type` / `export type` statements
 * are ignored (no runtime edge); a mixed `import { type A, b }` IS followed (the module is loaded).
 * Dynamic `import("x")` calls count as runtime edges too.
 */
function runtimeEdges(file: string): Edges {
  const src = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const relatives: string[] = [];
  const externals: string[] = [];
  const record = (spec: string): void => {
    (isRelative(spec) ? relatives : externals).push(spec);
  };

  for (const stmt of src.statements) {
    if (ts.isImportDeclaration(stmt)) {
      if (stmt.importClause?.isTypeOnly) continue; // `import type … from` — erased at runtime
      if (ts.isStringLiteral(stmt.moduleSpecifier)) record(stmt.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(stmt)) {
      if (stmt.isTypeOnly) continue; // `export type … from` — erased at runtime
      if (stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) record(stmt.moduleSpecifier.text);
    }
  }

  // Dynamic imports anywhere in the module body (defensive — the runtime graph has none today).
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      record(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(src);

  return { relatives, externals };
}

/** Walk the transitive runtime graph from `entry`, returning every reached external → the files reaching it. */
function reachableExternals(entry: string): Map<string, string[]> {
  const queue = [resolve(repoRoot, entry)];
  const visited = new Set<string>();
  const externals = new Map<string, string[]>();

  while (queue.length) {
    const file = queue.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);

    const { relatives, externals: ext } = runtimeEdges(file);
    for (const spec of ext) {
      const rel = file.slice(repoRoot.length + 1);
      externals.set(spec, [...(externals.get(spec) ?? []), rel]);
    }
    for (const spec of relatives) {
      const target = resolveRelative(file, spec);
      if (!visited.has(target)) queue.push(target);
    }
  }
  return externals;
}

describe("packaging boundary — structural (runtime import graph)", () => {
  for (const entry of RUNTIME_ENTRIES) {
    it(`${entry} reaches no typescript / node:* / builtin at runtime`, () => {
      const externals = reachableExternals(entry);
      const violations = [...externals.entries()]
        .filter(([spec]) => isForbidden(spec))
        .map(([spec, files]) => `${spec} (via ${[...new Set(files)].join(", ")})`);
      expect(violations, `Forbidden Node/TS imports leaked onto ${entry}:\n${violations.join("\n")}`).toEqual([]);
    });
  }

  it("the runtime `.` graph reaches NO external (core is pure after the split)", () => {
    // Post-split refract core imports nothing external at runtime — every adapter (and its peers) lives
    // in a sibling package. So `.` reaches zero externals; this pins that purity.
    const externals = reachableExternals("src/index.ts");
    expect([...externals.keys()]).toEqual([]);
  });

  it("the gate actually follows the graph (sanity: the build layer DOES reach `typescript`)", () => {
    // Proves the walker isn't vacuously green — walking the Node-only build layer reaches `typescript`
    // (via `paths.ts`'s dynamic `await import("typescript")`), so the traversal genuinely sees externals
    // (incl. dynamic imports). The build layer is off the runtime denylist, so reaching it there is fine.
    const externals = reachableExternals("src/build/index.ts");
    expect([...externals.keys()]).toContain("typescript");
  });

  it("the gate would FAIL if a forbidden import were present (denylist self-check)", () => {
    // A guard on the classifier itself, so a future edit that neuters `isForbidden` is caught.
    expect(isForbidden("node:fs")).toBe(true);
    expect(isForbidden("fs")).toBe(true);
    expect(isForbidden("typescript")).toBe(true);
    expect(isForbidden("styled-components")).toBe(false);
  });
});

describe("packaging boundary — dist bundles (secondary; skips when dist/ absent)", () => {
  const bundles = ["dist/index.esm.js", "dist/index.cjs.js", "dist/dtcg.esm.js", "dist/dtcg.cjs.js"].map(f =>
    join(repoRoot, f),
  );
  const built = bundles.filter(f => existsSync(f));

  it.skipIf(built.length === 0)("built `.`/`./dtcg` bundles are grep-clean of node:/typescript", () => {
    for (const file of built) {
      const code = readFileSync(file, "utf8");
      expect(code, `${file} references "typescript"`).not.toMatch(/["']typescript["']/);
      expect(code, `${file} references a node: builtin`).not.toMatch(/["']node:[a-z/]+["']/);
    }
  });
});
