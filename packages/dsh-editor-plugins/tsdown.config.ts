import { defineConfig } from 'tsdown'
export default defineConfig([
  {
    entry: { index: 'src/index.ts', contracts: 'src/contracts.ts' },
    format: ['esm'], dts: true, clean: true, outDir: 'lib', platform: 'node', target: 'node22', sourcemap: true, hash: false,
    deps: { neverBundle: ['@deepseek-ai/cordis'] },
    outExtensions: () => ({ dts: '.d.ts', js: '.js' }),
  },
  {
    entry: { 'client.inner': 'src/client.tsx' }, format: ['cjs'], dts: false, clean: false, outDir: 'lib',
    platform: 'browser', target: 'es2022', sourcemap: true, hash: false,
    deps: { neverBundle: ['react', 'react/jsx-runtime'], alwaysBundle: ['dsh-editor-seats/seat-button'] },
    outExtensions: () => ({ dts: '.d.ts', js: '.cjs' }),
  },
])
