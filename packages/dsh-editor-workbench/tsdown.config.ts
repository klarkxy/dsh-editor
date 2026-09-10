import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      tools: 'src/tools.ts',
    },
    format: ['esm'],
    dts: { eager: true },
    clean: true,
    outDir: 'lib',
    platform: 'node',
    target: 'node22',
    sourcemap: true,
    hash: false,
    deps: { neverBundle: ['@deepseek-ai/cordis', 'dsh-manuscript', 'dsh-editor-workspace-kit', 'dsh-editor-cards'] },
    outExtensions: () => ({ dts: '.d.ts', js: '.js' }),
  },
  {
    entry: { contracts: 'src/contracts.ts' },
    format: ['esm'],
    dts: { eager: true },
    clean: false,
    outDir: 'lib',
    platform: 'node',
    target: 'node22',
    sourcemap: true,
    hash: false,
    deps: {
      neverBundle: ['@deepseek-ai/cordis', 'dsh-manuscript', 'dsh-editor-cards'],
      alwaysBundle: ['dsh-editor-workspace-kit/frontmatter'],
    },
    outExtensions: () => ({ dts: '.d.ts', js: '.js' }),
  },
])
