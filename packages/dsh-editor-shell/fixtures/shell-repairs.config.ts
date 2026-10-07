import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsdown'
const root = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url))
const requireFromShell = createRequire(root('packages/dsh-editor-shell/package.json'))
export default defineConfig({
  entry: { preview: root('packages/dsh-editor-shell/fixtures/shell-repairs.tsx') },
  format: ['esm'], platform: 'browser', target: 'es2022',
  inputOptions: { moduleTypes: { '.webp': 'dataurl', '.png': 'dataurl' } },
  outDir: root('.artifacts/shell-repairs'), clean: false, hash: false, dts: false,
  deps: { alwaysBundle: [/.*/], onlyBundle: false },
  plugins: [{ name: 'css-as-text',
    resolveId(id: string) { if (id.endsWith('.css')) return `\0ui-css:${id}.as-text` },
    load(id: string) {
      if (id.startsWith('\0ui-css:')) return `export default ${JSON.stringify(readFileSync(requireFromShell.resolve(id.slice(8, -8)), 'utf8'))}`
      if (process.env.SHELL_REPAIRS_BEFORE === '1' && /\/src\/client\/(settings-models|chat-model-picker)\.tsx$/.test(id.replaceAll('\\', '/'))) {
        const path = id.replaceAll('\\', '/').slice(id.replaceAll('\\', '/').indexOf('packages/'))
        const result = spawnSync('git', ['show', `185b927:${path}`], { cwd: root(''), encoding: 'utf8' })
        if (result.status !== 0) throw new Error(result.stderr)
        return result.stdout
      }
    },
  }],
})
