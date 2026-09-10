import { defineConfig } from 'tsdown'
export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'], dts: true, clean: true, outDir: 'lib', platform: 'node', target: 'node22', sourcemap: true, hash: false,
    deps: { neverBundle: ['@deepseek-ai/cordis'] },
    outExtensions: () => ({ dts: '.d.ts', js: '.js' }),
  },
  {
    entry: { 'client.inner': 'src/client.ts' }, format: ['cjs'], dts: false, clean: false, outDir: 'lib',
    platform: 'browser', target: 'es2022', sourcemap: true, hash: false,
    deps: {
      alwaysBundle: [
        'dsh-editor-workbench/contracts',
        'dsh-editor-seats',
      ],
      neverBundle: ['react', 'react-dom', 'react/jsx-runtime'],
    },
    outExtensions: () => ({ dts: '.d.ts', js: '.cjs' }),
  },
])
