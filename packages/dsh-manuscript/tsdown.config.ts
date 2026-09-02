import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: { index: 'src/index.ts', 'host-api': 'src/host-api.ts' },
    format: ['esm'],
    dts: true,
    clean: true,
    outDir: 'lib',
    platform: 'node',
    target: 'node22',
    sourcemap: true,
    hash: false,
    outExtensions: () => ({ dts: '.d.ts', js: '.js' }),
  },
  {
    entry: { 'client.inner': 'src/client/index.ts' },
    format: ['cjs'],
    dts: false,
    clean: false,
    outDir: 'lib',
    platform: 'browser',
    target: 'es2022',
    sourcemap: true,
    hash: false,
    deps: { neverBundle: ['react'] },
    outExtensions: () => ({ dts: '.d.ts', js: '.cjs' }),
  },
  {
    // Standalone editor-core bundle. Imported by dsh-editor-shell via
    // `dsh-manuscript/client/editor-core`; the cjs output is also the entry
    // the host shell's tsdown alwaysBundle re-inlines for its own client.
    entry: { 'client-editor-core': 'src/client/editor-core/index.ts' },
    format: ['cjs'],
    dts: false,
    clean: false,
    outDir: 'lib',
    platform: 'browser',
    target: 'es2022',
    sourcemap: true,
    hash: false,
    deps: { neverBundle: ['react'] },
    outExtensions: () => ({ dts: '.d.ts', js: '.cjs' }),
  },
])
