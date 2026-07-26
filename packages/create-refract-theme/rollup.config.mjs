import typescript from '@rollup/plugin-typescript';

// create-refract-theme — the npm initializer (`npm create refract-theme`).
//
// Unlike the adapter packages this is an executable, not a library: one ESM bundle with a shebang,
// no minification (a stack trace from a scaffolder should be readable), and `@theme-registry/refract`
// left EXTERNAL because it's a real dependency the initializer resolves at run time — it calls the
// generator (`runCreate`) and the config writer (`runInit`) rather than reimplementing either.
export default {
  input: 'src/index.ts',
  external: [/^@theme-registry\/refract(\/.*)?$/, /^node:/],
  output: {
    file: 'dist/index.js',
    format: 'esm',
    sourcemap: true,
    banner: '#!/usr/bin/env node',
  },
  plugins: [typescript({ tsconfig: './tsconfig.json' })],
};
