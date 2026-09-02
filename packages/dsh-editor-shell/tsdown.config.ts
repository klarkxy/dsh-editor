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
    deps: {
      neverBundle: ['react', 'react-dom', 'react/jsx-runtime'],
      alwaysBundle: [
        'dsh-editor-workbench/contracts',
        'dsh-editor-novel-kernel/contracts',
        'dsh-manuscript/client/editor-core',
        // cmdk + @radix-ui/react-dialog 没有自己的 CSS,tsdown 默认会把
        // package.json 里的 production dep 当 external,所以必须显式列进
        // alwaysBundle,让它们进 bundle 而不是运行时 require。
        'cmdk',
        '@radix-ui/react-dialog',
        // CodeMirror 6 是 dsh-manuscript 的 production dep,tsdown 默认会把它
        // 当 external;宿主运行时只认登记的模块,运行到 require 就 throw,
        // 所以必须显式打进 bundle(与上面 cmdk 同理)。
        '@codemirror/state',
        '@codemirror/view',
        '@codemirror/commands',
        '@codemirror/language',
        '@lezer/markdown',
        '@lezer/highlight',
      ],
    },
    outExtensions: () => ({ dts: '.d.ts', js: '.cjs' }),
  },
])
