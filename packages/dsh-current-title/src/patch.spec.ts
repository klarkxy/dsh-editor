import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { name: string }

describe('default-on bundle patch', () => {
  it('inserts the feature enabled and does not disable the built-in title provider', () => {
    expect(manifest.name).toBe('@klarkxy/dsh-current-title')
    expect(patch).toContain('id: current-title')
    expect(patch).toContain("name: '@klarkxy/dsh-current-title'")
    expect(patch).toMatch(/disabled:\s*false/)
    expect(patch).not.toMatch(/^- id: session-title/m)
    expect(patch).not.toContain('dsh-session-title-first-prompt-llm')
    expect(patch).not.toContain('disabled: true\n- id: session-title')
  })
})
