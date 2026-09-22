import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseEdit, parseModeUpdate } from './schema.ts'
import { contractMessageInput, createMoodContextMessage } from './inject.ts'
import { MOOD_PLUGIN } from './contracts.ts'

describe('storage and inject shapes', () => {
  it('rejects unknown mode and empty edits', () => {
    expect(parseModeUpdate({ expectedRevision: 0, mode: 'auto' })).toEqual({ expectedRevision: 0, mode: 'auto' })
    expect(parseModeUpdate({ expectedRevision: 0, mode: 'off' })).toBeUndefined()
    expect(parseEdit({ sessionId: 's', expectedRevision: 0, patch: {} })).toBeUndefined()
    expect(parseEdit({ sessionId: 's', expectedRevision: 0, patch: { goal: '改' } })?.patch.goal).toBe('改')
  })

  it('builds plugin-source context with pinned createUserMessage, not a synthetic human prompt', () => {
    const input = contractMessageInput('约定')
    expect(input.source).toMatchObject({ kind: 'plugin', plugin: MOOD_PLUGIN, form: 'snapshot' })
    const message = createMoodContextMessage('约定') as { id: string; role: string; source?: { kind?: string; plugin?: string } }
    expect(message.source?.kind).toBe('plugin')
    expect(message.source?.plugin).toBe(MOOD_PLUGIN)
    expect(message.role).toBe('user')
    expect(message.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })

  it('ships the feature insert enabled', () => {
    const text = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../cordis.patch.yml'), 'utf8')
    expect(text).toContain('disabled: false')
    expect(text).toContain('@klarkxy/dsh-mood')
  })
})
