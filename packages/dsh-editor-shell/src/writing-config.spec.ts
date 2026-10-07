import { describe, expect, it, vi } from 'vitest'
import type { SettingsForms } from '@deepseek-ai/dsh-settings'
import Schema from '@deepseek-ai/schemastery'
import { Config, createAuthorMemoryWriter } from './writing-config.ts'
import { AUTHOR_MEMORY_AUTO_MARKER } from './author-memory.ts'

function memorySettings(initial = '') {
  let memory = initial
  let revision = 1
  let beforeCommit: (() => Promise<void>) | undefined
  const settings = {
    writable: true,
    describe: () => [{ ns: 'dsh-editor-writing', value: { authorMemory: memory }, revision }] as ReturnType<SettingsForms['describe']>,
    mutate: vi.fn(async (_ns: string, ops: readonly { value?: unknown }[], expected?: number) => {
      await beforeCommit?.()
      if (expected !== revision) throw new Error('SETTINGS_CONFLICT')
      memory = ops[0]!.value as string
      revision += 1
    }),
  }
  return { settings, read: () => memory, edit: (value: string) => { memory = value; revision += 1 }, before: (fn: () => Promise<void>) => { beforeCommit = fn } }
}

describe('Host author-memory persistence', () => {
  it('persists without a chat client and serializes concurrent tool appends', async () => {
    const fixture = memorySettings('手写偏好')
    const remember = createAuthorMemoryWriter(fixture.settings)
    expect(await Promise.all([remember('留白优先'), remember('保留人物动机')])).toEqual(['added', 'added'])
    expect(fixture.read()).toBe(`手写偏好\n${AUTHOR_MEMORY_AUTO_MARKER}\n留白优先\n保留人物动机`)
    expect(fixture.settings.mutate.mock.calls.map(call => call[2])).toEqual([1, 2])
  })

  it('reports an existing observation without writing', async () => {
    const fixture = memorySettings(`${AUTHOR_MEMORY_AUTO_MARKER}\n留白优先`)
    expect(await createAuthorMemoryWriter(fixture.settings)('留白优先')).toBe('already-present')
    expect(fixture.settings.mutate).not.toHaveBeenCalled()
  })

  it('refuses capacity overflow instead of claiming an observation was saved', async () => {
    const head = 'x'.repeat(2_000)
    const fixture = memorySettings(head)
    await expect(createAuthorMemoryWriter(fixture.settings)('放不下')).rejects.toThrow('空间不足')
    expect(fixture.read()).toBe(head)
    expect(fixture.settings.mutate).not.toHaveBeenCalled()
  })

  it('preserves an author edit racing with a tool append', async () => {
    const fixture = memorySettings('原侧写')
    fixture.before(async () => { fixture.edit('作者的新内容') })
    await expect(createAuthorMemoryWriter(fixture.settings)('观察')).rejects.toThrow('SETTINGS_CONFLICT')
    expect(fixture.read()).toBe('作者的新内容')
  })

  it('surfaces a failed write and permits the next operation to retry', async () => {
    const fixture = memorySettings()
    const remember = createAuthorMemoryWriter(fixture.settings)
    fixture.settings.mutate.mockRejectedValueOnce(new Error('disk unavailable'))
    await expect(remember('第一条')).rejects.toThrow('disk unavailable')
    expect(fixture.read()).toBe('')
    expect(await remember('第二条')).toBe('added')
    expect(fixture.read()).toBe(`${AUTHOR_MEMORY_AUTO_MARKER}\n第二条`)
  })

  it('refuses read-only settings before a mutation', async () => {
    const fixture = memorySettings('保留')
    fixture.settings.writable = false
    await expect(createAuthorMemoryWriter(fixture.settings)('观察')).rejects.toThrow('不可写')
    expect(fixture.read()).toBe('保留')
    expect(fixture.settings.mutate).not.toHaveBeenCalled()
  })
})

describe('native writing configuration form', () => {
  it('keeps the atomic model-import fence hidden and live in the private schema', () => {
    const restored = new Schema(JSON.parse(JSON.stringify(Config.toJSON())))
    expect(restored.dict?.writingModelsImported.meta).toMatchObject({ default: false, hidden: true, volatile: true })
  })
  it('validates in the browser after a JSON roundtrip without host closures', () => {
    const wire = JSON.parse(JSON.stringify(Config.toJSON()))
    const plain = (node: any) => {
      if (node.meta) delete node.meta.volatile
      Object.values(node.dict ?? {}).forEach(plain)
      if (node.inner) plain(node.inner)
      for (const child of node.list ?? []) plain(child)
    }
    plain(wire)
    const validate = new Schema(wire)
    expect(() => validate({ authorPreferences: '保留人物动机', authorMemory: '作者已确认' })).not.toThrow()
  })
})
