import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    chrome: 'src/chrome.tsx',
    'rpc/index': 'src/rpc/index.ts',
    'requests/index': 'src/requests/index.ts',
    'messages/index': 'src/messages/index.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  /* 比较器打进 dist，客户端不再在运行时 require workspace-kit。 */
  deps: { alwaysBundle: ['dsh-editor-workspace-kit/natural-order'] },
})
