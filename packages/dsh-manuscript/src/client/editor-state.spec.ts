import { describe, expect, it } from 'vitest'
import { documentKey, draftStorageKey, hasUnsavedChanges, isStaleWriteError, parseStoredDraft, shouldApplyRead, shouldRetainDraftAfterSave } from './editor-state.ts'

describe('editor state guards', () => {
  const chapterA = { sessionId: 'session-1', cwd: 'D:/novel', path: 'chapters/a.md' }
  const chapterB = { sessionId: 'session-1', cwd: 'D:/novel', path: 'chapters/b.md' }

  it('changes from saved to dirty only when the buffer differs', () => {
    expect(hasUnsavedChanges('正文', '正文')).toBe(false)
    expect(hasUnsavedChanges('新正文', '正文')).toBe(true)
    expect(hasUnsavedChanges('正文', '正文')).toBe(false)
  })

  it('rejects a late read for a no-longer-requested path', () => {
    expect(shouldApplyRead(3, 3, chapterA, chapterA)).toBe(true)
    expect(shouldApplyRead(2, 3, chapterA, chapterA)).toBe(false)
    expect(shouldApplyRead(3, 3, chapterA, chapterB)).toBe(false)
  })

  it('only restores a draft for its original document', () => {
    const stored = JSON.stringify({ ...chapterA, text: '未保存', version: '1' })
    expect(parseStoredDraft(stored, chapterA)?.text).toBe('未保存')
    expect(parseStoredDraft(stored, chapterB)).toBeNull()
    expect(documentKey(chapterA)).not.toBe(documentKey(chapterB))
  })

  it('retains a draft across session reloads without reusing the old authority', () => {
    const reloaded = { ...chapterA, sessionId: 'session-2' }
    const stored = JSON.stringify({ ...chapterA, text: '未保存', version: '1' })
    expect(draftStorageKey(reloaded)).toBe(draftStorageKey(chapterA))
    expect(parseStoredDraft(stored, reloaded)?.sessionId).toBe('session-2')
  })

  it('recognizes version conflicts without treating ordinary save errors as conflicts', () => {
    expect(isStaleWriteError('file changed on disk')).toBe(true)
    expect(isStaleWriteError('write failed')).toBe(false)
  })

  it('keeps typing that arrives while a save RPC is still in flight', async () => {
    let resolveWrite: (() => void) | undefined
    const write = new Promise<void>((resolve) => { resolveWrite = resolve })
    const submittedText = '已提交的正文'
    const submittedGeneration = 4
    let currentText = submittedText
    let currentGeneration = submittedGeneration
    let status = 'saving'
    let persistedDraft = ''
    const saveFinished = write.then(() => {
      if (shouldRetainDraftAfterSave(submittedText, currentText, submittedGeneration, currentGeneration)) {
        status = 'dirty'
        persistedDraft = currentText
      } else {
        status = 'saved'
      }
    })

    currentText = '保存期间继续输入的正文'
    currentGeneration += 1
    resolveWrite?.()

    await saveFinished
    expect(currentText).toBe('保存期间继续输入的正文')
    expect(persistedDraft).toBe(currentText)
    expect(status).toBe('dirty')
  })
})
