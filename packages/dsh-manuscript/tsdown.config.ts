import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsdown'

const requireFromManuscript = createRequire(fileURLToPath(new URL('./package.json', import.meta.url)))

/* tsdown's css-guard throws on any remaining *.css module unless @tsdown/css
   is installed. Remap CSS imports to a virtual text module so loader:'text'
   is not enough by itself — the guard matches on the .css id. */
const cssAsTextPlugin = {
  name: 'css-as-text',
  resolveId(id: string) {
    if (id.endsWith('.css')) return `\0css-as-text:${id}.as-text`
  },
  load(id: string) {
    if (!id.startsWith('\0css-as-text:') || !id.endsWith('.as-text')) return
    const spec = id.slice('\0css-as-text:'.length, -'.as-text'.length)
    const file = /^[A-Za-z]:[\\/]/.test(spec) || spec.startsWith('/') ? spec : requireFromManuscript.resolve(spec)
    return `export default ${JSON.stringify(readFileSync(file, 'utf8'))}`
  },
}

const browserAlwaysBundle = [
  '@codemirror/state',
  '@codemirror/view',
  '@codemirror/commands',
  '@codemirror/language',
  '@codemirror/search',
  '@lezer/markdown',
  '@lezer/highlight',
  'dsh-editor-seats/tokens',
  '@radix-ui/themes',
  '@radix-ui/themes/styles.css',
]

export default defineConfig([
  {
    entry: { index: 'src/index.ts', 'host-api': 'src/host-api.ts', assist: 'src/assist.ts' },
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
    entry: { 'client.inner': 'src/client/index.tsx' },
    format: ['cjs'],
    dts: false,
    clean: false,
    outDir: 'lib',
    platform: 'browser',
    target: 'es2022',
    sourcemap: true,
    hash: false,
    loader: { '.css': 'text' },
    plugins: [cssAsTextPlugin],
    deps: { neverBundle: ['react'], alwaysBundle: browserAlwaysBundle },
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
    loader: { '.css': 'text' },
    plugins: [cssAsTextPlugin],
    deps: { neverBundle: ['react'], alwaysBundle: browserAlwaysBundle },
    outExtensions: () => ({ dts: '.d.ts', js: '.cjs' }),
  },
])
