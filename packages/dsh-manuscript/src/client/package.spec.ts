import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const pkg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../package.json'), 'utf8'),
) as {
  exports: Record<string, unknown>
  dsh: { client: { platform: string; inject?: string[] } }
}

describe('dsh-manuscript client discovery', () => {
  it('exports ./package.json so DSH can scan dsh.client', () => {
    expect(pkg.exports['./package.json']).toBe('./package.json')
    expect(pkg.exports['./client']).toBeTruthy()
    expect(pkg.dsh.client.platform).toBe('web')
    expect(pkg.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-layout')
  })
})
