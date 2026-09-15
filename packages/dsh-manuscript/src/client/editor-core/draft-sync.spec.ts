import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDraftSyncTimer } from './editor.tsx'

const editor = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'editor.tsx'), 'utf8').replace(/\r\n/g, '\n')

describe('createDraftSyncTimer', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('drops a not-yet-fired run and still accepts a later schedule', () => {
    vi.useFakeTimers()
    const timer = createDraftSyncTimer()
    const first = vi.fn()
    const second = vi.fn()
    timer.schedule(250, first)
    timer.cancelPending()
    vi.advanceTimersByTime(250)
    expect(first).not.toHaveBeenCalled()
    timer.schedule(250, second)
    vi.advanceTimersByTime(249)
    expect(second).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(second).toHaveBeenCalledOnce()
  })

  it('replaces a pending run so only the latest scheduled callback fires', () => {
    vi.useFakeTimers()
    const timer = createDraftSyncTimer()
    const first = vi.fn()
    const second = vi.fn()
    timer.schedule(250, first)
    timer.schedule(250, second)
    vi.advanceTimersByTime(250)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()
  })
})

describe('EditorCore draft-sync cancellation', () => {
  it('cancels the pending timer before save, discard, remount, and handle-owned cleanup', () => {
    expect(editor).toContain('cancelPendingDraftSync(): void')
    expect(editor).toContain('const draftSync = useRef(createDraftSyncTimer()).current')
    expect(editor).toContain('draftSync.schedule(delay,')
    expect(editor).toContain('return cancelPendingDraftSync')
    const save = editor.slice(editor.indexOf('const save = useCallback'), editor.indexOf('const discard = useCallback'))
    expect(save.indexOf('conflictRef.current')).toBeGreaterThan(-1)
    expect(save.indexOf('cancelPendingDraftSync()')).toBeGreaterThan(save.indexOf('conflictRef.current'))
    expect(save.indexOf('cancelPendingDraftSync()')).toBeLessThan(save.indexOf('flushText()'))
    const discard = editor.slice(editor.indexOf('const discard = useCallback'), editor.indexOf('const adoptBackup'))
    expect(discard.indexOf('cancelPendingDraftSync()')).toBeLessThan(discard.indexOf("draft.call('draft.delete'"))
    expect(editor).toContain('cancelPendingDraftSync,')
    const loadStart = editor.indexOf('useEffect(() => {\n    cancelPendingDraftSync()')
    expect(loadStart).toBeGreaterThan(-1)
    expect(editor.indexOf('cancelPendingDraftSync()', loadStart + 1)).toBeGreaterThan(loadStart)
  })
})
