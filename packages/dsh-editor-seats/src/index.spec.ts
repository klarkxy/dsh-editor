import { describe, expect, it, vi } from 'vitest'
import {
  createCommandRegistry,
  createMessageCardRegistry,
  matchRegistryShortcut,
  registryPaletteItems,
  shortcutMatches,
  type ShellCommand,
  type ShellToolSeatContext,
} from './index.ts'

function seat(extra: Partial<ShellToolSeatContext> = {}): ShellToolSeatContext {
  return {
    sessionId: 's1',
    activePath: '正文/001.md',
    editorDirty: false,
    treeRevision: 1,
    contentRevision: 1,
    locale: 'zh',
    openDocument: vi.fn(),
    onApplied: vi.fn(),
    note: vi.fn(),
    revealSidebar: vi.fn(),
    refresh: vi.fn(),
    expandTreePath: vi.fn(),
    highlightTreePath: vi.fn(),
    pinnedPath: null,
    togglePin: vi.fn(),
    ProposalCard: () => null,
    ...extra,
  }
}

const sample: ShellCommand = {
  id: 'proofread-document',
  group: 'writing',
  label: { zh: '校对当前文档', en: 'Proofread current document' },
  hint: { zh: 'Ctrl+Shift+L · 标点、错别字、敏感词、重复与口癖', en: 'Ctrl+Shift+L' },
  shortcut: { key: 'l', ctrl: true, shift: true },
  when: 'workspace',
  enabled: (context) => Boolean(context.activePath),
  run: vi.fn(),
}

describe('shell command registry', () => {
  it('registers, lists, notifies, and disposes uniquely', () => {
    const registry = createCommandRegistry()
    const listener = vi.fn()
    const stop = registry.subscribe(listener)
    const dispose = registry.register(sample)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(registry.list()).toEqual([sample])
    expect(() => registry.register({ ...sample, run: vi.fn() })).toThrow(/duplicate shell command id: proofread-document/)
    dispose()
    expect(registry.list()).toEqual([])
    expect(listener).toHaveBeenCalledTimes(2)
    stop()
    registry.register({ ...sample, id: 'other', run: vi.fn() })
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('matches Ctrl/Cmd+Shift+L like workspaceShortcut and runs the palette item', () => {
    const context = seat()
    const run = vi.fn()
    const command = { ...sample, run }
    expect(shortcutMatches(command.shortcut!, { key: 'l', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true })).toBe(true)
    expect(shortcutMatches(command.shortcut!, { key: 'l', ctrlKey: false, metaKey: true, altKey: false, shiftKey: true })).toBe(true)
    expect(shortcutMatches(command.shortcut!, { key: 'l', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe(false)
    expect(matchRegistryShortcut([command], { key: 'l', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true })).toBe(command)

    const [item] = registryPaletteItems([command], 'zh', context, true)
    expect(item).toMatchObject({ id: 'proofread-document', group: 'writing', label: '校对当前文档', disabled: false })
    item!.run()
    expect(context.revealSidebar).toHaveBeenCalled()
    expect(run).toHaveBeenCalledWith(context)

    const empty = seat({ activePath: '' })
    const [disabled] = registryPaletteItems([command], 'zh', empty, true)
    expect(disabled?.disabled).toBe(true)
    disabled!.run()
    expect(run).toHaveBeenCalledTimes(1)
  })
})

describe('shell message-card registry', () => {
  it('registers, gets, notifies, and disposes uniquely', () => {
    const registry = createMessageCardRegistry()
    const listener = vi.fn()
    const stop = registry.subscribe(listener)
    const card = { toolName: 'novel_memory_update', render: () => null }
    const dispose = registry.register(card)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(registry.get('novel_memory_update')).toBe(card)
    expect(registry.get('read')).toBeUndefined()
    expect(() => registry.register({ ...card, render: () => null })).toThrow(/duplicate message card toolName: novel_memory_update/)
    dispose()
    expect(registry.get('novel_memory_update')).toBeUndefined()
    expect(listener).toHaveBeenCalledTimes(2)
    stop()
    registry.register({ ...card, render: () => null })
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
