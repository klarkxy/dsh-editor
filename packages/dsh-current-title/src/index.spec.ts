import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')

describe('plugin inject', () => {
  it('waits for native title and shared services instead of capturing a one-time get', () => {
    expect(source).toContain("export const name = PLUGIN_NAME")
    expect(source).toContain("export const inject = ['sessionTitle', 'aiServices', 'sessions', 'loader', 'storageDomain', 'connection', 'webServer'] as const")
    expect(source).toContain('ctx.effect(() => async () => { await service.dispose(); await domain.close() }')
  })
})
