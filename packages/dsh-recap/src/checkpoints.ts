import type { EvidenceRef, TaskCheckpoint, TaskContract } from '@klarkxy/dsh-ai-services/contracts'
import {
  MAX_CHECKPOINT_CHARS,
  MEANINGFUL_TOOL_DELTA,
  RECAP_CHECKPOINT_PURPOSE,
  RECAP_PLUGIN,
  type RecapFacts,
  type RecapToolFact,
} from './contracts.ts'
import { incomingMessagesAreRecapOnly } from './log.ts'

function checkpointItemState(tool: RecapToolFact): TaskCheckpoint['items'][number]['state'] {
  if (tool.outcome === 'cancelled' || tool.proposedChange) return 'pending'
  if (tool.outcome === 'failed' || tool.error) return 'failed'
  if (tool.outcome === 'verified') return 'verified'
  return 'pending'
}

function checkpointItemLabel(tool: RecapToolFact): string {
  if (tool.proposedChange) return `${tool.name}：提出修改（未确认已写入）`
  if (tool.outcome === 'cancelled') return `${tool.name}：已取消`
  if (tool.outcome === 'missing') return `${tool.name}：结果缺失`
  if (tool.outcome === 'unknown') return `${tool.name}：未知`
  if (tool.outcome === 'unverified') return `${tool.name}：未核实`
  if (tool.outcome === 'failed' || tool.error) return `${tool.name}：调用失败`
  return tool.name
}

export function checkpointStatus(facts: RecapFacts): TaskCheckpoint['status'] {
  if (facts.sourceStatus === 'completed') return 'completed'
  if (facts.sourceStatus === 'cancelled') return 'cancelled'
  if (facts.sourceStatus === 'failed') return 'failed'
  return 'running'
}

export function sameCheckpointLineage(
  row: Pick<TaskCheckpoint, 'sessionId' | 'sourceVersion' | 'contractVersion'>,
  current: { sessionId: string; sourceVersion: string; contractVersion?: number },
): boolean {
  return row.sessionId === current.sessionId
    && row.sourceVersion === current.sourceVersion
    && row.contractVersion === current.contractVersion
}

export function checkpointLineageKey(sourceVersion: string, contractVersion?: number): string {
  return contractVersion === undefined ? `${sourceVersion}\0` : `${sourceVersion}\0${contractVersion}`
}

export function isCheckpointLineageStale(
  checkpoint: Pick<TaskCheckpoint, 'sessionId' | 'sourceVersion' | 'contractVersion' | 'toSeq'>,
  current: { sessionId: string; sourceVersion: string; contractVersion?: number; toSeq: number },
): boolean {
  if (checkpoint.sessionId !== current.sessionId) return true
  if (checkpoint.sourceVersion !== current.sourceVersion && checkpoint.toSeq < current.toSeq) return true
  if (checkpoint.contractVersion !== current.contractVersion) return true
  return false
}

export function buildCheckpoint(
  facts: RecapFacts,
  input: {
    id: string
    now: number
    revision: number
    contract?: TaskContract
  },
): TaskCheckpoint {
  const items: TaskCheckpoint['items'] = facts.tools.map(tool => ({
    label: checkpointItemLabel(tool),
    state: checkpointItemState(tool),
    evidence: [{ sessionId: facts.sessionId, seq: tool.seq, kind: 'tool' as const, excerpt: tool.name }],
  }))
  if (facts.lastUserExcerpt) {
    items.unshift({
      label: '作者要求',
      state: 'verified',
      evidence: [{ sessionId: facts.sessionId, seq: facts.fromSeq, kind: 'user', excerpt: facts.lastUserExcerpt }],
    })
  }
  const constraints = [...(input.contract?.constraints ?? []), ...facts.constraints]
  const nextAction = facts.sourceStatus === 'running'
    ? (facts.proposals ? '等待作者确认修改，不要假定已写入' : '继续当前任务')
    : facts.sourceStatus === 'cancelled' ? '任务已取消，等待作者下一步' : facts.sourceStatus === 'failed' ? '任务未成功结束，等待作者下一步' : '本段已结束'
  return {
    id: input.id,
    sessionId: facts.sessionId,
    sourceVersion: facts.sourceVersion,
    contractVersion: input.contract?.revision,
    fromSeq: facts.fromSeq,
    toSeq: facts.toSeq,
    revision: input.revision,
    status: checkpointStatus(facts),
    items,
    constraints: [...new Set(constraints)],
    nextAction,
    createdAt: input.now,
  }
}

export function isMeaningfulCheckpointBoundary(input: {
  facts: RecapFacts
  previous?: Pick<TaskCheckpoint, 'toSeq' | 'sourceVersion' | 'contractVersion'>
  incoming: ReadonlyArray<{ source?: { kind?: string; plugin?: string } }>
  step: number
  contractVersion?: number
}): boolean {
  if (incomingMessagesAreRecapOnly(input.incoming)) return false
  const contractChanged = input.previous !== undefined && input.previous.contractVersion !== input.contractVersion
  if (input.previous?.sourceVersion === input.facts.sourceVersion && !contractChanged) return false
  const toolDelta = input.previous ? input.facts.tools.filter(tool => tool.seq > input.previous!.toSeq).length : input.facts.tools.length
  if (contractChanged) return true
  if (input.facts.sourceStatus !== 'running') return toolDelta > 0 || !input.previous
  if (toolDelta >= MEANINGFUL_TOOL_DELTA) return true
  if (input.step === 1 && input.facts.turn !== undefined && input.facts.turn > 1 && toolDelta > 0) return true
  return false
}

export function shouldRunSemanticCheckpoint(enabled: boolean, facts: RecapFacts, contract?: TaskContract): boolean {
  if (!enabled) return false
  if (facts.sourceStatus === 'running' && !contract) return false
  return Boolean(contract) || facts.tools.length >= MEANINGFUL_TOOL_DELTA || facts.sourceStatus !== 'running'
}

export function checkpointInjectPayload(checkpoint: TaskCheckpoint): {
  source: { kind: 'plugin'; plugin: string; form: 'snapshot'; sections: Array<{ name: string; text: string }> }
  content: Array<{ type: 'text'; text: string }>
} {
  const lines = [
    `检查点 ${checkpoint.fromSeq}–${checkpoint.toSeq} · ${checkpoint.status}`,
    checkpoint.constraints.length ? `约束：${checkpoint.constraints.join('；')}` : '',
    ...checkpoint.items.slice(0, 12).map(item => `- ${item.label}（${item.state}）`),
    `下一步：${checkpoint.nextAction}`,
  ].filter(Boolean)
  const text = lines.join('\n').slice(0, MAX_CHECKPOINT_CHARS)
  return {
    source: { kind: 'plugin', plugin: RECAP_PLUGIN, form: 'snapshot', sections: [{ name: 'checkpoint', text }] },
    content: [{ type: 'text', text }],
  }
}

export function checkpointSemanticRequest(checkpoint: TaskCheckpoint, facts: RecapFacts): { purpose: string; system: string; input: string; sourceVersion: string; sessionId: string; contractVersion?: number } {
  return {
    purpose: RECAP_CHECKPOINT_PURPOSE,
    sessionId: checkpoint.sessionId,
    sourceVersion: checkpoint.sourceVersion,
    contractVersion: checkpoint.contractVersion,
    system: '在给定约束和证据上补充检查点条目。不要把工具提案写成已经写入。不要把回顾卡片当作任务状态。',
    input: JSON.stringify({
      status: checkpoint.status,
      constraints: checkpoint.constraints,
      items: checkpoint.items,
      tools: facts.tools,
    }),
  }
}

export function evidenceOf(sessionId: string, seq: number, kind: EvidenceRef['kind'], excerpt?: string): EvidenceRef {
  return excerpt ? { sessionId, seq, kind, excerpt } : { sessionId, seq, kind }
}
