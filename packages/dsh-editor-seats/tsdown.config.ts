import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  dts: true,
  clean: true,
  outDir: 'lib',
  platform: 'neutral',
  target: 'es2022',
  sourcemap: true,
  hash: false,
  outExtensions: () => ({ dts: '.d.ts', js: '.js' }),
})
