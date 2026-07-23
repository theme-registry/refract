import terser from '@rollup/plugin-terser';
import typescript from '@rollup/plugin-typescript';
import external from 'rollup-plugin-peer-deps-external';

// @theme-registry/refract-json — the JSON output adapter (monorepo split, context.md §3). This is the
// worked-example adapter package: the shape every other adapter package (SC/SCSS/JSON) and every
// contributed adapter copies. One `.` entry (the adapter + its option/node types).
//
// Core is a PEER dependency, so `rollup-plugin-peer-deps-external` marks `@theme-registry/refract` (and
// its subpaths `@theme-registry/refract/color-math`, `/adapter-kit`) external — the adapter never bundles
// a copy of core; the consumer's single installed refract is shared. An explicit `external` regex
// belts the subpath cases the peer-deps plugin might miss.
export default {
  input: 'src/index.ts',
  external: [/^@theme-registry\/refract(\/.*)?$/],
  output: [
    { file: 'dist/index.cjs.js', format: 'cjs', sourcemap: true, exports: 'named' },
    { file: 'dist/index.esm.js', format: 'esm', sourcemap: true, exports: 'named' }
  ],
  plugins: [external(), typescript({ tsconfig: './tsconfig.json' }), terser()]
};
