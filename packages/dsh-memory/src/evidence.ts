import type { EvidenceRef, KnowledgeKind, NewMemoryRecord } from './contracts.ts'
import { fail, MEMORY_EVIDENCE, MEMORY_INVALID, MEMORY_SCOPE } from './errors.ts'

const HUMAN_KINDS: readonly KnowledgeKind[] = ['preference', 'project-fact', 'vocabulary', 'activity']

export function hasEvidence(refs: readonly EvidenceRef[]): boolean {
  return refs.some(ref => ref.sessionId.trim().length > 0 && Number.isFinite(ref.seq) && ref.seq >= 0)
}

/** Preference/fact candidates need evidence or an explicit manual (user) add. Never infer global. */
export function assertCreatable(record: NewMemoryRecord): void {
  if (record.scope.kind === 'project' && !record.scope.projectId.trim()) {
    fail(MEMORY_SCOPE, '项目记忆需要会话工作目录，不能改写为全局。')
  }
  if (record.kind !== 'lesson' && (record.source === 'self-improvement' || record.procedure)) {
    fail(MEMORY_INVALID, '行动经验不能写入语境知识。')
  }
  if (record.kind === 'activity' && (!record.expiresAt || (record.context && !record.context.activityStatus))) {
    fail(MEMORY_INVALID, '近期状态必须有复核期限；有结构化语境时必须注明状态。')
  }
  if (record.context && record.kind !== 'vocabulary' && record.kind !== 'activity') {
    fail(MEMORY_INVALID, '用语与活动元数据只能写入对应的语境条目。')
  }
  if (record.kind === 'lesson') {
    if (record.context) fail(MEMORY_INVALID, '教训不能包含作者用语或近期状态。')
    if (record.source !== 'self-improvement' && record.source !== 'user') {
      fail(MEMORY_INVALID, '教训条目只能由自我改进或手动添加写入。')
    }
    return
  }
  if (HUMAN_KINDS.includes(record.kind)) {
    if (record.source === 'user') return
    if (record.source === 'dream' && hasEvidence(record.evidence)) return
    if (hasEvidence(record.evidence) && (record.source === 'memory' || record.source === 'dream')) return
    fail(MEMORY_EVIDENCE, '偏好和项目事实需要原文依据，或由作者手动添加。')
  }
}

export function assertNoSilentGlobal(explicitGlobal: boolean, projectId: string | undefined): void {
  if (explicitGlobal) return
  if (!projectId) fail(MEMORY_SCOPE, '当前会话没有项目目录。写入全局须明确勾选。')
}
