import { defineConfig } from 'tsdown'
export default defineConfig({
  entry: { index: 'src/index.ts' }, format: ['esm'], dts: true, clean: true,
  outDir: 'lib', platform: 'node', target: 'node22', sourcemap: true, hash: false,
  deps: { neverBundle: ['@deepseek-ai/cordis', '@deepseek-ai/dsh-web', 'dsh-web-search-manager'] },
  outExtensions: () => ({ dts: '.d.ts', js: '.js' }),
})
