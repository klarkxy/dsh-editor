import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    tools: 'src/tools.ts',
    workflow: 'src/workflow.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  outDir: 'lib',
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  hash: false,
  outExtensions: () => ({ dts: '.d.ts', js: '.js' }),
  deps: { neverBundle: ['@deepseek-ai/dsh-tools', '@deepseek-ai/cordis'] },
})
