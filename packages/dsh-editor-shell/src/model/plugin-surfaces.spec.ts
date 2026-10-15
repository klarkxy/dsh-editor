import { describe, expect, it } from 'vitest'
import type { ShellCommand } from '../seats.ts'
import { toolLaunchers, type SlotEntry } from './plugin-surfaces.ts'

function command(partial: Partial<ShellCommand> & { id: string }): ShellCommand {
  return {
    group: 'writing',
    label: { zh: partial.id, en: partial.id },
    run() { /* spec doubles never run */ },
    ...partial,
  }
}

describe('toolLaunchers', () => {
  const memoryEntry: SlotEntry = { options: { id: 'memory', order: 200, label: '记忆' } }

  it('pairs each tool contribution with its `${id}-open` command', () => {
    const rows = toolLaunchers([memoryEntry], [
      command({
        id: 'memory-open',
        label: { zh: '记忆维护', en: 'Memory maintenance' },
        hint: { zh: '查看维护记录', en: 'Review updates' },
      }),
    ], 'zh')
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('memory')
    expect(rows[0].label).toBe('记忆维护')
    expect(rows[0].hint).toBe('查看维护记录')
    expect(rows[0].command.id).toBe('memory-open')
  })

  it('falls back to the slot label and a bare `${id}` command', () => {
    const rows = toolLaunchers([{ options: { id: 'stats', label: '统计' } }], [
      command({ id: 'stats', label: { zh: '', en: 'Stats' } }),
    ], 'zh')
    expect(rows[0].label).toBe('统计')
    expect(rows[0].hint).toBeUndefined()
    expect(rows[0].command.id).toBe('stats')
  })

  it('skips contributions without an open command and duplicate ids', () => {
    const rows = toolLaunchers([
      memoryEntry,
      { options: { id: 'ghost', label: '幽灵' } },
      { options: { id: 'memory', order: 300, label: '重复' } },
      { options: { label: '无名' } },
    ], [command({ id: 'memory-open', label: { zh: '记忆维护', en: 'Memory' } })], 'en')
    expect(rows.map((row) => row.id)).toEqual(['memory'])
    expect(rows[0].label).toBe('Memory')
  })

  it('orders launchers by slot order then registration index', () => {
    const rows = toolLaunchers([
      { options: { id: 'b', order: 300 } },
      { options: { id: 'a', order: 100 } },
    ], [command({ id: 'b-open' }), command({ id: 'a-open' })], 'zh')
    expect(rows.map((row) => row.id)).toEqual(['a', 'b'])
  })
})
