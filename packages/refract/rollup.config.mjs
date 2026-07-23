import terser from '@rollup/plugin-terser';
import typescript from '@rollup/plugin-typescript';
import external from 'rollup-plugin-peer-deps-external';

// @theme-registry/refract — the core package (monorepo split, context.md §3). Ships ZERO adapter
// implementations; every adapter is its own sibling package. This config emits the core's public
// subpaths only.
//
// `index` is the runtime surface (core + subsystems, adapter-required). `dtcg` is the format-neutral
// DTCG interop on its own `./dtcg` subpath (the dtcg module graph imports nothing from core at runtime
// — Theme/Literal are type-only — so `dist/dtcg.*.js` is fully self-contained). `adapter-kit` is the
// shared adapter-authoring helpers (naming overrides, createNamer, sanitizeSegment) that every adapter
// package deep-imports via `@theme-registry/refract/adapter-kit`. `color-math` is the import-free OKLCH
// helper module, exposed for advanced users (and vendored by the build layer). Shared core code
// de-dupes into `_<name>-<hash>` chunks across these entries.
//
// This `runtime` config's `@rollup/plugin-typescript` (declaration: true, from tsconfig) emits the
// `.d.ts` for ALL of `src` — including `src/build/*` — so the Node-only build layer's types ride
// along without a second declaration pass. Its `.js` bundles stay clean of the build layer because
// `src/build` is not in this graph (index/dtcg/adapter-kit/color-math never import it) — the `.`
// surface has no `node:fs` or `typescript` (grep-gated by test/packaging-boundary.test.ts).
const runtime = {
  input: {
    index: 'src/index.ts',
    dtcg: 'src/dtcg/index.ts',
    'adapter-kit': 'src/adapter-kit.ts',
    // The OKLCH colour-math module on its own subpath — the same import-free source the build layer
    // vendors, exposed for advanced users who want the helpers directly.
    'color-math': 'src/subsystems/colors/utils.ts'
  },
  output: [
    { dir: 'dist', format: 'cjs', sourcemap: true, exports: 'named', entryFileNames: '[name].cjs.js', chunkFileNames: '_[name]-[hash].cjs.js' },
    { dir: 'dist', format: 'esm', sourcemap: true, exports: 'named', entryFileNames: '[name].esm.js', chunkFileNames: '_[name]-[hash].esm.js' }
  ],
  plugins: [external(), typescript({ tsconfig: './tsconfig.json' }), terser()]
};

// The Node-only build layer. `build.*.js` backs the `./build` subpath (the programmatic build API +
// `defineConfig`, imported by a scaffolded `theme.config`); `cli.js` is the `refract` bin. Both are
// bundled self-contained EXCEPT `typescript` (a real optional-peer used by the config loader + helper
// vendoring) and Node builtins, which stay external. Declarations are already emitted by `runtime`
// above, so these passes disable them (declaration: false) to avoid a redundant re-emit.
const buildLayerPlugins = [
  typescript({ tsconfig: './tsconfig.json', compilerOptions: { declaration: false, declarationMap: false, declarationDir: undefined } })
];
const nodeExternal = [/^node:/, 'typescript'];

const buildApi = {
  input: 'src/build/index.ts',
  external: nodeExternal,
  output: [
    { file: 'dist/build.cjs.js', format: 'cjs', sourcemap: true, exports: 'named' },
    { file: 'dist/build.esm.js', format: 'esm', sourcemap: true, exports: 'named' }
  ],
  plugins: [...buildLayerPlugins, terser()]
};

// The bin. CJS (the package has no `"type"`, so a bare `.js` is CommonJS — and the entry-guard in
// cli.ts relies on `require.main === module`). A shebang banner makes it directly executable; left
// unminified so a `bin` a user might inspect / a stack trace stays legible.
const cli = {
  input: 'src/build/cli.ts',
  external: nodeExternal,
  output: { file: 'dist/cli.js', format: 'cjs', sourcemap: true, exports: 'named', banner: '#!/usr/bin/env node' },
  plugins: buildLayerPlugins
};

export default [runtime, buildApi, cli];
