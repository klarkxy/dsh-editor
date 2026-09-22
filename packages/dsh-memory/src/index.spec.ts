import { expect, it } from 'vitest'
import { createPluginUserMessage } from './index.ts'
import { MEMORY_ACTIVATE_ID, MEMORY_PLUGIN } from './contracts.ts'
import { memoryInjectPayload } from './inject.ts'
import type { MemoryRecord } from './contracts.ts'

const active: MemoryRecord = {
  id: 'p1', revision: 1, scope: { kind: 'project', projectId: '/w' }, kind: 'preference', status: 'active',
  title: '语气', content: '克制', tags: [], evidence: [], exceptions: [], source: 'user', createdAt: 1, updatedAt: 1,
}

it('uses native dsh-llm createUserMessage without a local ambient shim', () => {
  const payload = memoryInjectPayload([active])
  const message = createPluginUserMessage(payload) as {
    id: string
    role: string
    source: { kind: string; plugin: string; form: string }
  }
  expect(message.role).toBe('user')
  expect(typeof message.id).toBe('string')
  expect(message.id.length).toBeGreaterThan(0)
  expect(message.source).toMatchObject({ kind: 'plugin', plugin: '@klarkxy/dsh-memory', form: 'snapshot' })
  expect(payload).not.toHaveProperty('role')
})

it('activates the scoped plugin id now accepted by frozen pluginName', () => {
  expect(MEMORY_ACTIVATE_ID).toBe(MEMORY_PLUGIN)
})
