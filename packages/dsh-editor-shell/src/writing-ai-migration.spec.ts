import { AiServicesRuntime } from '../../dsh-ai-services/src/service.ts'
import type { AiPolicy } from '@klarkxy/dsh-ai-services/contracts'
import { describe, expect, it } from 'vitest'
import { legacyWritingTargets, importWritingModels } from './writing-ai-migration.ts'
describe('legacy writing route import', () => {
  it('retains explicit models, suppresses old off effort and uses tiers for empty settings', () => {
    expect(legacyWritingTargets({ completionModel: { provider: ' p ', model: ' m ', reasoningEffort: 'off' } })).toEqual({
      'manuscript.completion': { kind: 'model', provider: 'p', model: 'm' }, 'manuscript.rewrite': { kind: 'role', role: 'normal' },
    })
  })
  it('does not silently repair an incomplete legacy model into session', () => {
    expect(legacyWritingTargets({ rewriteModel: { provider: 'p', model: '' } })['manuscript.rewrite']).toEqual({ kind: 'model', provider: 'p', model: '' })
  })
})

it('seeds the chat tier from legacy settings once and preserves later user choices', async () => {
  let stored: AiPolicy | undefined
  const ai = new AiServicesRuntime({ llm: {} as any, store: { savePolicy: async policy => { stored = policy }, saveReceipts: async () => {} } })
  const legacy = { provider: 'custom', model: 'old-chat', reasoningEffort: 'off' }
  await importWritingModels(ai, { chatModel: legacy }, { provider: 'host', model: 'fallback' })
  expect(stored?.roles.normal).toEqual(legacy)
  expect(stored?.purposes.chat).toEqual({ kind: 'role', role: 'normal' })
  const { revision, ...policy } = ai.getPolicy()
  await ai.updatePolicy({ ...policy, roles: { normal: { provider: 'new', model: 'new-chat' } } }, revision)
  await importWritingModels(ai, { chatModel: legacy })
  expect(ai.getPolicy().roles.normal?.model).toBe('new-chat')
  await ai.dispose()
})
it('preserves a different legacy chat choice when a shared chat tier already exists', async () => {
  const ai = new AiServicesRuntime({ llm: {} as any, store: { savePolicy: async () => {}, saveReceipts: async () => {} } })
  const { revision, ...policy } = ai.getPolicy()
  const normal = { provider: 'configured', model: 'shared' }
  await ai.updatePolicy({ ...policy, roles: { normal } }, revision)
  await importWritingModels(ai, { chatModel: { provider: 'legacy', model: 'chat', reasoningEffort: 'high' } })
  expect(ai.getPolicy().roles.normal).toEqual(normal)
  expect(ai.getPolicy().purposes.chat).toEqual({ kind: 'model', provider: 'legacy', model: 'chat', reasoningEffort: 'high' })
  await ai.dispose()
})
it('initializes a new installation from the host default without inventing model IDs or efforts', async () => {
  const ai = new AiServicesRuntime({ llm: {} as any, store: { savePolicy: async () => {}, saveReceipts: async () => {} } })
  await importWritingModels(ai, {}, { provider: 'host', model: 'available', reasoningEffort: 'low' })
  expect(ai.getPolicy().roles.normal).toEqual({ provider: 'host', model: 'available', reasoningEffort: 'low' })
  expect(ai.getPolicy().purposes['manuscript.completion']).toEqual({ kind: 'role', role: 'weak' })
  expect(ai.getPolicy().purposes['manuscript.rewrite']).toEqual({ kind: 'role', role: 'normal' })
  await ai.dispose()
})
