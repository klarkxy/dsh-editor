import { describe, expect, it, vi } from 'vitest'
import type { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import type { SettingsForms } from '@deepseek-ai/dsh-settings'
import { importWritingModels, legacyWritingRoutes, NATIVE_WRITING_IMPORT } from './writing-ai-migration.ts'

function fixture(policy?: any) {
  let saved = policy
  let user: any = { authorPreferences: '保留作者偏好', fontSize: 20 }
  const put = vi.fn(async (_key, value) => { saved = value })
  const receipts = { items: [{ id: 'historical-receipt', status: 'success', purpose: 'chat' }] }
  const putReceipts = vi.fn()
  const close = vi.fn(async () => {})
  const storage = { open: vi.fn(async () => ({ table: (name: string) => name === 'policy' ? { get: () => saved, put } : { get: () => receipts, put: putReceipts }, close })) } as unknown as DomainFacility
  const mutate = vi.fn(async (_namespace, ops) => { for (const op of ops) user = { ...user, [op.path[0]]: op.value } })
  const settings = { writable: true, describe: () => [{ ns: 'dsh-editor-writing', revision: 3, user }], mutate } as unknown as Pick<SettingsForms, 'describe' | 'mutate' | 'writable'>
  return { storage, settings, put, close, mutate, receipts, putReceipts, saved: () => saved, user: () => user }
}
describe('retired policy import to native writing settings', () => {
  it('recovers explicit and role-bound routes and preserves none as thinking off', () => {
    expect(legacyWritingRoutes({ roles: { normal: { provider: 'p', model: 'normal' } }, purposes: { chat: { kind: 'role', role: 'normal' }, 'manuscript.completion': { kind: 'model', provider: ' p ', model: ' m ', reasoningEffort: 'none' }, 'manuscript.rewrite': { kind: 'session' } } })).toEqual({ chatModel: { provider: 'p', model: 'normal' }, completionModel: { provider: 'p', model: 'm', reasoningEffort: 'off' }, rewriteModel: { provider: '', model: '', reasoningEffort: '' } })
  })
  it('keeps absent purpose preferences and leaves new installations untouched', async () => {
    expect(legacyWritingRoutes({ roles: {}, purposes: {} })).toEqual({})
    const f = fixture()
    await importWritingModels(f.storage, f.settings)
    expect(f.mutate).not.toHaveBeenCalled()
    expect(f.put).not.toHaveBeenCalled()
    expect(f.close).toHaveBeenCalledOnce()
  })
  it('commits only model fields before the durable marker and preserves historical data', async () => {
    const old = { roles: {}, purposes: { chat: { kind: 'model', provider: 'p', model: 'chat' } }, limits: { concurrency: 2 }, revision: 4, imports: ['legacy'] }
    const f = fixture(old)
    await importWritingModels(f.storage, f.settings)
    expect(f.mutate).toHaveBeenCalledWith('dsh-editor-writing', [
      { op: 'set', path: ['chatModel'], value: { provider: 'p', model: 'chat' } },
      { op: 'set', path: ['writingModelsImported'], value: true },
    ], 3)
    expect(f.user()).toEqual({ authorPreferences: '保留作者偏好', fontSize: 20, chatModel: { provider: 'p', model: 'chat' }, writingModelsImported: true })
    expect(f.saved()).toEqual({ ...old, imports: ['legacy', NATIVE_WRITING_IMPORT] })
    expect(f.mutate.mock.invocationCallOrder[0]).toBeLessThan(f.put.mock.invocationCallOrder[0]!)
    await importWritingModels(f.storage, f.settings)
    expect(f.mutate).toHaveBeenCalledOnce()
  })
  it('does not mark an uncommitted native write or conflict imported and always closes storage', async () => {
    const f = fixture({ roles: {}, purposes: { chat: { kind: 'model', provider: 'p', model: 'chat' } } })
    f.mutate.mockRejectedValueOnce(new Error('conflict'))
    await expect(importWritingModels(f.storage, f.settings)).rejects.toThrow('conflict')
    expect(f.put).not.toHaveBeenCalled()
    expect(f.close).toHaveBeenCalledOnce()
    f.mutate.mockImplementationOnce(async () => {})
    await expect(importWritingModels(f.storage, f.settings)).rejects.toThrow('落盘')
    expect(f.put).not.toHaveBeenCalled()
  })
  it('lets the historical authoritative route win over stale native fields on the first import', async () => {
    const f = fixture({ roles: {}, purposes: { chat: { kind: 'model', provider: 'historical', model: 'latest-policy-choice' } } })
    f.user().chatModel = { provider: 'stale', model: 'old-native-choice' }
    await importWritingModels(f.storage, f.settings)
    expect(f.user().chatModel).toEqual({ provider: 'historical', model: 'latest-policy-choice' })
    expect(f.user().writingModelsImported).toBe(true)
  })
  it('never restores a route the author clears after a completed import', async () => {
    const f = fixture({ roles: {}, purposes: { chat: { kind: 'model', provider: 'p', model: 'chat' } } })
    await importWritingModels(f.storage, f.settings)
    await f.settings.mutate('dsh-editor-writing', [{ op: 'set', path: ['chatModel'], value: { provider: '', model: '', reasoningEffort: '' } }])
    await importWritingModels(f.storage, f.settings)
    expect(f.user().chatModel).toEqual({ provider: '', model: '', reasoningEffort: '' })
    expect(f.mutate).toHaveBeenCalledTimes(2)
  })
  it.each([
    { provider: 'new-provider', model: 'author-choice', reasoningEffort: 'off' },
    { provider: '', model: '', reasoningEffort: '' },
  ])('preserves later author choice %j when the old marker fails and import retries', async (choice) => {
    const old = { roles: {}, purposes: { chat: { kind: 'model', provider: 'p', model: 'old-chat' } }, limits: { concurrency: 2 }, imports: ['earlier'] }
    const f = fixture(old)
    const originalReceipts = structuredClone(f.receipts)
    f.put.mockRejectedValueOnce(new Error('old marker storage failure'))
    await expect(importWritingModels(f.storage, f.settings)).rejects.toThrow('old marker storage failure')
    expect(f.user().writingModelsImported).toBe(true)
    expect(f.saved()).toEqual(old)
    await f.settings.mutate('dsh-editor-writing', [{ op: 'set', path: ['chatModel'], value: choice }])
    await importWritingModels(f.storage, f.settings)
    expect(f.user().chatModel).toEqual(choice)
    expect(f.mutate).toHaveBeenCalledTimes(2)
    expect(f.saved()).toEqual({ ...old, imports: ['earlier', NATIVE_WRITING_IMPORT] })
    expect(f.receipts).toEqual(originalReceipts)
    expect(f.putReceipts).not.toHaveBeenCalled()
    expect(f.close).toHaveBeenCalledTimes(2)
  })
  it('rejects broken explicit routes rather than silently converting them to defaults', () => {
    expect(() => legacyWritingRoutes({ roles: {}, purposes: { chat: { kind: 'model', provider: 'p', model: '' } } })).toThrow('缺少')
  })
})
