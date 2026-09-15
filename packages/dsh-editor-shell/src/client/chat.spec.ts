import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { parseAuthorProposal } from '../adapter.ts'
import { buildExpectedVersions, proposalBasisItems, proposalBasisLine, proposalFingerprint, proposalTargetBaselines, settleConversationStop, unwrapWorkbenchPrepared } from './chat.ts'

describe('chat proposal V2 compatibility', () => {
  it('builds expected versions for V2 kinds the same way as V1 file ops', () => {
    const edit = parseAuthorProposal(JSON.stringify({
      marker: 'dsh-editor.proposal', version: 2, kind: 'edit', path: 'notes/a.md', summary: '改', oldText: '旧', newText: '新', targetVersion: 'v7',
    }))!
    expect(buildExpectedVersions(edit, { kind: 'edit', version: 'v1', before: '旧', after: '新' })).toBeUndefined()

    const create = parseAuthorProposal(JSON.stringify({
      marker: 'dsh-editor.proposal', version: 2, kind: 'create', path: 'notes/b.md', summary: '新建', text: '# 新',
    }))!
    expect(buildExpectedVersions(create, { kind: 'create', applicable: true, version: '', missingDirectories: ['notes'] }))
      .toEqual({ 'notes/b.md': '' })
    const txt = parseAuthorProposal(JSON.stringify({
      marker: 'dsh-editor.proposal', version: 2, kind: 'create', path: 'notes/b.txt', summary: '新建', text: 'plain',
    }))!
    expect(buildExpectedVersions(txt, { kind: 'create', applicable: true, version: '', missingDirectories: ['notes'] }))
      .toEqual({ 'notes/b.txt': '' })

    const split = parseAuthorProposal(JSON.stringify({
      marker: 'dsh-editor.proposal', version: 2, kind: 'split', path: 'notes/a.md', summary: '拆', anchor: '## x', newPath: 'notes/c.md', targetVersion: 'v7',
    }))!
    expect(unwrapWorkbenchPrepared(split, { split: { kind: 'split', version: 'v1', before: '', after: '', headChars: 1, tailChars: 2 } }))
      .toMatchObject({ kind: 'split', version: 'v1' })
    expect(buildExpectedVersions(split, { kind: 'split', version: 'v9', before: '', after: '', headChars: 1, tailChars: 2 }))
      .toEqual({ 'notes/a.md': 'v9' })
  })

  it('keeps V1 chapter proposals on the workbench unwrap path', () => {
    const plan = { marker: 'dsh-editor.proposal', version: 1, kind: 'chapter_plan', path: '正文/001.md', summary: '章纲', sourceVersion: 'v1', beats: ['码头'] } as const
    expect(unwrapWorkbenchPrepared(plan, { chapterMeta: { kind: 'chapter_plan', version: 'v1', before: '', after: '1. 码头' } }))
      .toEqual({ kind: 'chapter_plan', version: 'v1', before: '', after: '1. 码头' })
    expect(parseAuthorProposal(JSON.stringify(plan))).toMatchObject({ version: 1, kind: 'chapter_plan' })
  })

  it('includes ordered basis path/version/label in V2 fingerprints and ignores empty or V1 basis', () => {
    const v2 = parseAuthorProposal(JSON.stringify({
      marker: 'dsh-editor.proposal', version: 2, kind: 'edit', path: 'notes/a.md', summary: '改', oldText: '旧', newText: '新', targetVersion: 'v7',
      basis: [
        { path: '大纲/总纲.md', version: 'v1', label: '总纲' },
        { path: '正文/001.md', version: 'v9' },
      ],
    }))!
    const finger = proposalFingerprint(v2)
    expect(finger).toContain('大纲/总纲.md|v1|总纲')
    expect(finger).toContain('正文/001.md|v9|')
    expect(finger.indexOf('大纲/总纲.md|v1|总纲')).toBeLessThan(finger.indexOf('正文/001.md|v9|'))

    const reordered = parseAuthorProposal(JSON.stringify({
      marker: 'dsh-editor.proposal', version: 2, kind: 'edit', path: 'notes/a.md', summary: '改', oldText: '旧', newText: '新', targetVersion: 'v7',
      basis: [
        { path: '正文/001.md', version: 'v9' },
        { path: '大纲/总纲.md', version: 'v1', label: '总纲' },
      ],
    }))!
    expect(proposalFingerprint(reordered)).not.toBe(finger)

    const relabeled = parseAuthorProposal(JSON.stringify({
      marker: 'dsh-editor.proposal', version: 2, kind: 'edit', path: 'notes/a.md', summary: '改', oldText: '旧', newText: '新', targetVersion: 'v7',
      basis: [
        { path: '大纲/总纲.md', version: 'v1', label: '设定' },
        { path: '正文/001.md', version: 'v9' },
      ],
    }))!
    expect(proposalFingerprint(relabeled)).not.toBe(finger)

    const bumped = parseAuthorProposal(JSON.stringify({
      marker: 'dsh-editor.proposal', version: 2, kind: 'edit', path: 'notes/a.md', summary: '改', oldText: '旧', newText: '新', targetVersion: 'v7',
      basis: [
        { path: '大纲/总纲.md', version: 'v2', label: '总纲' },
        { path: '正文/001.md', version: 'v9' },
      ],
    }))!
    expect(proposalFingerprint(bumped)).not.toBe(finger)

    const v2empty = parseAuthorProposal(JSON.stringify({
      marker: 'dsh-editor.proposal', version: 2, kind: 'edit', path: 'notes/a.md', summary: '改', oldText: '旧', newText: '新', targetVersion: 'v7',
    }))!
    expect(proposalFingerprint(v2empty)).toBe('edit|改|notes/a.md|旧|新|target|notes/a.md|v7')
    expect(proposalFingerprint({
      ...v2empty,
      targetVersion: 'v8',
    })).not.toBe(proposalFingerprint(v2empty))
    expect(proposalTargetBaselines(v2empty)).toEqual([{ path: 'notes/a.md', version: 'v7' }])
    expect(proposalTargetBaselines(parseAuthorProposal(JSON.stringify({
      marker: 'dsh-editor.proposal', version: 2, kind: 'create', path: 'notes/b.md', summary: '新建', text: '# 新',
    }))!)).toEqual([])
    const merge = parseAuthorProposal(JSON.stringify({
      marker: 'dsh-editor.proposal', version: 2, kind: 'merge', path: 'notes/a.md', summary: '合',
      sourcePath: 'notes/b.md', targetVersion: 'v7', sourceVersion: 'v3',
    }))!
    expect(proposalTargetBaselines(merge)).toEqual([
      { path: 'notes/a.md', version: 'v7' },
      { path: 'notes/b.md', version: 'v3' },
    ])
    expect(proposalFingerprint(merge)).toContain('target|notes/a.md|v7')
    expect(proposalFingerprint(merge)).toContain('target|notes/b.md|v3')
    const renames = parseAuthorProposal(JSON.stringify({
      marker: 'dsh-editor.proposal', version: 2, kind: 'renames', summary: '改名',
      renames: [{ from: 'notes/a.md', to: 'notes/b.md', version: 'v7' }],
    }))!
    expect(proposalTargetBaselines(renames)).toEqual([{ path: 'notes/a.md', version: 'v7' }])

    const v1 = { marker: 'dsh-editor.proposal', version: 1, kind: 'edit', path: 'notes/a.md', summary: '改', oldText: '旧', newText: '新' } as const
    expect(proposalFingerprint(v1)).toBe('edit|改|notes/a.md|旧|新')
    expect(proposalTargetBaselines(v1)).toEqual([])
    expect(proposalFingerprint({
      ...v1,
      basis: [{ path: '大纲/总纲.md', version: 'v1', label: '总纲' }],
    } as typeof v1 & { basis: Array<{ path: string; version: string; label: string }> })).toBe('edit|改|notes/a.md|旧|新')
    const chat = readFileSync(new URL('./chat.ts', import.meta.url), 'utf8')
    expect(chat.indexOf('renderTargets()')).toBeLessThan(chat.indexOf('renderBasis()'))
    expect(chat).toContain('return e(Fragment, null, targets, basis, renderKindBody())')
    expect(chat).not.toMatch(/targetVersion\s*=/)
  })

  it('lists non-empty V2 basis with preferred label and always-visible path/version', () => {
    const v2 = parseAuthorProposal(JSON.stringify({
      marker: 'dsh-editor.proposal', version: 2, kind: 'create', path: 'notes/b.md', summary: '新建', text: '# 新',
      basis: [
        { path: 'notes/source.md', version: 'v1', label: '来源' },
        { path: 'notes/other.md', version: 'v3' },
      ],
    }))!
    const items = proposalBasisItems(v2)
    expect(items).toEqual([
      { path: 'notes/source.md', version: 'v1', label: '来源' },
      { path: 'notes/other.md', version: 'v3' },
    ])
    expect(proposalBasisLine(items[0]!)).toBe('来源 · notes/source.md · v1')
    expect(proposalBasisLine(items[1]!)).toBe('notes/other.md · v3')
    expect(proposalBasisLine(items[0]!)).not.toMatch(/旧|# 新|正文内容/)

    const v1 = { marker: 'dsh-editor.proposal', version: 1, kind: 'create', path: 'notes/b.md', summary: '新建', text: '# 新' } as const
    expect(proposalBasisItems(v1)).toEqual([])
    expect(proposalBasisItems(parseAuthorProposal(JSON.stringify({
      marker: 'dsh-editor.proposal', version: 2, kind: 'create', path: 'notes/b.md', summary: '新建', text: '# 新',
    }))!)).toEqual([])
  })
})

describe('new conversation preset picker wiring', () => {
  const chatSource = () => readFileSync(new URL('./chat.ts', import.meta.url), 'utf8')
  const dialogsSource = () => readFileSync(new URL('./dialogs.ts', import.meta.url), 'utf8')

  it('lists presets after the draft guard, creates only on confirm, and never pretends create accepts a preset', () => {
    const source = chatSource()
    expect(source).toContain("canDiscardDraft('__new-conversation__')")
    expect(source.indexOf("canDiscardDraft('__new-conversation__')")).toBeLessThan(source.indexOf('ctx.remote.agentPresets.list()'))
    expect(source).toContain('startNewConversationPresetFlow')
    expect(source).toContain('ctx.sessions.create({ workspaceId })')
    expect(source).toContain('ctx.remote.agentPresets.select')
    expect(source).not.toContain('noteAgentPreset')
    expect(source).not.toMatch(/sessions\.create\(\{[^}]*agentPreset/)
    expect(source).not.toContain('connectWorkspace(workspaceId)')
  })

  it('keeps a failed select on the same pending session and can best-effort archive on cancel', () => {
    const source = chatSource()
    expect(source).toContain('pendingSessionId')
    expect(source).toContain('confirmNewConversationPreset')
    expect(source).toContain('cancelNewConversationPresetPicker')
    expect(source).toContain('ctx.workspaces.archiveSession')
  })

  it('switches existing conversations with open only and never calls select', () => {
    const source = chatSource()
    const start = source.indexOf('const switchConversation = async')
    const end = source.indexOf('const renameConversation', start)
    const switchBlock = source.slice(start, end)
    expect(switchBlock).toContain('openConversation(nextId as SessionId)')
    expect(switchBlock).not.toContain('agentPresets.select')
    expect(switchBlock).not.toContain('noteAgentPreset')
  })

  it('runs interview, auto index, and context.compile only for host legacy dsh-editor sessions', () => {
    const source = chatSource()
    expect(source).toContain('shouldRunLegacyNovelPipeline(sessionAgentPreset(sessionList.byId, session.sessionId))')
    expect(source).toContain('if (!legacyEditor)')
    expect(source).toContain('void send(session, value)')
    expect(source).toContain("ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'context.compile'")
    expect(source).toContain('legacyEditor && shouldShowInitGuide')
    expect(source).toContain('if (!legacyEditor || !runningJustStopped) return')
    expect(source).toContain('if (!legacyEditor || !workspaceId || !workspacePath) return')
    expect(source).toContain('if (legacyEditor && initState === \'interview\' && initCompleted)')
  })

  it('keeps picker dialog aria, focus return, and isomorphic mode rows', () => {
    const source = dialogsSource()
    expect(source).toContain('role: \'radiogroup\'')
    expect(source).toContain('role: \'radio\'')
    expect(source).toContain("'aria-checked'")
    expect(source).toContain('initialFocusRef')
    expect(source).toContain('returnFocusRef')
    expect(source).toContain('conversation-preset-picker-title')
    expect(source).not.toContain('dsh-editor-novel')
    expect(source).not.toContain('dsh-editor-writing')
  })

  it('does not install a local preset override projection', () => {
    const source = `${chatSource()}\n${dialogsSource()}`
    expect(source).not.toContain('installSessionAgentPresetNotes')
    expect(source).not.toContain('noteAgentPreset')
    expect(source).not.toMatch(/sessions\.list\s*=/)
    expect(source).not.toMatch(/agentPresetOverrides|presetBySession|sessionPresetMap|presetCache/)
  })
})

describe('settleConversationStop', () => {
  it('releases outgoing after cancel succeeds and when cancel rejects', async () => {
    const released = vi.fn()
    await settleConversationStop({
      cancel: async () => ({ ok: true }),
      releaseOutgoing: released,
    })
    expect(released).toHaveBeenCalledOnce()

    released.mockClear()
    await expect(settleConversationStop({
      cancel: async () => {
        throw new Error('cancel failed')
      },
      releaseOutgoing: released,
    })).rejects.toThrow('cancel failed')
    expect(released).toHaveBeenCalledOnce()
  })

  it('releases outgoing when cancel returns a failed RPC result', async () => {
    const released = vi.fn()
    await settleConversationStop({
      cancel: async () => ({ ok: false, error: { message: 'busy' } }),
      releaseOutgoing: released,
    })
    expect(released).toHaveBeenCalledOnce()
  })

  it('wires Stop through settleConversationStop and keeps canonical outgoing reconciliation', () => {
    const source = readFileSync(new URL('./chat.ts', import.meta.url), 'utf8')
    expect(source).toContain('settleConversationStop')
    expect(source).toContain('releaseOutgoing: () => setOutgoing(null)')
    expect(source).toContain('if (outgoingIsCanonical) setOutgoing(null)')
    expect(source).not.toMatch(/onClick:\s*\(\)\s*=>\s*void stop\(session\)/)
  })
})
