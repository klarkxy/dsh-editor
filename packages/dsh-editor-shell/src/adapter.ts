import type {
  AssistantBlock,
  ConversationNode,
  ConversationSnapshot,
  PendingInteraction,
  SessionFace,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ApprovalResponsePayload,
  ConnectionHandle,
  PromptContentPart,
  QuestionResponsePayload,
  RpcReceipt,
  RpcResult,
  SessionId,
  SessionModels,
} from '@deepseek-ai/dsh-client-connection/client'
import { parseAuthorMemoryMarker, parseProposalMarker, type AuthorMemoryMarker, type ProposalMarker } from 'dsh-editor-novel-kernel/contracts'
import { parseProjectContextEnvelope, projectContextReceipt, type ProjectContextReceiptBundle } from 'dsh-editor-workbench/contracts'
import { parseMemoryUpdateReceipt, type MemoryUpdateReceipt } from 'dsh-editor-workbench/contracts'
import { t } from './i18n/index.ts'
import { stripReasoningText } from './conversation-lifecycle.ts'
import { isNovelIndexJobPrompt } from './novel-index.ts'

export { parseAuthorMemoryMarker, parseProposalMarker } from 'dsh-editor-novel-kernel/contracts'

const HIDDEN_TOOL_NAMES = new Set(['novel_knowledge', 'project_knowledge', 'novel_index_write', 'novel_scratch_write', 'novel_scratch_read', 'novel_scratch_list'])
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
  /** Tool call failed or was rejected; the row renders as an alert, expanded by default. */
  error?: boolean
  /** Author-readable cause of a failed tool call, shown above the verbatim body. */
  reason?: string
  proposal?: ProposalMarker
  memory?: AuthorMemoryMarker
  /** novel_memory_update 的 JSON 回执标记；命中时聊天行渲染成记忆更新确认卡。 */
  memoryUpdate?: MemoryUpdateReceipt
  projectContextReceipt?: ProjectContextReceiptBundle
}

export type QuestionAnswerItem = { id: string; selected: string[]; custom?: string }

export type PermissionProjection = {
  currentValue: string
  options: Array<{ value: string; name: string; description?: string }>
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

/** 区分不同 kind 的提案,以便聊天行展示对应的"提案"标签文案。renames 不带 path 字段,需要在使用前 narrow。 */
function proposalDetailText(proposal: ProposalMarker): string {
  switch (proposal.kind) {
    case 'split': return t('adapter.splitProposal')
    case 'merge': return t('adapter.mergeProposal')
    case 'renames': return t('adapter.renamesProposal')
    case 'edit':
    case 'create':
      return t('adapter.editProposal')
  }
}

export function toolResultRow(node: Extract<ConversationNode, { kind: 'tool-result' }>): ChatRow {
  const body = blocksText(node.content)
  const name = node.call?.name ?? t('adapter.toolFallback', { id: node.callId })
  const proposal = name === 'novel_propose' ? parseProposalMarker(body) : undefined
  if (proposal) {
    return { id: `tool-result:${node.seq}`, role: 'tool', text: proposal.summary, detail: proposalDetailText(proposal), proposal }
  }
  const memory = name === 'author_observe' ? parseAuthorMemoryMarker(body) : undefined
  if (memory) {
    return { id: `tool-result:${node.seq}`, role: 'tool', text: memory.observation, detail: t('adapter.rememberProposal'), memory }
  }
  const memoryUpdate = name === 'novel_memory_update' ? parseMemoryUpdateReceipt(body) : undefined
  if (memoryUpdate) {
    return { id: `tool-result:${node.seq}`, role: 'tool', text: memoryUpdate.summary, detail: t('adapter.memoryUpdate'), memoryUpdate }
  }
  if (node.isError) {
    return { id: `tool-result:${node.seq}`, role: 'tool', text: t('adapter.notExecuted'), detail: name, content: truncateToolContent(body) || undefined, error: true, reason: toolErrorReason(name, body) }
  }
  const friendly = name === 'glob' || name === 'grep' ? t('adapter.searchedNotes') : name === 'read' ? t('adapter.readNotes') : t('adapter.done')
  return { id: `tool-result:${node.seq}`, role: 'tool', text: friendly, detail: name, content: truncateToolContent(body) || undefined }
}

const TOOL_CONTENT_LIMIT = 4000

/** editorToolGuard 兜底分支的整体拒绝文案；翻成作者能看懂的原因，不照搬英文原文。 */
const GUARD_REJECTION = 'only allows project search, read, and previewable proposals'

function toolErrorReason(name: string, body: string): string {
  const firstLine = body.split('\n').map((line) => line.trim()).find(Boolean) ?? ''
  if (firstLine.includes(GUARD_REJECTION)) {
    return t('adapter.guardRejected', { name })
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

export function chatRows(snapshot: ConversationSnapshot): ChatRow[] {
  const rows: ChatRow[] = []
  for (const node of snapshot.nodes) {
    const common = { id: `${node.kind}:${node.seq}` }
    if (node.kind === 'user' || node.kind === 'steering') {
      const text = blocksText(node.content)
      /* 初始化（建索引）指令本身不展示,但它之后的思考、查找与总结照常可见,
         让作者能看到初始化正在进行的过程。 */
      if (isNovelIndexJobPrompt(text)) continue
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
      const { thinking, text: assistantText } = splitAssistantContent(node.blocks)
      if (isNovelIndexJobPrompt(assistantText)) continue
      if (thinking) rows.push({ id: `${node.kind}:${node.seq}:thinking`, role: 'thinking', text: thinking })
      if (!assistantText) continue
      rows.push({
        ...common,
        role: 'assistant',
        text: assistantText,
        detail: node.interrupted ? t('adapter.stopped') : undefined,
      })
      continue
    }
    if (node.kind === 'tool-result') {
      if (isHiddenToolResult(node)) continue
      rows.push(toolResultRow(node))
    }
    else if (node.kind === 'turn-error') rows.push({ ...common, role: 'notice', text: t('chat.requestFailed') })
    else if (node.kind === 'model-retry') rows.push({ ...common, role: 'notice', text: t('chat.retrying') })
  }
  return rows
}

export function internalIndexTurnActive(snapshot: ConversationSnapshot): boolean {
  let active = false
  for (const node of snapshot.nodes) {
    if (node.kind === 'user' || node.kind === 'steering') active = isNovelIndexJobPrompt(blocksText(node.content))
  }
  return active
}

export function partialView(snapshot: ConversationSnapshot): { thinking: string; text: string } {
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

export async function sendProjectContext(
  session: SessionFace,
  userRequest: string,
  compile: () => Promise<{ serialized: string; receipt: ProjectContextReceiptBundle }>,
): Promise<{ result: RpcResult<{ accepted: true }> | undefined; receipt: ProjectContextReceiptBundle } | undefined> {
  const trimmed = userRequest.trim()
  if (!trimmed) return undefined
  const compiled = await compile()
  return { result: await send(session, compiled.serialized), receipt: compiled.receipt }
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

export async function readModels(connection: ConnectionHandle, sessionId: SessionId): Promise<RpcResult<SessionModels>> {
  return (await connection.api.sessions.models({ sessionId })).result
}

export async function selectModel(
  connection: ConnectionHandle,
  sessionId: SessionId,
  provider: string,
  model: string,
  reasoningEffort?: string,
): Promise<RpcResult<{ selected: { provider: string; model: string; reasoningEffort?: string } }>> {
  return (await connection.api.sessions.selectModel({ sessionId, provider, model, reasoningEffort })).result
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
