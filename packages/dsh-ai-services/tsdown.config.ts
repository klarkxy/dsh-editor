import { defineConfig } from 'tsdown'
export default defineConfig([
  {
    entry: { index: 'src/index.ts', contracts: 'src/contracts.ts', 'host-rpc': 'src/host-rpc.ts', 'client-utils': 'src/client-utils.ts', 'insert-output': 'src/insert-output.ts' },
    format: ['esm'], dts: true, clean: true, outDir: 'lib', platform: 'node', target: 'node22', sourcemap: true, hash: false,
    deps: { neverBundle: ['react', '@deepseek-ai/cordis', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-storage-domain'] },
    outExtensions: () => ({ dts: '.d.ts', js: '.js' }),
  },
])
