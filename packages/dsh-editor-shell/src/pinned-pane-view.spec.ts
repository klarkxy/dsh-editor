import { describe, expect, it } from 'vitest'
import {
  canPinPath,
  pinnedLayoutColumns,
  validatePinnedPath,
} from './pinned-pane-view.ts'

describe('pinned-pane-view', () => {
  it('allows pinning visible markdown and text files only', () => {
    expect(canPinPath('正文/001.md')).toBe(true)
    expect(canPinPath('人物卡/主角.md')).toBe(true)
    expect(canPinPath('世界书/港口.txt')).toBe(true)
    expect(canPinPath('大纲/总纲.md')).toBe(true)
    expect(canPinPath('notes.txt')).toBe(true)
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
})
