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
import { parseProposalMarker, type ProposalMarker } from 'dsh-editor-novel-kernel/contracts'
import { parseProjectContextEnvelope, projectContextReceipt, type ProjectContextReceiptBundle } from 'dsh-editor-workbench/contracts'

export { parseProposalMarker } from 'dsh-editor-novel-kernel/contracts'

const HIDDEN_TOOL_NAMES = new Set(['novel_knowledge'])

export function visibleRunningCalls<T extends { name: string }>(calls: readonly T[]): T[] {
  return calls.filter((call) => !HIDDEN_TOOL_NAMES.has(call.name))
}

export type ChatRow = {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'notice' | 'unknown'
  text: string
  detail?: string
  proposal?: ProposalMarker
  projectContextReceipt?: ProjectContextReceiptBundle
}

export type QuestionAnswerItem = { id: string; selected: string[]; custom?: string }

export type PermissionProjection = {
  currentValue: string
  options: Array<{ value: string; name: string; description?: string }>
}

export function blocksText(blocks: readonly AssistantBlock[] | readonly unknown[], depth = 0): string {
  return blocks.map((block) => {
    if (!block || typeof block !== 'object') return String(block ?? '')
    const value = block as { kind?: string; type?: string; text?: string; name?: string; argsRaw?: string; content?: unknown[] }
    if (value.kind === 'text' || value.kind === 'reasoning' || value.type === 'text') return value.text ?? ''
    if (value.type === 'tool-result' && Array.isArray(value.content) && depth < 2) return blocksText(value.content, depth + 1)
    if (value.kind === 'tool-call') return ''
    return value.text ?? ''
  }).filter(Boolean).join('\n')
}

export function toolResultRow(node: Extract<ConversationNode, { kind: 'tool-result' }>): ChatRow {
  const body = blocksText(node.content)
  const name = node.call?.name ?? `工具 ${node.callId}`
  const proposal = name === 'novel_propose' ? parseProposalMarker(body) : undefined
  if (proposal) {
    return { id: `tool-result:${node.seq}`, role: 'tool', text: proposal.summary, detail: '写作助手提出了一项文件修改', proposal }
  }
  if (node.isError) {
    return { id: `tool-result:${node.seq}`, role: 'tool', text: '这项操作没有执行', detail: '写作助手无法完成这项操作。' }
  }
  const friendly = name === 'glob' || name === 'grep' ? '已查找作品资料' : name === 'read' ? '已阅读作品资料' : '操作已完成'
  return { id: `tool-result:${node.seq}`, role: 'tool', text: friendly, detail: '已完成' }
}

function isHiddenToolResult(node: Extract<ConversationNode, { kind: 'tool-result' }>): boolean {
  if (node.call && HIDDEN_TOOL_NAMES.has(node.call.name)) return true
  return blocksText(node.content).includes('<novel_knowledge ')
}

export function chatRows(snapshot: ConversationSnapshot): ChatRow[] {
  const rows: ChatRow[] = []
  for (const node of snapshot.nodes) {
    if (node.kind === 'tool-result' && isHiddenToolResult(node)) continue
    const common = { id: `${node.kind}:${node.seq}` }
    if (node.kind === 'user' || node.kind === 'steering') {
      const text = blocksText(node.content)
      const envelope = parseProjectContextEnvelope(text)
      rows.push({
        ...common,
        role: 'user',
        text: envelope?.user_request ?? text,
        projectContextReceipt: envelope ? projectContextReceipt(envelope) : undefined,
      })
      continue
    }
    if (node.kind === 'assistant') {
      const assistantText = blocksText(node.blocks)
      const onlyHiddenToolCall = !assistantText && node.blocks.some((block) => {
        if (!block || typeof block !== 'object') return false
        const value = block as { kind?: string; name?: string }
        return value.kind === 'tool-call' && value.name !== undefined && HIDDEN_TOOL_NAMES.has(value.name)
      })
      if (onlyHiddenToolCall) continue
      rows.push({
        ...common,
        role: 'assistant',
        text: assistantText,
        detail: node.interrupted ? '已停止' : undefined,
      })
      continue
    }
    if (node.kind === 'tool-result') rows.push(toolResultRow(node))
    else if (node.kind === 'turn-error') rows.push({ ...common, role: 'notice', text: '写作助手未能完成这次请求，请重试。' })
    else if (node.kind === 'model-retry') rows.push({ ...common, role: 'notice', text: '写作助手正在重新尝试…' })
    else if (node.kind === 'unknown') rows.push({ ...common, role: 'unknown', text: '收到一项暂时无法显示的消息。' })
    else rows.push({ ...common, role: 'notice', text: '状态已更新。' })
  }
  return rows
}

export function partialText(snapshot: ConversationSnapshot): string {
  return snapshot.partial ? blocksText(snapshot.partial.blocks) : ''
}

export function pendingRows(pending: readonly PendingInteraction[]): ChatRow[] {
  return pending.map((item) => ({
    id: item.key,
    role: 'notice',
    text: item.kind === 'approval' ? '等待确认一项操作' : '等待你的回答',
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
): Promise<RpcResult<{ selected: { provider: string; model: string; reasoningEffort?: string } }>> {
  return (await connection.api.sessions.selectModel({ sessionId, provider, model })).result
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
  if (!result.value.matched) throw new Error('当前 DSH 未提供 /permission 命令')
}
