import { defineConfig } from 'tsdown'
export default defineConfig([
  {
    entry: { index: 'src/index.ts', contracts: 'src/contracts.ts', tools: 'src/tools.ts' },
    format: ['esm'], dts: true, clean: true, outDir: 'lib', platform: 'node', target: 'node22', sourcemap: true, hash: false,
    deps: { neverBundle: ['@deepseek-ai/cordis', '@deepseek-ai/dsh-web', '@deepseek-ai/dsh-credentials', '@deepseek-ai/dsh-tool-web', '@deepseek-ai/dsh-web-search-deepseek', '@deepseek-ai/dsh-web-search-exa', '@deepseek-ai/dsh-web-fetch-http'] },
    outExtensions: () => ({ dts: '.d.ts', js: '.js' }),
  },
  {
    entry: { 'client.inner': 'src/client.tsx' }, format: ['cjs'], dts: false, clean: false, outDir: 'lib',
    platform: 'browser', target: 'es2022', sourcemap: true, hash: false,
    deps: { neverBundle: ['react', 'react/jsx-runtime'] },
    outExtensions: () => ({ dts: '.d.ts', js: '.cjs' }),
  },
])
