import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsdown'

const shim = (name: string) => fileURLToPath(new URL(`./src/client/shims/${name}.ts`, import.meta.url))
const requireFromShell = createRequire(fileURLToPath(new URL('./package.json', import.meta.url)))

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
    const file = /^[A-Za-z]:[\\/]/.test(spec) || spec.startsWith('/') ? spec : requireFromShell.resolve(spec)
    return `export default ${JSON.stringify(readFileSync(file, 'utf8'))}`
  },
}

export default defineConfig([
  {
    entry: { index: 'src/index.ts', seats: 'src/seats.ts', 'writing-config': 'src/writing-config.ts', 'developer-config': 'src/developer-config.ts', 'limit-break-config': 'src/limit-break-config.ts' },
    format: ['esm'],
    dts: true,
    clean: true,
    outDir: 'lib',
    platform: 'node',
    target: 'node22',
    sourcemap: true,
    hash: false,
    deps: { alwaysBundle: ['dsh-editor-seats'] },
    outExtensions: () => ({ dts: '.d.ts', js: '.js' }),
  },
  {
    entry: { 'client.inner': 'src/client.ts' },
    format: ['cjs'],
    dts: false,
    clean: false,
    outDir: 'lib',
    platform: 'browser',
    target: 'es2022',
    sourcemap: true,
    hash: false,
    /* motion 源文件带 RSC 的 "use client"。本包是浏览器 CJS,关掉这条检查。 */
    checks: { moduleLevelDirective: false },
    loader: { '.css': 'text', '.webp': 'dataurl' },
    plugins: [cssAsTextPlugin],
    /* react-markdown 依赖链(unified → vfile/min*)会在模块加载期 require
       node:process/node:path/node:url;DSH 插件运行时的模块表不提供它们,
       构建期改写为 src/client/shims 下的浏览器替身(见 shims/*.ts)。 */
    alias: {
      'node:process': shim('node-process'),
      'node:path': shim('node-path'),
      'node:url': shim('node-url'),
    },
    deps: {
      neverBundle: ['react', 'react-dom', 'react/jsx-runtime'],
      alwaysBundle: [
        '@deepseek-ai/dsh-util-workspace-path',
        'dsh-editor-seats',
        'dsh-editor-workbench/contracts',
        'dsh-editor-novel-kernel/contracts',
        'dsh-manuscript/client/editor-core',
        // cmdk + @radix-ui/react-dialog 没有自己的 CSS,tsdown 默认会把
        // package.json 里的 production dep 当 external,所以必须显式列进
        // alwaysBundle,让它们进 bundle 而不是运行时 require。
        'cmdk',
        'react-markdown',
        'remark-gfm',
        'react-resizable-panels',
        '@radix-ui/react-dialog',
        '@radix-ui/react-select',
        '@radix-ui/react-dropdown-menu',
        '@radix-ui/react-tooltip',
        '@radix-ui/react-tabs',
        '@radix-ui/react-alert-dialog',
        '@radix-ui/react-switch',
        '@radix-ui/react-checkbox',
        '@radix-ui/react-radio-group',
        '@radix-ui/react-toggle-group',
        '@radix-ui/react-slider',
        '@radix-ui/react-popover',
        '@radix-ui/react-context-menu',
        '@radix-ui/react-collapsible',
        '@radix-ui/react-visually-hidden',
        '@radix-ui/react-slot',
        '@radix-ui/themes',
        '@radix-ui/themes/styles.css',
        'motion',
        'motion/react',
        // CodeMirror 6 是 dsh-manuscript 的 production dep,tsdown 默认会把它
        // 当 external;宿主运行时只认登记的模块,运行到 require 就 throw,
        // 所以必须显式打进 bundle(与上面 cmdk 同理)。
        '@codemirror/state',
        '@codemirror/view',
        '@codemirror/commands',
        '@codemirror/language',
        '@lezer/markdown',
        '@lezer/highlight',
        // docx / jszip are production deps used by the renderer export dialog.
        // tsdown would otherwise leave them as runtime require() calls.
        'docx',
        'jszip',
        // diff 是提案行级 diff 的 production dep,同样必须打进 bundle。
        'diff',
        /^echarts(?:\/|$)/,
        /^zrender(?:\/|$)/,
      ],
    },
    outExtensions: () => ({ dts: '.d.ts', js: '.cjs' }),
  },
])
