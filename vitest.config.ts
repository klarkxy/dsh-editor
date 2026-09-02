import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      'dsh-manuscript/host-api': `${root}packages/dsh-manuscript/src/host-api.ts`,
      'dsh-manuscript/client/editor-core': `${root}packages/dsh-manuscript/src/client/editor-core/index.ts`,
      'dsh-editor-workbench/contracts': `${root}packages/dsh-editor-workbench/src/contracts.ts`,
      'dsh-editor-novel-kernel/contracts': `${root}packages/dsh-editor-novel-kernel/src/contracts.ts`,
    },
  },
  test: {
    include: [
      'packages/*/src/**/*.spec.ts',
      'packages/*/test/**/*.spec.ts',
      'apps/*/src/**/*.spec.ts',
      'apps/*/test/**/*.spec.ts',
    ],
  },
})
