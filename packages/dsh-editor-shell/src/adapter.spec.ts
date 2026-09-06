import { describe, expect, it, vi } from 'vitest'
import { answerApproval, answerQuestions, blocksText, chatRows, internalIndexTurnActive, parseAuthorMemoryMarker, parseProposalMarker, partialView, pendingRows, send, sendProjectContext, stop, toolResultRow, visibleRunningCalls } from './adapter.ts'
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
  it('labels split/merge/renames proposals with their own detail copy and never touches proposal.path on renames', () => {
    const splitMarker = JSON.stringify({ marker: 'dsh-editor.proposal', version: 1, kind: 'split', path: '正文/001.md', summary: '把后半章拆出来', anchor: '### 转折', newPath: '正文/002.md' })
    const mergeMarker = JSON.stringify({ marker: 'dsh-editor.proposal', version: 1, kind: 'merge', path: '正文/001.md', summary: '合并两章', sourcePath: '正文/002.md' })
    const renamesMarker = JSON.stringify({ marker: 'dsh-editor.proposal', version: 1, kind: 'renames', summary: '批量改名', renames: [{ from: '正文/001.md', to: '正文/序章.md' }] })
    const splitRow = toolResultRow({ kind: 'tool-result', seq: 10, callId: 'p', call: { name: 'novel_propose', argsRaw: '{}' }, content: [{ type: 'text', text: splitMarker }], isError: false } as never)
    const mergeRow = toolResultRow({ kind: 'tool-result', seq: 11, callId: 'p', call: { name: 'novel_propose', argsRaw: '{}' }, content: [{ type: 'text', text: mergeMarker }], isError: false } as never)
    const renamesRow = toolResultRow({ kind: 'tool-result', seq: 12, callId: 'p', call: { name: 'novel_propose', argsRaw: '{}' }, content: [{ type: 'text', text: renamesMarker }], isError: false } as never)
    expect(splitRow).toMatchObject({ role: 'tool', detail: '写作助手提出了一项章节拆分提案', proposal: { kind: 'split', path: '正文/001.md', newPath: '正文/002.md' } })
    expect(mergeRow).toMatchObject({ role: 'tool', detail: '章节合并提案', proposal: { kind: 'merge', sourcePath: '正文/002.md', path: '正文/001.md' } })
    expect(renamesRow).toMatchObject({ role: 'tool', detail: '批量重命名提案', proposal: { kind: 'renames', renames: [{ from: '正文/001.md', to: '正文/序章.md' }] } })
    /* renames 提案没有 path 字段,UI 描述也必须落到 kind 文案,而不是默认的"文件修改提案"。 */
    expect(renamesRow.detail).not.toBe('写作助手提出了一项文件修改提案')
    expect(renamesRow.proposal).not.toHaveProperty('path')
  })
  it('surfaces author_observe markers as memory rows for the confirmation card', () => {
    const marker = JSON.stringify({ marker: 'dsh-editor.memory', version: 1, observation: '留白优先', reason: '多次出现' })
    const row = toolResultRow({ kind: 'tool-result', seq: 9, callId: 'm', call: { name: 'author_observe', argsRaw: '{}' }, content: [{ type: 'text', text: marker }], isError: false } as never)
    expect(row).toMatchObject({ role: 'tool', text: '留白优先', detail: '写作助手提议记住这条偏好', memory: { observation: '留白优先', reason: '多次出现' } })
    expect(parseAuthorMemoryMarker(marker)).toEqual({ marker: 'dsh-editor.memory', version: 1, observation: '留白优先', reason: '多次出现' })
    expect(parseAuthorMemoryMarker('not json')).toBeUndefined()
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
  it('renders reasoning blocks and think islands as thinking rows, not reply text', () => {
    const snapshot = { nodes: [
      { kind: 'assistant', seq: 1, blocks: [
        { kind: 'reasoning', text: 'hidden reasoning' },
        { kind: 'thinking', text: 'hidden thinking' },
        { kind: 'text', text: '<think>hidden island</think>给作者看的回复。' },
      ] },
    ] }
    expect(chatRows(snapshot as never)).toEqual([
      { id: 'assistant:1:thinking', role: 'thinking', text: 'hidden reasoning\nhidden thinking\nhidden island' },
      { id: 'assistant:1', role: 'assistant', text: '给作者看的回复。', detail: undefined },
    ])
    expect(blocksText([{ type: 'analysis', text: 'hidden analysis' }, { type: 'text', text: '可见' }] as never)).toBe('可见')
    expect(partialView({ partial: { blocks: [{ kind: 'text', text: '<think>streaming secret' }] } } as never)).toEqual({ thinking: 'streaming secret', text: '' })
    expect(partialView({ partial: { blocks: [{ kind: 'text', text: '可见回复<thi' }] } } as never)).toEqual({ thinking: '', text: '可见回复' })
    expect(partialView({ partial: { blocks: [{ kind: 'text', text: '<think>done</think>流式正文' }] } } as never)).toEqual({ thinking: 'done', text: '流式正文' })
  })
  it('keeps tool steps visible with an expandable result body', () => {
    const snapshot = { nodes: [
      { kind: 'assistant', seq: 1, blocks: [{ kind: 'tool-call', name: 'read', callId: 'read-1', argsRaw: '{"path":"项目总览.md"}' }] },
      { kind: 'tool-result', seq: 2, callId: 'read-1', call: { name: 'read', argsRaw: '{"path":"项目总览.md"}' }, content: [{ type: 'text', text: '文件正文' }], isError: false },
      { kind: 'tool-result', seq: 3, callId: 'read-2', call: { name: 'read', argsRaw: '{}' }, content: [{ type: 'text', text: '读取失败原因' }], isError: true },
    ] }
    expect(chatRows(snapshot as never)).toEqual([
      { id: 'tool-result:2', role: 'tool', text: '已阅读作品资料', detail: 'read', content: '文件正文' },
      { id: 'tool-result:3', role: 'tool', text: '这项操作没有执行', detail: 'read', content: '读取失败原因', error: true, reason: '读取失败原因' },
    ])
    const guarded = toolResultRow({
      kind: 'tool-result', seq: 5, callId: 'ask', call: { name: 'ask_user_question', argsRaw: '{}' },
      content: [{ type: 'text', text: 'DSH Editor only allows project search, read, and previewable proposals.' }], isError: true,
    } as never)
    expect(guarded.reason).toContain('ask_user_question')
    expect(guarded.reason).toContain('不在允许范围')
    expect(toolResultRow({ kind: 'tool-result', seq: 4, callId: 'x', call: { name: 'write', argsRaw: '{}' }, content: [{ type: 'text', text: 'a'.repeat(5000) }], isError: false } as never).content).toHaveLength(4001)
  })
  it('hides only the index prompt itself and keeps the indexing process visible', () => {
    const prompt = buildNovelIndexPrompt()
    const snapshot = { nodes: [
      { kind: 'user', seq: 1, content: [{ type: 'text', text: prompt }] },
      { kind: 'assistant', seq: 2, blocks: [{ kind: 'tool-call', name: 'read', argsRaw: '{"path":"项目总览.md"}' }] },
      { kind: 'tool-result', seq: 3, callId: 'read', call: { name: 'read', argsRaw: '{}' }, content: [{ type: 'text', text: 'internal' }], isError: false },
      { kind: 'assistant', seq: 4, blocks: [{ kind: 'text', text: '已通过 novel_propose 更新 .dsh-editor/作品索引.md' }] },
      { kind: 'turn-finished', seq: 5 },
      { kind: 'turn-error', seq: 6 },
    ] }
    expect(chatRows(snapshot as never)).toEqual([
      { id: 'tool-result:3', role: 'tool', text: '已阅读作品资料', detail: 'read', content: 'internal' },
      { id: 'assistant:4', role: 'assistant', text: '已通过 novel_propose 更新 .dsh-editor/作品索引.md', detail: undefined },
      { id: 'turn-error:6', role: 'notice', text: '写作助手未能完成这次请求，请重试。' },
    ])
    expect(internalIndexTurnActive(snapshot as never)).toBe(true)
    /* 初始化指令原文（含"不可信数据"约束）不出现在 UI */
    expect(JSON.stringify(chatRows(snapshot as never))).not.toContain('不可信数据')

    const authorSnapshot = { nodes: [
      ...snapshot.nodes,
      { kind: 'user', seq: 7, content: [{ type: 'text', text: '讨论下一章' }] },
      { kind: 'assistant', seq: 8, blocks: [{ kind: 'tool-call', name: 'read', argsRaw: '{}' }] },
      { kind: 'tool-result', seq: 9, callId: 'read-2', call: { name: 'read', argsRaw: '{}' }, content: [{ type: 'text', text: 'raw' }], isError: false },
      { kind: 'step-finished', seq: 10 },
    ] }
    expect(chatRows(authorSnapshot as never)).toEqual([
      { id: 'tool-result:3', role: 'tool', text: '已阅读作品资料', detail: 'read', content: 'internal' },
      { id: 'assistant:4', role: 'assistant', text: '已通过 novel_propose 更新 .dsh-editor/作品索引.md', detail: undefined },
      { id: 'turn-error:6', role: 'notice', text: '写作助手未能完成这次请求，请重试。' },
      { id: 'user:7', role: 'user', text: '讨论下一章', projectContextReceipt: undefined },
      { id: 'tool-result:9', role: 'tool', text: '已阅读作品资料', detail: 'read', content: 'raw' },
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
      { name: 'novel_index_write', callId: 'hidden-index' },
      { name: 'novel_scratch_write', callId: 'hidden-scratch' },
      { name: 'novel_scratch_read', callId: 'hidden-scratch-read' },
      { name: 'novel_scratch_list', callId: 'hidden-scratch-list' },
      { name: 'read', callId: 'visible' },
    ])).toEqual([{ name: 'read', callId: 'visible' }])
  })
  it('completely hides internal index writes', () => {
    const snapshot = { nodes: [
      { kind: 'assistant', seq: 1, blocks: [{ kind: 'tool-call', name: 'novel_index_write', argsRaw: '{"text":"# 作品索引"}' }] },
      { kind: 'tool-result', seq: 2, callId: 'index', call: { name: 'novel_index_write', argsRaw: '{"text":"# 作品索引"}' }, content: [{ type: 'text', text: '作品索引已写入（5 字符）。' }], isError: false },
      { kind: 'assistant', seq: 3, blocks: [{ kind: 'text', text: '索引已建好。' }] },
    ] }
    expect(chatRows(snapshot as never)).toEqual([
      { id: 'assistant:3', role: 'assistant', text: '索引已建好。', detail: undefined },
    ])
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
    expect(partialView({ partial: { blocks: [{ kind: 'text', text: '流式正文' }] } } as never)).toEqual({ thinking: '', text: '流式正文' })
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
  it('never exposes error codes or nested calls, and truncates long tool output', () => {
    const row = toolResultRow({
      kind: 'tool-result', seq: 8, callId: 'root', call: { name: '写入', argsRaw: '{"path":"x"}' },
      content: [{ type: 'text', text: '写入被拒绝' }], isError: true, error: { name: 'Denied', code: 'sandbox-denied' },
      subCalls: [{ callId: 'child', name: '检查路径', argsRaw: '', turn: 1, step: 1, time: 1, callView: null, subCalls: [] }],
    } as never)
    expect(row).toMatchObject({ role: 'tool', text: '这项操作没有执行', detail: '写入', content: '写入被拒绝' })
    expect(JSON.stringify(row)).not.toContain('Denied')
    expect(JSON.stringify(row)).not.toContain('检查路径')
    const long = toolResultRow({
      kind: 'tool-result', seq: 9, callId: 'long', call: null,
      content: [{ type: 'text', text: 'x'.repeat(1300) }], isError: false, subCalls: [],
    } as never)
    expect(long).toMatchObject({ text: '操作已完成', detail: '工具 long' })
  })
})
