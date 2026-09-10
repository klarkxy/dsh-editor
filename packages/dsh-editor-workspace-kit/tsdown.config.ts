import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    dts: true,
    clean: true,
    outDir: 'lib',
    platform: 'node',
    target: 'node22',
    sourcemap: true,
    hash: false,
    deps: { neverBundle: ['dsh-manuscript'] },
    outExtensions: () => ({ dts: '.d.ts', js: '.js' }),
  },
  {
    entry: { frontmatter: 'src/frontmatter.ts' },
    format: ['esm'],
    dts: true,
    clean: false,
    outDir: 'lib',
    platform: 'neutral',
    target: 'es2022',
    sourcemap: true,
    hash: false,
    outExtensions: () => ({ dts: '.d.ts', js: '.js' }),
  },
])
