import { describe, expect, it } from 'vitest'
import {
  BODY_DIR,
  defaultExportSelection,
  dirSelectionState,
  groupExportDocuments,
  setDirSelection,
  setDocSelection,
} from './export-selection.ts'

const DOCS = [
  '正文/第十章.md',
  '正文/第九章.md',
  '正文/第二章.md',
  '正文/第一章.md',
  '番外/第一章.md',
  'README.md',
]

describe('groupExportDocuments', () => {
  it('按目录分组且目录内走自然排序（第二章在第一章后、第十章在第九章后）', () => {
    const groups = groupExportDocuments(DOCS)
    const body = groups.find((group) => group.dir === BODY_DIR)
    expect(body?.paths).toEqual(['正文/第一章.md', '正文/第二章.md', '正文/第九章.md', '正文/第十章.md'])
  })

  it('根目录散文件进空目录组', () => {
    const groups = groupExportDocuments(DOCS)
    const root = groups.find((group) => group.dir === '')
    expect(root?.paths).toEqual(['README.md'])
  })
})

describe('defaultExportSelection', () => {
  it('有「正文」目录时默认只勾正文（含其子目录）', () => {
    const groups = groupExportDocuments([...DOCS, '正文/卷二/第一章.md'])
    const selected = defaultExportSelection(groups)
    expect([...selected].sort()).toEqual(['正文/第一章.md', '正文/卷二/第一章.md', '正文/第二章.md', '正文/第九章.md', '正文/第十章.md'].sort())
    expect(selected.has('番外/第一章.md')).toBe(false)
    expect(selected.has('README.md')).toBe(false)
  })

  it('没有「正文」目录时默认全选', () => {
    const groups = groupExportDocuments(['番外/第一章.md', '设定.md'])
    const selected = defaultExportSelection(groups)
    expect(selected.size).toBe(2)
  })
})

describe('dirSelectionState', () => {
  const group = { dir: BODY_DIR, paths: ['正文/第一章.md', '正文/第二章.md'] }

  it('全选 / 全不选 / 部分三态', () => {
    expect(dirSelectionState(group, new Set())).toBe(false)
    expect(dirSelectionState(group, new Set(group.paths))).toBe(true)
    expect(dirSelectionState(group, new Set(['正文/第一章.md']))).toBe('indeterminate')
  })
})

describe('selection updates', () => {
  it('目录勾选切换整组,取消单个文档返回三态', () => {
    const group = { dir: BODY_DIR, paths: ['正文/第一章.md', '正文/第二章.md'] }
    let selected = setDirSelection(group, new Set(), true)
    expect(dirSelectionState(group, selected)).toBe(true)
    selected = setDocSelection(selected, '正文/第一章.md', false)
    expect(dirSelectionState(group, selected)).toBe('indeterminate')
    expect(selected.has('正文/第二章.md')).toBe(true)
  })
})
