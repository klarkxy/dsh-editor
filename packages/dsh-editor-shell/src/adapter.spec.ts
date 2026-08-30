import { describe, expect, it, vi } from 'vitest'
import { answerApproval, answerQuestions, blocksText, chatRows, internalIndexTurnActive, parseProposalMarker, partialText, pendingRows, send, sendProjectContext, stop, toolResultRow, visibleRunningCalls } from './adapter.ts'
import { compileProjectContext, compileProjectContextV2 } from 'dsh-editor-workbench/contracts'
import { buildNovelIndexPrompt } from './novel-index.ts'

describe('DSH snapshot adapter', () => {
  it('recognizes only exact versioned proposal markers', () => {
    expect(parseProposalMarker(JSON.stringify({ marker: 'dsh-editor.proposal', version: 1, kind: 'create', path: '正文/001.md', summary: '创建', text: '# 第一章' }))).toMatchObject({ kind: 'create' })
    expect(parseProposalMarker(JSON.stringify({ marker: 'dsh-editor.proposal', version: 2 }))).toBeUndefined()
  })
  it('renders proposals from the canonical nested tool-result content block', () => {
    const marker = JSON.stringify({ marker: 'dsh-editor.proposal', version: 1, kind: 'edit', path: '项目总览.md', summary: '完善总览', oldText: '旧', newText: '新' })
    const [row] = chatRows({ nodes: [{
      kind: 'tool-result', seq: 3, callId: 'proposal', call: { name: 'novel_propose', argsRaw: '{}' },
      content: [{ type: 'tool-result', toolCallId: 'proposal', content: [{ type: 'text', text: marker }] }], isError: false,
    }] } as never)
    expect(row).toMatchObject({ role: 'tool', proposal: { path: '项目总览.md', oldText: '旧', newText: '新' } })
  })
  it('renders published prose while hiding unknown runtime details', () => {
    const snapshot = { nodes: [
      { kind: 'user', seq: 1, content: [{ type: 'text', text: '审这一段' }] },
      { kind: 'assistant', seq: 2, blocks: [{ kind: 'text', text: '先看动机。' }] },
      { kind: 'unknown', seq: 3, type: 'future/event', data: {} },
    ] }
    expect(chatRows(snapshot as never)).toEqual([
      { role: 'user', text: '审这一段' },
      { role: 'assistant', text: '先看动机。' },
    ].map((row, index) => ({ id: index ? 'assistant:2' : 'user:1', ...row, ...(index ? { detail: undefined } : { projectContextReceipt: undefined }) })))
  })
  it('hides reasoning blocks and think islands from complete and streaming assistant text', () => {
    const snapshot = { nodes: [
      { kind: 'assistant', seq: 1, blocks: [
        { kind: 'reasoning', text: 'hidden reasoning' },
        { kind: 'thinking', text: 'hidden thinking' },
        { kind: 'text', text: '<think>hidden island</think>给作者看的回复。' },
      ] },
    ] }
    expect(chatRows(snapshot as never)).toEqual([
      { id: 'assistant:1', role: 'assistant', text: '给作者看的回复。', detail: undefined },
    ])
    expect(blocksText([{ type: 'analysis', text: 'hidden analysis' }, { type: 'text', text: '可见' }] as never)).toBe('可见')
    expect(partialText({ partial: { blocks: [{ kind: 'text', text: '<think>streaming secret' }] } } as never)).toBe('')
    expect(partialText({ partial: { blocks: [{ kind: 'text', text: '可见回复<thi' }] } } as never)).toBe('可见回复')
    expect(partialText({ partial: { blocks: [{ kind: 'text', text: '<think>done</think>流式正文' }] } } as never)).toBe('流式正文')
  })
  it('suppresses the complete product-owned index turn and generic empty status rows', () => {
    const prompt = buildNovelIndexPrompt()
    const snapshot = { nodes: [
      { kind: 'user', seq: 1, content: [{ type: 'text', text: prompt }] },
      { kind: 'assistant', seq: 2, blocks: [{ kind: 'tool-call', name: 'read', argsRaw: '{"path":"项目总览.md"}' }] },
      { kind: 'tool-result', seq: 3, callId: 'read', call: { name: 'read', argsRaw: '{}' }, content: [{ type: 'text', text: 'internal' }], isError: false },
      { kind: 'assistant', seq: 4, blocks: [{ kind: 'text', text: '已通过 novel_propose 更新 .dsh-editor/作品索引.md' }] },
      { kind: 'turn-finished', seq: 5 },
      { kind: 'turn-error', seq: 6 },
    ] }
    expect(chatRows(snapshot as never)).toEqual([])
    expect(internalIndexTurnActive(snapshot as never)).toBe(true)
    expect(JSON.stringify(chatRows(snapshot as never))).not.toMatch(/workspace|novel_propose|作品索引|状态已更新/)

    const authorSnapshot = { nodes: [
      ...snapshot.nodes,
      { kind: 'user', seq: 7, content: [{ type: 'text', text: '讨论下一章' }] },
      { kind: 'assistant', seq: 8, blocks: [{ kind: 'tool-call', name: 'read', argsRaw: '{}' }] },
      { kind: 'tool-result', seq: 9, callId: 'read-2', call: { name: 'read', argsRaw: '{}' }, content: [{ type: 'text', text: 'raw' }], isError: false },
      { kind: 'step-finished', seq: 10 },
    ] }
    expect(chatRows(authorSnapshot as never)).toEqual([
      { id: 'user:7', role: 'user', text: '讨论下一章', projectContextReceipt: undefined },
    ])
    expect(internalIndexTurnActive(authorSnapshot as never)).toBe(false)
    expect(chatRows({ nodes: [
      { kind: 'user', seq: 1, content: [{ type: 'text', text: '为当前工作区建立作品索引。' }] },
    ] } as never)).toEqual([
      { id: 'user:1', role: 'user', text: '为当前工作区建立作品索引。', projectContextReceipt: undefined },
    ])
  })
  it('completely hides bundled knowledge tool results', () => {
    const snapshot = { nodes: [
      { kind: 'assistant', seq: 1, blocks: [{ kind: 'tool-call', name: 'novel_knowledge', argsRaw: '{"topics":["planning"]}' }] },
      { kind: 'tool-result', seq: 2, callId: 'knowledge', call: { name: 'novel_knowledge', argsRaw: '{"topics":["planning"]}' }, content: [{ type: 'text', text: 'internal card' }], isError: false },
      { kind: 'tool-result', seq: 2.5, callId: 'knowledge-outside-window', call: null, content: [{ type: 'text', text: '<novel_knowledge topic="canon" version="1">internal card</novel_knowledge>' }], isError: false },
      { kind: 'assistant', seq: 3, blocks: [{ kind: 'text', text: '这一章可以从误判开始。' }] },
    ] }
    expect(chatRows(snapshot as never)).toEqual([
      { id: 'assistant:3', role: 'assistant', text: '这一章可以从误判开始。', detail: undefined },
    ])
    expect(JSON.stringify(chatRows(snapshot as never))).not.toContain('novel_knowledge')
    expect(JSON.stringify(chatRows(snapshot as never))).not.toContain('internal card')
    expect(visibleRunningCalls([
      { name: 'novel_knowledge', callId: 'hidden' },
      { name: 'read', callId: 'visible' },
    ])).toEqual([{ name: 'read', callId: 'visible' }])
  })
  it('does not start another connection to send or cancel', async () => {
    const prompt = vi.fn().mockResolvedValue({ ok: true })
    const cancel = vi.fn().mockResolvedValue({ ok: true })
    const session = { prompt, cancel } as never
    await send(session, '  问剧情  ')
    await stop(session)
    expect(prompt).toHaveBeenCalledWith([{ type: 'text', text: '问剧情' }], 'queue')
    expect(cancel).toHaveBeenCalledTimes(1)
  })
  it('submits one project-context envelope and projects its user request and receipt back to the UI', async () => {
    const prompt = vi.fn().mockResolvedValue({ ok: true })
    const session = { prompt } as never
    const compiled = await compileProjectContext('请审这一段', async (path) => ({ ok: true as const, value: { text: `资料 ${path}`, version: 'v1' } }))
    const sent = await sendProjectContext(session, '  请审这一段  ', async () => compiled)
    expect(prompt).toHaveBeenCalledTimes(1)
    const canonical = prompt.mock.calls[0]?.[0]?.[0]?.text
    expect(canonical).toBe(compiled.serialized)
    const [row] = chatRows({ nodes: [{ kind: 'user', seq: 1, content: [{ type: 'text', text: canonical }] }] } as never)
    expect(row).toMatchObject({ role: 'user', text: '请审这一段' })
    expect(row?.projectContextReceipt).toEqual(sent?.receipt)
  })
  it('does not prompt when project-context compilation fails', async () => {
    const prompt = vi.fn()
    await expect(sendProjectContext({ prompt } as never, '请审这一段', async () => { throw new Error('compile failed') })).rejects.toThrow('compile failed')
    expect(prompt).not.toHaveBeenCalled()
  })
  it('projects a canonical V2 message without exposing source text in the UI receipt', async () => {
    const compiled = await compileProjectContextV2('写港口冲突', async () => ({ ok: true as const, value: { text: '固定秘密', version: 'v1' } }), {
      candidates: [{ path: '世界书/港口.md', version: 'w1', text: '绝不能出现在回执里的港口原文' }],
      scan: { scanned: 1 },
    })
    const [row] = chatRows({ nodes: [{ kind: 'user', seq: 2, content: [{ type: 'text', text: compiled.serialized }] }] } as never)
    expect(row?.text).toBe('写港口冲突')
    expect(row?.projectContextReceipt?.sources.some((item) => item.kind === 'worldbook')).toBe(true)
    expect(JSON.stringify(row?.projectContextReceipt)).not.toContain('绝不能出现在回执里的港口原文')
    expect(JSON.stringify(row?.projectContextReceipt)).not.toContain('固定秘密')
  })
  it('keeps historical plain user messages unchanged', () => {
    const [row] = chatRows({ nodes: [{ kind: 'user', seq: 1, content: [{ type: 'text', text: '普通旧消息' }] }] } as never)
    expect(row).toEqual({ id: 'user:1', role: 'user', text: '普通旧消息', projectContextReceipt: undefined })
  })
  it('keeps host-owned approval and question payloads generic', () => {
    expect(pendingRows([{ key: 'a', kind: 'approval', payload: { toolName: 'write' } }, { key: 'q', kind: 'question', payload: { questions: [] } }] as never)).toMatchObject([
      { text: '等待确认一项操作' }, { text: '等待你的回答' },
    ])
  })
  it('renders partial text and answers pending waits through their public response carrier', async () => {
    expect(partialText({ partial: { blocks: [{ kind: 'text', text: '流式正文' }] } } as never)).toBe('流式正文')
    const approvalRespond = vi.fn().mockResolvedValue({ accepted: true })
    await answerApproval({
      kind: 'approval', sessionId: 's', payload: { approvalId: 'a', toolName: 'write' }, respond: approvalRespond,
    } as never, 'allowed-once')
    expect(approvalRespond).toHaveBeenCalledWith({ ok: true, value: { sessionId: 's', approvalId: 'a', outcome: 'allowed-once' } })
    const questionRespond = vi.fn().mockResolvedValue({ accepted: true })
    await answerQuestions({
      kind: 'question', sessionId: 's', payload: { questions: [] }, respond: questionRespond,
    } as never, [{ id: 'q', selected: ['继续'] }])
    expect(questionRespond).toHaveBeenCalledWith({ ok: true, value: { sessionId: 's', answer: { answers: [{ id: 'q', selected: ['继续'] }] } } })
  })
  it('never exposes raw tool output, error codes, names, or nested calls', () => {
    const row = toolResultRow({
      kind: 'tool-result', seq: 8, callId: 'root', call: { name: '写入', argsRaw: '{"path":"x"}' },
      content: [{ type: 'text', text: '写入被拒绝' }], isError: true, error: { name: 'Denied', code: 'sandbox-denied' },
      subCalls: [{ callId: 'child', name: '检查路径', argsRaw: '', turn: 1, step: 1, time: 1, callView: null, subCalls: [] }],
    } as never)
    expect(row).toMatchObject({ role: 'tool', text: '这项操作没有执行', detail: '写作助手无法完成这项操作。' })
    expect(JSON.stringify(row)).not.toContain('Denied')
    expect(JSON.stringify(row)).not.toContain('检查路径')
    const long = toolResultRow({
      kind: 'tool-result', seq: 9, callId: 'long', call: null,
      content: [{ type: 'text', text: 'x'.repeat(1300) }], isError: false, subCalls: [],
    } as never)
    expect(long).toMatchObject({ text: '操作已完成', detail: '已完成' })
  })
})
