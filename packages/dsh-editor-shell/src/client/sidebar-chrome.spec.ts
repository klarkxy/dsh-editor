import { afterEach, describe, expect, it } from 'vitest'
import {
  isSingleManuscriptRoot,
  readSingleSidebarChoice,
  sidebarAfterManuscriptCensus,
  writeSingleSidebarChoice,
} from './sidebar-chrome.ts'

const memory = new Map<string, string>()

afterEach(() => {
  memory.clear()
  Reflect.deleteProperty(globalThis, 'localStorage')
})

describe('single-manuscript sidebar', () => {
  it('treats one visible file as a single manuscript and ignores assistant files', () => {
    expect(isSingleManuscriptRoot([{ name: '稿.md', type: 'file' }])).toBe(true)
    expect(isSingleManuscriptRoot([
      { name: '稿.md', type: 'file' },
      { name: 'AGENTS.md', type: 'file' },
      { name: '.dsh-editor', type: 'directory' },
    ])).toBe(true)
    expect(isSingleManuscriptRoot([
      { name: '稿.md', type: 'file' },
      { name: '笔记', type: 'directory' },
    ])).toBe(false)
    expect(isSingleManuscriptRoot([
      { name: '一.md', type: 'file' },
      { name: '二.md', type: 'file' },
    ])).toBe(false)
    expect(isSingleManuscriptRoot([])).toBe(false)
  })

  it('collapses until the author chooses, then restores the column when another file appears', () => {
    expect(sidebarAfterManuscriptCensus({ open: true, autoCollapsed: false, single: true, explicit: null }))
      .toEqual({ open: false, autoCollapsed: true })
    expect(sidebarAfterManuscriptCensus({ open: false, autoCollapsed: true, single: true, explicit: 'open' }))
      .toEqual({ open: true, autoCollapsed: false })
    expect(sidebarAfterManuscriptCensus({ open: true, autoCollapsed: false, single: true, explicit: 'closed' }))
      .toEqual({ open: false, autoCollapsed: false })
    expect(sidebarAfterManuscriptCensus({ open: false, autoCollapsed: true, single: false, explicit: null }))
      .toEqual({ open: true, autoCollapsed: false })
    expect(sidebarAfterManuscriptCensus({ open: false, autoCollapsed: false, single: false, explicit: null }))
      .toEqual({ open: false, autoCollapsed: false })
  })

  it('remembers a per-workspace choice', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => memory.get(key) ?? null,
        setItem: (key: string, value: string) => { memory.set(key, value) },
      },
    })
    expect(readSingleSidebarChoice('ws')).toBeNull()
    writeSingleSidebarChoice('ws', 'open')
    expect(readSingleSidebarChoice('ws')).toBe('open')
    expect(readSingleSidebarChoice(undefined)).toBeNull()
  })
})
