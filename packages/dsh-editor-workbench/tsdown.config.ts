import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    tools: 'src/tools.ts',
    contracts: 'src/contracts.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  outDir: 'lib',
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  hash: false,
  deps: { neverBundle: ['@deepseek-ai/cordis', 'dsh-manuscript'] },
  outExtensions: () => ({ dts: '.d.ts', js: '.js' }),
})
