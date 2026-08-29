import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { index: 'src/index.ts', contracts: 'src/contracts.ts' },
  format: ['esm'],
  dts: true,
  clean: true,
  outDir: 'lib',
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  hash: false,
  outExtensions: () => ({ dts: '.d.ts', js: '.js' }),
})
