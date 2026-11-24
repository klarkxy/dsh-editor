import type {
  ApprovalResponsePayload,
  AssistantBlock,
  ChatTranscript,
  ConversationNode,
  EditorRemote,
  QuestionResponsePayload,
  RpcResult,
  SessionFace,
  SessionId,
  SessionModels,
} from './dsh-compat.ts'
import { catalogToSessionModels, modelSelectionOf } from './dsh-compat.ts'
import { parseProposalMarker, type ProposalMarker } from 'dsh-editor-novel-kernel/contracts'
import { AUTHOR_OBSERVE_TOOL_NAME } from 'dsh-editor-workbench/contracts'
import { parseWritingProposalMarker, WRITING_PROPOSE_TOOL_NAME, type WritingProposalV2 } from 'dsh-manuscript/client/editor-core'
import { parseProjectContextEnvelope, projectContextReceipt, type ProjectContextReceiptBundle } from 'dsh-editor-workbench/contracts'
import { parseMemoryUpdateReceipt } from 'dsh-editor-workbench/contracts'
import { parseWritingChangeReceipt, WRITING_CHANGE_MARKER, WRITING_CHANGE_TOOL_NAME, type WritingChangeReceipt } from 'dsh-editor-workbench/contracts'
import { t, type MessageKey } from './i18n/index.ts'

import { isNovelIndexJobPrompt } from './novel-index.ts'
import { BOT_INIT_SENTINEL } from 'dsh-editor-workbench/contracts'

export { parseProposalMarker } from 'dsh-editor-novel-kernel/contracts'
export { parseWritingProposalMarker, WRITING_PROPOSE_TOOL_NAME } from 'dsh-manuscript/client/editor-core'

export type AuthorProposal = ProposalMarker | WritingProposalV2

export function parseAuthorProposal(text: string): AuthorProposal | undefined {
  return parseWritingProposalMarker(text) ?? parseProposalMarker(text)
}

export type LegacyProposalResult = { proposal: AuthorProposal; receiptId: string }

export function isLegacyProposalResult(value: unknown): value is LegacyProposalResult {
  if (!value || typeof value !== 'object') return false
  const entry = value as { proposal?: { marker?: unknown }; receiptId?: unknown }
  return typeof entry.receiptId === 'string' && entry.proposal?.marker === 'dsh-editor.proposal'
}

const HIDDEN_TOOL_NAMES = new Set(['novel_knowledge', 'novel_index_write', 'novel_scratch_write', 'novel_scratch_read', 'novel_scratch_list', AUTHOR_OBSERVE_TOOL_NAME])
const HIDDEN_REASONING_BLOCKS = new Set(['reasoning', 'thinking', 'thought', 'analysis'])

export function visibleRunningCalls<T extends { name: string }>(calls: readonly T[]): T[] {
  return calls.filter((call) => !HIDDEN_TOOL_NAMES.has(call.name))
}

export type ChatRow = {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'thinking' | 'notice' | 'unknown'
  text: string
  detail?: string
  /** Expandable verbatim body (tool result content); absent when there is nothing worth unfolding. */
  content?: string
  /** Tool call failed or was rejected; the row stays collapsed unless the author opens it. */
  error?: boolean
  /** Same-turn retry of this tool later succeeded; keep the failure folded and quiet. */
  recovered?: boolean
  /** Author-readable cause of a failed tool call, shown above the verbatim body. */
  reason?: string
  /** `writing_change` 直接写入回执；渲染为可撤销的写入卡。 */
  writingChange?: WritingChangeReceipt
  /** `node.call.name` when present; Chat looks up plugin message cards by this key. */
  toolName?: string
  /** Payload for a registered message card. Today: the parsed `novel_memory_update` receipt. */
  result?: unknown
  projectContextReceipt?: ProjectContextReceiptBundle
}

/* 上游 TurnErrorNode 的 LlmError code → 面向作者的动作指引;没有归类的 code
   保留通用文案,细节附上 sanitized message(截断)或 code 本身。 */
const TURN_FAILURE_KEYS: Record<string, MessageKey> = {
  MISSING_CREDENTIAL: 'chat.failure.credential',
  INVALID_CREDENTIAL: 'chat.failure.credential',
  AUTH: 'chat.failure.credential',
  ACCOUNT_TOKEN_INVALID: 'chat.failure.credential',
  ACCOUNT_SIGN_IN_REQUIRED: 'chat.failure.signIn',
  ACCOUNT_SIGNED_OUT: 'chat.failure.signIn',
  QUOTA: 'chat.failure.quota',
  ACCOUNT_QUOTA: 'chat.failure.quota',
  RATE_LIMIT: 'chat.failure.rateLimit',
  TRANSPORT: 'chat.failure.transport',
  TIMEOUT: 'chat.failure.transport',
  STREAM_CLOSED: 'chat.failure.transport',
  SERVER: 'chat.failure.server',
  UNKNOWN_MODEL: 'chat.failure.model',
  MODEL_UNSUPPORTED: 'chat.failure.model',
  HTTP_404: 'chat.failure.model',
  CONTEXT_WINDOW_EXCEEDED: 'chat.failure.context',
  CONTENT_REFUSED: 'chat.failure.refused',
  INTERRUPTED: 'chat.failure.interrupted',
}

export function turnFailureCopy(code: string | undefined, message: string | undefined): { text: string; detail?: string } {
  const key: MessageKey | undefined = code === undefined ? undefined
    : TURN_FAILURE_KEYS[code] ?? (/^HTTP_5\d\d$/.test(code) ? 'chat.failure.server' : undefined)
  if (key !== undefined) return { text: t(key) }
  const trimmed = (message ?? '').trim()
  return {
    text: t('chat.requestFailed'),
    ...(trimmed !== ''
      ? { detail: trimmed.length > 300 ? `${trimmed.slice(0, 299)}…` : trimmed }
      : code !== undefined ? { detail: code } : {}),
  }
}

export type QuestionAnswerItem = { id: string; selected: string[]; custom?: string }

export type PermissionProjection = {
  currentValue: string
  options: Array<{ value: string; name: string; description?: string }>
}

export type { ChatTranscript }

type PromptContentPart = { type: 'text'; text: string }
type RpcReceipt = { accepted?: boolean }

export type PendingApproval = {
  kind: 'approval'
  key: string
  sessionId: SessionId
  payload: { approvalId: string; toolName?: string; reason?: string }
  respond: (value: { ok: true; value: ApprovalResponsePayload }) => Promise<RpcReceipt>
}

export type PendingQuestion = {
  kind: 'question'
  key: string
  sessionId: SessionId
  payload: {
    questions: Array<{
      id: string
      header?: string
      question: string
      detail?: string
      options?: Array<{ label: string; description?: string }>
    }>
  }
  respond: (value: { ok: true; value: QuestionResponsePayload }) => Promise<RpcReceipt>
}

export type PendingInteraction = PendingApproval | PendingQuestion

export type SessionRemote = EditorRemote['session']

export function stripReasoningText(text: string): string {
  return text
    .replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/giu, '')
    .replace(/<think\b[^>]*>[\s\S]*$/giu, '')
    .replace(/<\/?think\b[^>]*>/giu, '')
    .trim()
}

export function blocksText(blocks: readonly AssistantBlock[] | readonly unknown[], depth = 0): string {
  const text = blocks.map((block) => {
    if (!block || typeof block !== 'object') return String(block ?? '')
    const value = block as { kind?: string; type?: string; text?: string; name?: string; argsRaw?: string; content?: unknown[] }
    const blockKind = (value.kind ?? value.type ?? '').toLocaleLowerCase()
    if (HIDDEN_REASONING_BLOCKS.has(blockKind)) return ''
    if (value.kind === 'text' || value.type === 'text') return value.text ?? ''
    if (value.type === 'tool-result' && Array.isArray(value.content) && depth < 2) return blocksText(value.content, depth + 1)
    if (value.kind === 'tool-call') return ''
    return value.text ?? ''
  }).filter(Boolean).join('\n')
  return stripReasoningText(text)
}

/** Split one text chunk into think-island content and visible prose. */
function splitThinkIslands(text: string): { thinking: string; text: string } {
  const islands: string[] = []
  const rest = text
    .replace(/<think\b[^>]*>([\s\S]*?)<\/think\s*>/giu, (_match, inner: string) => { islands.push(inner); return '' })
    .replace(/<think\b[^>]*>([\s\S]*)$/giu, (_match, inner: string) => { islands.push(inner); return '' })
    .replace(/<\/?think\b[^>]*>/giu, '')
  return { thinking: islands.map((island) => island.trim()).filter(Boolean).join('\n'), text: rest.trim() }
}

/**
 * Split assistant blocks into collapsible reasoning and visible reply text.
 * Reasoning-kind blocks and inline `<think>` islands go to `thinking`;
 * tool-call blocks carry no prose and surface through their tool-result rows.
 */
export function splitAssistantContent(blocks: readonly AssistantBlock[] | readonly unknown[]): { thinking: string; text: string } {
  const thinkingParts: string[] = []
  const textParts: string[] = []
  for (const block of blocks) {
    if (!block || typeof block !== 'object') {
      const fallback = String(block ?? '').trim()
      if (fallback) textParts.push(fallback)
      continue
    }
    const value = block as { kind?: string; type?: string; text?: string }
    const blockKind = (value.kind ?? value.type ?? '').toLocaleLowerCase()
    if (HIDDEN_REASONING_BLOCKS.has(blockKind)) {
      const reasoning = value.text?.trim()
      if (reasoning) thinkingParts.push(reasoning)
      continue
    }
    if (value.kind === 'tool-call') continue
    const raw = value.text ?? ''
    if (!raw.trim()) continue
    const split = splitThinkIslands(raw)
    if (split.thinking) thinkingParts.push(split.thinking)
    if (split.text) textParts.push(split.text)
  }
  return { thinking: thinkingParts.join('\n'), text: textParts.join('\n') }
}

export function toolResultRow(node: Extract<ConversationNode, { kind: 'tool-result' }>): ChatRow {
  const body = blocksText(node.content)
  const name = node.call?.name ?? t('adapter.toolFallback', { id: node.callId })
  const toolName = node.call?.name
  const writingChange = name === WRITING_CHANGE_TOOL_NAME ? parseWritingChangeReceipt(body) : undefined
  if (writingChange) {
    return { id: `tool-result:${node.seq}`, role: 'tool', text: writingChange.summary, toolName, result: writingChange, writingChange }
  }
  if (name === WRITING_CHANGE_TOOL_NAME && node.isError) {
    const recovered = body.match(/记录 ([a-f0-9]{32})/)
    if (recovered) {
      const stub: WritingChangeReceipt = {
        marker: WRITING_CHANGE_MARKER, version: 1, id: recovered[1]!,
        kind: 'edit', summary: t('adapter.changeRecover'), status: 'applied',
        paths: [], count: 0, message: body.split('\n').map((line) => line.trim()).find(Boolean),
      }
      return { id: `tool-result:${node.seq}`, role: 'tool', text: stub.summary, toolName, result: stub, writingChange: stub }
    }
  }
  /* 旧版提案行只读展示：不再调用任何 prepare/apply 端点。回执查询区分当时已写入与从未写入。 */
  const proposal = name === 'novel_propose' || name === WRITING_PROPOSE_TOOL_NAME ? parseAuthorProposal(body) : undefined
  if (proposal) {
    return {
      id: `tool-result:${node.seq}`, role: 'tool', text: proposal.summary,
      detail: t('adapter.legacyProposal'), toolName,
      result: { proposal, receiptId: `tool-result:${node.seq}` },
    }
  }
  const memoryUpdate = name === 'novel_memory_update' ? parseMemoryUpdateReceipt(body) : undefined
  if (memoryUpdate) {
    return { id: `tool-result:${node.seq}`, role: 'tool', text: memoryUpdate.summary, detail: t('adapter.memoryUpdate'), toolName, result: memoryUpdate }
  }
  if (node.isError) {
    return { id: `tool-result:${node.seq}`, role: 'tool', text: t('adapter.notExecuted'), detail: name, content: truncateToolContent(body) || undefined, error: true, reason: toolErrorReason(name, body), toolName }
  }
  const friendly = name === 'glob' || name === 'grep' ? t('adapter.searchedNotes') : name === 'read' ? t('adapter.readNotes') : t('adapter.done')
  return { id: `tool-result:${node.seq}`, role: 'tool', text: friendly, detail: name, content: truncateToolContent(body) || undefined, toolName }
}

const TOOL_CONTENT_LIMIT = 4000

/** editorToolGuard 兜底分支的整体拒绝文案；翻成作者能看懂的原因，不照搬英文原文。 */
const GUARD_REJECTION = 'only allows project search, read, and previewable proposals'

function toolErrorReason(name: string, body: string): string {
  const firstLine = body.split('\n').map((line) => line.trim()).find(Boolean) ?? ''
  if (firstLine.includes(GUARD_REJECTION)) {
    return t('adapter.guardRejected', { name })
  }
  if (/project-relative/i.test(firstLine) || /absolute and device paths/i.test(firstLine)) {
    return t('adapter.pathRejected')
  }
  if (firstLine) return firstLine.length > 160 ? `${firstLine.slice(0, 160)}…` : firstLine
  return t('adapter.rejected')
}

function truncateToolContent(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > TOOL_CONTENT_LIMIT ? `${trimmed.slice(0, TOOL_CONTENT_LIMIT)}…` : trimmed
}

function isHiddenToolResult(node: Extract<ConversationNode, { kind: 'tool-result' }>): boolean {
  if (node.call && HIDDEN_TOOL_NAMES.has(node.call.name)) return true
  return blocksText(node.content).includes('<novel_knowledge ')
}

function nodeContent(node: ConversationNode): readonly unknown[] {
  return 'content' in node && Array.isArray(node.content) ? node.content : []
}

function nodeBlocks(node: ConversationNode): readonly unknown[] {
  return 'blocks' in node && Array.isArray(node.blocks) ? node.blocks : []
}

function asToolResult(node: ConversationNode): Extract<ConversationNode, { kind: 'tool-result' }> | undefined {
  if (node.kind !== 'tool-result' || !('callId' in node) || !('content' in node)) return undefined
  return node as Extract<ConversationNode, { kind: 'tool-result' }>
}

export function chatRows(snapshot: ChatTranscript): ChatRow[] {
  const rows: ChatRow[] = []
  for (const node of snapshot.nodes) {
    const common = { id: `${node.kind}:${node.seq}` }
    if (node.kind === 'user' || node.kind === 'steering') {
      const text = blocksText(nodeContent(node))
      /* 初始化（建索引）指令本身不展示,但它之后的思考、查找与总结照常可见,
         让作者能看到初始化正在进行的过程。 */
      if (isNovelIndexJobPrompt(text)) continue
      if (text.startsWith(BOT_INIT_SENTINEL)) continue
      const envelope = parseProjectContextEnvelope(text)
      rows.push({
        ...common,
        role: 'user',
        text: envelope?.user_request ?? text,
        /* V3 轻量请求没有注入清单，不挂空回执；V1/V2 历史消息仍展示旧回执。 */
        projectContextReceipt: envelope && envelope.version !== 3 ? projectContextReceipt(envelope) : undefined,
      })
      continue
    }
    if (node.kind === 'assistant') {
      const { thinking, text: assistantText } = splitAssistantContent(nodeBlocks(node))
      if (isNovelIndexJobPrompt(assistantText)) continue
      if (thinking) rows.push({ id: `${node.kind}:${node.seq}:thinking`, role: 'thinking', text: thinking })
      if (!assistantText) continue
      rows.push({
        ...common,
        role: 'assistant',
        text: assistantText,
        detail: 'interrupted' in node && node.interrupted ? t('adapter.stopped') : undefined,
      })
      continue
    }
    if (node.kind === 'tool-result') {
      const tool = asToolResult(node)
      if (!tool || isHiddenToolResult(tool)) continue
      rows.push(toolResultRow(tool))
    }
    else if (node.kind === 'turn-error') {
      const copy = turnFailureCopy(
        typeof node.code === 'string' ? node.code : undefined,
        typeof node.message === 'string' ? node.message : undefined,
      )
      rows.push({ ...common, role: 'notice', text: copy.text, detail: copy.detail })
    }
    else if (node.kind === 'model-retry') rows.push({ ...common, role: 'notice', text: t('chat.retrying') })
  }
  return markRecoveredToolErrors(rows)
}

/** 同一轮里同名工具后来成功了，就不要把先前的失败条一直当警报摊开。 */
export function markRecoveredToolErrors(rows: ChatRow[]): ChatRow[] {
  const recoveredIds = new Set<string>()
  let turnStart = 0
  const scanTurn = (end: number) => {
    const succeeded = new Set<string>()
    for (let index = end - 1; index >= turnStart; index--) {
      const row = rows[index]
      if (row.role !== 'tool' || !row.toolName) continue
      if (!row.error) succeeded.add(row.toolName)
      else if (succeeded.has(row.toolName)) recoveredIds.add(row.id)
    }
  }
  rows.forEach((row, index) => {
    if (row.role === 'user') {
      scanTurn(index)
      turnStart = index
    }
  })
  scanTurn(rows.length)
  if (!recoveredIds.size) return rows
  return rows.map((row) => recoveredIds.has(row.id)
    ? { ...row, recovered: true, text: t('adapter.retried') }
    : row)
}

export function internalIndexTurnActive(snapshot: ChatTranscript): boolean {
  let active = false
  for (const node of snapshot.nodes) {
    if (node.kind === 'user' || node.kind === 'steering') active = isNovelIndexJobPrompt(blocksText(nodeContent(node)))
  }
  return active
}

export function partialView(snapshot: ChatTranscript): { thinking: string; text: string } {
  if (!snapshot.partial) return { thinking: '', text: '' }
  const { thinking, text } = splitAssistantContent(snapshot.partial.blocks)
  return {
    thinking,
    text: text.replace(/<t(?:h(?:i(?:n(?:k(?:\s[^>]*)?)?)?)?)?$/iu, '').trim(),
  }
}

export function pendingRows(pending: readonly PendingInteraction[]): ChatRow[] {
  return pending.map((item) => ({
    id: item.key,
    role: 'notice',
    text: item.kind === 'approval' ? t('adapter.waitingApproval') : t('adapter.waitingAnswer'),
    detail: undefined,
  }))
}

/** Thin behavior adapter: delegates to the existing runtime session, never a second stream. */
export async function send(session: SessionFace, text: string): Promise<RpcResult<{ accepted: true }> | undefined> {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  return session.prompt([{ type: 'text', text: trimmed } satisfies PromptContentPart], 'queue')
}


export async function stop(session: SessionFace): Promise<RpcResult<{ accepted: true }>> {
  return session.cancel()
}

export async function loadOlder(session: SessionFace): Promise<void> {
  await session.loadOlder()
}

export function select(open: (id: SessionId) => void, id: SessionId): void {
  open(id)
}

export async function answerApproval(
  wait: Extract<PendingInteraction, { kind: 'approval' }>,
  outcome: ApprovalResponsePayload['outcome'],
): Promise<RpcReceipt> {
  const value: ApprovalResponsePayload = {
    sessionId: wait.sessionId,
    approvalId: wait.payload.approvalId,
    outcome,
  }
  return wait.respond({ ok: true, value })
}

export async function answerQuestions(
  wait: Extract<PendingInteraction, { kind: 'question' }>,
  answers: QuestionAnswerItem[],
): Promise<RpcReceipt> {
  const value: QuestionResponsePayload = {
    sessionId: wait.sessionId,
    answer: { answers },
  }
  return wait.respond({ ok: true, value })
}

export async function readModels(remote: SessionRemote, session: SessionFace): Promise<RpcResult<SessionModels>> {
  const catalog = await remote.modelCatalog()
  if (!catalog.ok) return catalog
  const current = modelSelectionOf(session.projections.faceOf('modelSelection').getSnapshot())
  return { ok: true, value: catalogToSessionModels(catalog.value, current) }
}

export async function selectModel(
  remote: SessionRemote,
  sessionId: SessionId,
  provider: string,
  model: string,
  reasoningEffort?: string,
): Promise<RpcResult<{ selected: { provider: string; model: string; reasoningEffort?: string } }>> {
  return remote.selectModel({ sessionId, provider, model, reasoningEffort })
}

export function permissionProjection(session: SessionFace): PermissionProjection | undefined {
  const value = session.projections.faceOf('permissions').getSnapshot()
  if (!value || typeof value !== 'object') return undefined
  const projection = value as Partial<PermissionProjection>
  if (typeof projection.currentValue !== 'string' || !Array.isArray(projection.options)) return undefined
  return projection as PermissionProjection
}

export async function selectPermission(session: SessionFace, preset: string): Promise<void> {
  const result = await session.command(`/permission ${preset}`)
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
  if (!result.value.matched) throw new Error(t('error.permissionUnsupported'))
}
