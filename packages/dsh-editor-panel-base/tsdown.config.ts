import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'rpc/index': 'src/rpc/index.ts',
    'requests/index': 'src/requests/index.ts',
    'messages/index': 'src/messages/index.ts',
    'styles/index': 'src/styles/index.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
})
