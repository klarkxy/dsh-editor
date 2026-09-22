import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const root = fileURLToPath(new URL('.', import.meta.url))

function cssAsTextModule(id: string): string | null {
  const file = id.split('?')[0]
  if (!file.endsWith('.css')) return null
  try {
    return `export default ${JSON.stringify(readFileSync(file, 'utf8'))}`
  } catch {
    return null
  }
}

export default defineConfig({
  plugins: [{
    name: 'css-as-text',
    enforce: 'pre',
    load(id) {
      return cssAsTextModule(id)
    },
    transform(_code, id) {
      return cssAsTextModule(id)
    },
  }],
  resolve: {
    alias: {
      "@klarkxy/dsh-ai-services/insert-output": `${root}packages/dsh-ai-services/src/insert-output.ts`,
      "@klarkxy/dsh-ai-services/client-utils": `${root}packages/dsh-ai-services/src/client-utils.ts`,
      "@klarkxy/dsh-ai-services/contracts": `${root}packages/dsh-ai-services/src/contracts.ts`,
      "@klarkxy/dsh-ai-services/host-rpc": `${root}packages/dsh-ai-services/src/host-rpc.ts`,
      "@klarkxy/dsh-ai-services": `${root}packages/dsh-ai-services/src/index.ts`,
      "@klarkxy/dsh-current-title/contracts": `${root}packages/dsh-current-title/src/contracts.ts`,
      "@klarkxy/dsh-current-title": `${root}packages/dsh-current-title/src/index.ts`,
      "@klarkxy/dsh-mood/contracts": `${root}packages/dsh-mood/src/contracts.ts`,
      "@klarkxy/dsh-mood": `${root}packages/dsh-mood/src/index.ts`,
      "@klarkxy/dsh-recap/contracts": `${root}packages/dsh-recap/src/contracts.ts`,
      "@klarkxy/dsh-recap": `${root}packages/dsh-recap/src/index.ts`,
      "@klarkxy/dsh-memory/contracts": `${root}packages/dsh-memory/src/contracts.ts`,
      "@klarkxy/dsh-memory": `${root}packages/dsh-memory/src/index.ts`,
      "@klarkxy/dsh-self-improvement/contracts": `${root}packages/dsh-self-improvement/src/contracts.ts`,
      "@klarkxy/dsh-self-improvement": `${root}packages/dsh-self-improvement/src/index.ts`,
      "@klarkxy/dsh-model-center/contracts": `${root}packages/dsh-model-center/src/contracts.ts`,
      "@klarkxy/dsh-model-center": `${root}packages/dsh-model-center/src/index.ts`,
      '@klarkxy/dsh-zhihu/usage': `${root}packages/dsh-zhihu/src/usage.ts`,
      '@klarkxy/dsh-zhihu/contracts': `${root}packages/dsh-zhihu/src/contracts.ts`,
      'dsh-proofread/engine': `${root}packages/dsh-proofread/src/engine.ts`,
      'dsh-proofread/contracts': `${root}packages/dsh-proofread/src/contracts.ts`,
      'dsh-proofread/defaults': `${root}packages/dsh-proofread/src/defaults.ts`,
      'dsh-manuscript/host-api': `${root}packages/dsh-manuscript/src/host-api.ts`,
      'dsh-manuscript/client/editor-core': `${root}packages/dsh-manuscript/src/client/editor-core/index.ts`,
      'dsh-editor-workbench/contracts': `${root}packages/dsh-editor-workbench/src/contracts.ts`,
      'dsh-editor-workbench/tools': `${root}packages/dsh-editor-workbench/src/tools.ts`,
      'dsh-editor-workbench': `${root}packages/dsh-editor-workbench/src/index.ts`,
      'dsh-editor-seats/tokens': `${root}packages/dsh-editor-seats/src/tokens.ts`,
      'dsh-editor-seats/seat-button': `${root}packages/dsh-editor-seats/src/seat-button.tsx`,
      'dsh-editor-seats': `${root}packages/dsh-editor-seats/src/index.ts`,
      'dsh-editor-shell/seats': `${root}packages/dsh-editor-shell/src/seats.ts`,
      'dsh-editor-novel-kernel/contracts': `${root}packages/dsh-editor-novel-kernel/src/contracts.ts`,
    },
  },
  test: {
    watch: false,
    include: [
      'packages/*/src/**/*.spec.ts',
      'packages/*/test/**/*.spec.ts',
      'apps/*/src/**/*.spec.ts',
      'apps/*/test/**/*.spec.ts',
      'scripts/**/*.spec.mjs',
    ],
  },
})
