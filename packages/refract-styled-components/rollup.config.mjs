import terser from '@rollup/plugin-terser';
import typescript from '@rollup/plugin-typescript';
import external from 'rollup-plugin-peer-deps-external';

// @theme-registry/refract-styled-components — the styled-components output adapter (monorepo split,
// context.md §3). Same shape as the worked-example CSS package. Both `@theme-registry/refract` (core)
// and `styled-components` are PEER dependencies, so `rollup-plugin-peer-deps-external` marks them (and
// refract's subpaths) external — the adapter bundles neither. The `styled-components ^6` peer lives
// ONLY here (install-what-you-use: only SC-adapter consumers pull it in). An explicit `external` regex
// belts the refract subpath cases (`@theme-registry/refract/adapter-kit`).
export default {
  input: 'src/index.ts',
  external: [/^@theme-registry\/refract(\/.*)?$/, /^styled-components(\/.*)?$/],
  output: [
    { file: 'dist/index.cjs.js', format: 'cjs', sourcemap: true, exports: 'named' },
    { file: 'dist/index.esm.js', format: 'esm', sourcemap: true, exports: 'named' }
  ],
  plugins: [external(), typescript({ tsconfig: './tsconfig.json' }), terser()]
};
