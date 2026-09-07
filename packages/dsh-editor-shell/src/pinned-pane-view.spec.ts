import { describe, expect, it } from 'vitest'
import type { CharacterCardFields, WorldbookCardFields } from 'dsh-editor-workbench/contracts'
import {
  canPinPath,
  characterPinnedFields,
  pinnedLayoutColumns,
  pinnedPaneKind,
  validatePinnedPath,
  worldbookPinnedFields,
} from './pinned-pane-view.ts'

describe('pinned-pane-view', () => {
  it('classifies card, worldbook, chapter, and other text paths', () => {
    expect(pinnedPaneKind('人物卡/林冲.md')).toBe('card')
    expect(pinnedPaneKind('世界书/汴京.md')).toBe('worldbook')
    expect(pinnedPaneKind('正文/001.md')).toBe('chapter')
    expect(pinnedPaneKind('正文/第一卷/003.txt')).toBe('chapter')
    expect(pinnedPaneKind('大纲/总纲.md')).toBe('text')
    expect(pinnedPaneKind('notes.txt')).toBe('text')
  })

  it('allows pinning visible markdown and text files only', () => {
    expect(canPinPath('正文/001.md')).toBe(true)
    expect(canPinPath('人物卡/主角.md')).toBe(true)
    expect(canPinPath('世界书/港口.txt')).toBe(true)
    expect(canPinPath('大纲/总纲.md')).toBe(true)
    expect(canPinPath('封面.jpg')).toBe(false)
    expect(canPinPath('.dsh-editor/作品索引.md')).toBe(false)
    expect(canPinPath('正文')).toBe(false)
  })

  it('keeps the current three-track template when the pinned pane is hidden', () => {
    expect(pinnedLayoutColumns({
      sidebarVisible: true,
      sidebarWidth: 248,
      pinnedVisible: false,
      pinnedWidth: 340,
      assistantVisible: true,
      assistantWidth: 384,
    })).toBe('248px 7px minmax(420px,1fr) 7px 384px')
    expect(pinnedLayoutColumns({
      sidebarVisible: false,
      sidebarWidth: 248,
      pinnedVisible: false,
      pinnedWidth: 340,
      assistantVisible: false,
      assistantWidth: 384,
    })).toBe('minmax(420px,1fr)')
    expect(pinnedLayoutColumns({
      sidebarVisible: true,
      sidebarWidth: 200,
      pinnedVisible: false,
      pinnedWidth: 340,
      assistantVisible: false,
      assistantWidth: 384,
    })).toBe('200px 7px minmax(420px,1fr)')
  })

  it('inserts the pinned track between the manuscript and the assistant', () => {
    expect(pinnedLayoutColumns({
      sidebarVisible: true,
      sidebarWidth: 248,
      pinnedVisible: true,
      pinnedWidth: 340,
      assistantVisible: true,
      assistantWidth: 384,
    })).toBe('248px 7px minmax(420px,1fr) 7px 340px 7px 384px')
    expect(pinnedLayoutColumns({
      sidebarVisible: false,
      sidebarWidth: 248,
      pinnedVisible: true,
      pinnedWidth: 260,
      assistantVisible: false,
      assistantWidth: 384,
    })).toBe('minmax(420px,1fr) 7px 260px')
  })

  it('keeps a stored pin only when the path is still in the tree', () => {
    const tree = ['正文/001.md', '人物卡/林冲.md', '大纲/总纲.md']
    expect(validatePinnedPath('人物卡/林冲.md', tree)).toBe('人物卡/林冲.md')
    expect(validatePinnedPath('正文/缺失.md', tree)).toBeNull()
    expect(validatePinnedPath('封面.jpg', tree)).toBeNull()
    expect(validatePinnedPath(null, tree)).toBeNull()
    expect(validatePinnedPath('', tree)).toBeNull()
    expect(validatePinnedPath('人物卡/林冲.md', [])).toBeNull()
  })

  it('maps parsed card fields onto definition-list rows without re-parsing YAML', () => {
    const character: CharacterCardFields = {
      name: '林冲',
      aliases: ['豹子头'],
      role: '禁军教头',
      faction: '梁山',
      relations: [{ to: '鲁智深', kind: '兄弟' }],
      summary: '风雪山神庙',
    }
    expect(characterPinnedFields(character)).toEqual([
      { label: 'cards.name', value: '林冲' },
      { label: 'cards.aliases', value: '豹子头' },
      { label: 'cards.role', value: '禁军教头' },
      { label: 'cards.faction', value: '梁山' },
      { label: 'cards.relations', value: '鲁智深 · 兄弟' },
      { label: 'cards.summary', value: '风雪山神庙' },
    ])
    const worldbook: WorldbookCardFields = {
      triggers: ['汴京', '东京'],
      category: '地点',
      priority: 8,
      tags: ['水系'],
      summary: '都城',
    }
    expect(worldbookPinnedFields(worldbook).map((row) => row.label)).toEqual([
      'cards.triggers',
      'cards.category',
      'cards.priorityField',
      'cards.tags',
      'cards.summary',
    ])
  })
})
