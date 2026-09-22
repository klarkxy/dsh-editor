import { describe, expect, it } from 'vitest'
import { AiServicesRuntime } from './service.ts'
import type { AiPolicy, ModelTarget } from './contracts.ts'
import { storedPolicySchema } from './storage.ts'

function fixture() {
  let stored: (AiPolicy & { imports?: string[] }) | undefined
  let fail = false
  const open = () => {
    const { imports = [], ...policy } = stored ?? {}
    return new AiServicesRuntime({ llm: {} as any, initialPolicy: stored ? policy as AiPolicy : undefined, initialImports: imports,
      store: { savePolicy: async (next, imports) => { if (fail) throw Error('disk'); stored = storedPolicySchema.parse({ ...next, imports }) }, saveReceipts: async () => {} } })
  }
  return { open, fail: (value: boolean) => { fail = value }, get stored() { return stored } }
}
const defaults: Record<string, ModelTarget> = { 'manuscript.completion': { kind: 'model', provider: 'old', model: 'small' }, 'manuscript.rewrite': { kind: 'session' } }
describe('atomic one-time purpose imports', () => {
  it('preserves existing central targets and does not resurrect deleted targets after restart', async () => {
    const f = fixture(); const first = f.open()
    const { revision, ...initial } = first.getPolicy()
    await first.updatePolicy({ ...initial, purposes: { 'manuscript.completion': { kind: 'session' } } }, revision)
    await first.importPurposes('writing-v1', defaults)
    expect(first.getPolicy().purposes['manuscript.completion']).toEqual({ kind: 'session' })
    expect(first.getPolicy()).not.toHaveProperty('imports')
    const { revision: current, ...policy } = first.getPolicy()
    await first.updatePolicy({ ...policy, purposes: {} }, current)
    await first.dispose()
    const reopened = f.open()
    await reopened.importPurposes('writing-v1', defaults)
    expect(reopened.getPolicy().purposes).toEqual({})
    expect(f.stored?.imports).toEqual(['writing-v1'])
    await reopened.dispose()
  })
  it('keeps both policy and marker uncommitted on failure and permits retry', async () => {
    const f = fixture(); const service = f.open(); f.fail(true)
    await expect(service.importPurposes('writing-v1', defaults)).rejects.toThrow('迁移失败')
    expect(service.getPolicy().revision).toBe(0); expect(f.stored).toBeUndefined()
    f.fail(false); await service.importPurposes('writing-v1', defaults)
    expect(service.getPolicy().revision).toBe(1)
    await service.dispose()
  })
  it('serializes import before CAS, rejects stale writers, and marks empty imports', async () => {
    const f = fixture(); const service = f.open(); const { revision, ...policy } = service.getPolicy()
    const imported = service.importPurposes('empty-v1', {})
    await expect(service.updatePolicy(policy, revision)).rejects.toThrow('其他页面修改')
    await imported
    await service.importPurposes('empty-v1', defaults)
    expect(service.getPolicy().purposes).toEqual({})
    await service.dispose()
  })
  it('rejects malformed missing legacy routes but permits recovery from central settings', async () => {
    const f = fixture(); const service = f.open()
    const invalid = { 'manuscript.completion': { kind: 'model' as const, provider: 'old', model: '' } }
    await expect(service.importPurposes('writing-v1', invalid)).rejects.toThrow('格式无效')
    const { revision, ...policy } = service.getPolicy()
    await service.updatePolicy({ ...policy, purposes: { 'manuscript.completion': { kind: 'session' } } }, revision)
    await service.importPurposes('writing-v1', invalid)
    expect(service.getPolicy().purposes['manuscript.completion']).toEqual({ kind: 'session' })
    await service.dispose()
  })
})
