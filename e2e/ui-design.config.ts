import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsdown'

const root = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url))
const requireFromShell = createRequire(root('packages/dsh-editor-shell/package.json'))
export default defineConfig({
  entry: { preview: root('packages/dsh-editor-shell/fixtures/design-system.tsx') },
  format: ['esm'], platform: 'browser', target: 'es2022',
  outDir: root('.artifacts/ui-design'), clean: true, hash: false, dts: false,
  deps: { alwaysBundle: [/.*/] },
  plugins: [{
    name: 'ui-preview-css-as-text',
    resolveId(id: string) { if (id.endsWith('.css')) return `\0ui-css:${id}.as-text` },
    load(id: string) {
      if (!id.startsWith('\0ui-css:')) return
      const spec = id.slice('\0ui-css:'.length, -'.as-text'.length)
      return `export default ${JSON.stringify(readFileSync(requireFromShell.resolve(spec), 'utf8'))}`
    },
  }],
})
