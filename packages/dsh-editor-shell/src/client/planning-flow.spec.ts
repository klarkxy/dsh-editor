import { describe, expect, it } from 'vitest'
import { zh } from '../i18n/index.ts'
import { errorMessage, errorReason, isStaleFailure, proposalAppliedNavigation, worldbookPaperProjection } from './shared.ts'
import { buildExpectedVersions, unwrapWorkbenchPrepared } from './chat.ts'

describe('planning proposal prepare unwrap', () => {
  const createProposal = { marker: 'dsh-editor.proposal', version: 1, kind: 'create', path: '大纲/总纲.md', summary: '新建', text: '# 总纲' } as never
  const planProposal = { marker: 'dsh-editor.proposal', version: 1, kind: 'chapter_plan', path: '正文/001.md', summary: '章纲', sourceVersion: 'v1', beats: ['码头'] } as never
  const summaryProposal = { marker: 'dsh-editor.proposal', version: 1, kind: 'chapter_summary', path: '正文/001.md', summary: '小结', sourceVersion: 'v1', state: { now: '黄昏' } } as never
  const splitProposal = { marker: 'dsh-editor.proposal', version: 1, kind: 'split', path: '正文/001.md', summary: '拆', anchor: '### 转折', newPath: '正文/002.md' } as never

  it('unwraps create plans with missing directories and blank-file version', () => {
    const plan = { kind: 'create', applicable: true, version: '', missingDirectories: ['大纲', '大纲/卷一'] }
    expect(unwrapWorkbenchPrepared(createProposal, { create: plan })).toEqual(plan)
    expect(unwrapWorkbenchPrepared(createProposal, { chapterMeta: { kind: 'chapter_plan', version: 'v1', before: '', after: 'x' } })).toBeUndefined()
  })

  it('unwraps chapter metadata field previews only when the kind matches', () => {
    const plan = { kind: 'chapter_plan', version: 'v2', before: '', after: '1. 码头' }
    const summary = { kind: 'chapter_summary', version: 'v2', before: '', after: '此刻：黄昏' }
    expect(unwrapWorkbenchPrepared(planProposal, { chapterMeta: plan })).toEqual(plan)
    expect(unwrapWorkbenchPrepared(planProposal, { chapterMeta: summary })).toBeUndefined()
    expect(unwrapWorkbenchPrepared(summaryProposal, { chapterMeta: summary })).toEqual(summary)
  })

  it('keeps split/merge/renames unwrapping and rejects non-objects', () => {
    const split = { kind: 'split', version: 'v1', before: '', after: '', headChars: 1, tailChars: 2 }
    expect(unwrapWorkbenchPrepared(splitProposal, { split })).toEqual(split)
    expect(unwrapWorkbenchPrepared(splitProposal, null)).toBeUndefined()
    expect(unwrapWorkbenchPrepared(splitProposal, 'x')).toBeUndefined()
  })

  it('builds expectedVersions for create and chapter metadata from the prepared version', () => {
    expect(buildExpectedVersions(createProposal, { kind: 'create', applicable: true, version: '', missingDirectories: [] } as never))
      .toEqual({ '大纲/总纲.md': '' })
    expect(buildExpectedVersions(planProposal, { kind: 'chapter_plan', version: 'v1', before: '', after: '' } as never))
      .toEqual({ '正文/001.md': 'v1' })
    expect(buildExpectedVersions(summaryProposal, { kind: 'chapter_summary', version: 'v1', before: '', after: '' } as never))
      .toEqual({ '正文/001.md': 'v1' })
  })
})

describe('proposal failure reasons are actionable', () => {
  const failure = (reason: string, message = 'boom') => ({
    ok: false as const,
    error: { code: 'internal', message, details: { reason } },
  })

  it('honors details.reason over generic code/message text', () => {
    expect(errorReason(failure('STALE'))).toBe('STALE')
    /* 即便 message 不含 stale 字样，reason=STALE 也视为过期。 */
    expect(isStaleFailure(failure('STALE'))).toBe(true)
    expect(isStaleFailure(failure('PARENT_MISSING'))).toBe(false)
  })

  it('maps reason codes to localized actionable messages', () => {
    expect(errorMessage(failure('STALE'))).toBe(zh['error.diskChanged'])
    expect(errorMessage(failure('PARENT_MISSING'))).toBe(zh['error.reasonParentMissing'])
    expect(errorMessage(failure('NOT_DIRECTORY'))).toBe(zh['error.reasonNotDirectory'])
    expect(errorMessage(failure('DENIED'))).toBe(zh['error.readOnly'])
    expect(errorMessage(failure('EXISTS'))).toBe(zh['error.alreadyExists'])
    expect(errorMessage(failure('IO'))).toBe(zh['error.generic'])
  })

  it('partial-write details still take precedence over reason text', () => {
    const partial = {
      ok: false as const,
      error: {
        code: 'internal',
        message: 'apply interrupted',
        details: { partial: true, appliedPaths: ['正文/01.md'], recoveryPath: 'D:\\novel\\.dsh-editor\\stage\\apply-1', reason: 'IO' },
      },
    }
    expect(errorMessage(partial)).toContain('涉及 正文/01.md')
    expect(errorMessage(partial)).toContain('恢复文件在 D:\\novel\\.dsh-editor\\stage\\apply-1')
  })
})

describe('metadata save safety', () => {
  it('hidden-header writes leave the visible paper byte-identical', async () => {
    const { projectedPaperUnchanged } = await import('dsh-manuscript/client/editor-core')
    const projection = { project: worldbookPaperProjection }
    const buffer = '---\nbeats: [码头]\n---\n# 第一章\n正文\n'
    /* 只改 frontmatter：可见稿纸不变 → 允许。 */
    const beatsOnly = '---\nbeats: [码头, 海关]\n---\n# 第一章\n正文\n'
    expect(projectedPaperUnchanged(projection, '正文/001.md', beatsOnly, buffer)).toBe(true)
    /* 动到正文：拒绝。 */
    const bodyToo = '---\nbeats: [码头, 海关]\n---\n# 第一章\n正文被改了\n'
    expect(projectedPaperUnchanged(projection, '正文/001.md', bodyToo, buffer)).toBe(false)
    /* worldbook 投影同理： */
    const worldbook = '---\ntriggers: [港口]\n---\n# 港口规则\n'
    expect(projectedPaperUnchanged(projection, '世界书/港口.md', worldbook, worldbook)).toBe(true)
  })

  it('accepting a chapter metadata proposal never reloads over dirty editor text', () => {
    /* 章纲/章末小结应用到当前打开的章节且编辑器有未保存改动时，不刷新内容、不抢占文档。 */
    const navigation = proposalAppliedNavigation('正文/001.md', '正文/001.md', true)
    expect(navigation.openPath).toBeUndefined()
    expect(navigation.refreshContent).toBe(false)
    expect(navigation.expandPath).toBe('正文/001.md')
    /* 干净时正常刷新，让字段改动进入稿纸。 */
    expect(proposalAppliedNavigation('正文/001.md', '正文/001.md', false).refreshContent).toBe(true)
  })
})

describe('planning flow labels', () => {
  it('labels outline proposals and chapter metadata proposals for authors', () => {
    expect(zh['chat.outlineProposal']).toBe('作品大纲提案')
    expect(zh['chat.chapterPlanBadge']).toBe('章纲提案')
    expect(zh['chat.chapterSummaryBadge']).toBe('章末小结提案')
  })
})
