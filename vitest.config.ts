import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.spec.ts', 'packages/*/test/**/*.spec.ts'],
  },
})
