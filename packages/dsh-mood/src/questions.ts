import type {
  AskUserQuestionAnswer, AskUserQuestionItem, ClarificationItem, ClarificationStatus,
} from './contracts.ts'
import { isBlockingKind, type TriggerKind } from './trigger.ts'

/** Native option label; selecting it without custom text is not an answer. */
export const ASK_DETAIL_OPTION = '补充说明'

export function toAskItems(items: readonly ClarificationItem[]): AskUserQuestionItem[] {
  return items.filter(item => item.status === 'pending').map(item => ({
    id: item.id,
    header: '澄清',
    question: item.question,
    options: [
      { label: ASK_DETAIL_OPTION, description: '在自定义输入中写明范围、约束或验收标准' },
    ],
  }))
}

export function pendingClarifications(questions: readonly string[]): ClarificationItem[] {
  return questions.map((question, index) => ({
    id: `q${index + 1}`,
    question,
    status: 'pending',
  }))
}

function answerText(item: { selected: string[]; custom?: string }): string {
  const selected = item.selected.map(entry => entry.trim()).filter(Boolean).filter(entry => entry !== ASK_DETAIL_OPTION)
  const custom = item.custom?.trim() ?? ''
  if (custom && selected.length) return `${selected.join('；')}；${custom}`
  if (custom) return custom
  return selected.join('；')
}

export function applyAnswers(
  items: readonly ClarificationItem[],
  answer: AskUserQuestionAnswer | undefined,
): ClarificationItem[] {
  const byId = new Map((answer?.answers ?? []).map(entry => [entry.id, entry]))
  return items.map(item => {
    if (item.status !== 'pending') return item
    const entry = byId.get(item.id)
    if (!entry) return { ...item, status: 'skipped' as const }
    const text = answerText(entry)
    if (!text) return { ...item, status: 'skipped' as const }
    return { ...item, status: 'answered' as const, answer: text.slice(0, 400) }
  })
}

export function markClarification(items: readonly ClarificationItem[], status: ClarificationStatus): ClarificationItem[] {
  return items.map(item => item.status === 'pending' ? { ...item, status } : item)
}

export function readinessAfterAnswers(
  items: readonly ClarificationItem[],
  kind: TriggerKind = 'mild',
): 'user-confirmed' | 'disclosed-assumptions' | 'pending' {
  if (items.some(item => item.status === 'pending')) return 'pending'
  if (items.length === 0) return 'user-confirmed'
  if (items.every(item => item.status === 'answered')) return 'user-confirmed'
  if (isBlockingKind(kind)) return 'pending'
  return 'disclosed-assumptions'
}

export function answeredNotes(items: readonly ClarificationItem[]): string[] {
  return items.filter(item => item.status === 'answered' && item.answer).map(item => `${item.question}：${item.answer}`)
}

export function isAskAborted(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const row = error as { name?: unknown; code?: unknown }
  if (row.code === 'ASK_ABORTED' || row.code === 'ASK_CANCELLED') return true
  const name = String(row.name ?? '')
  return name === 'AbortError' || name === 'TimeoutError'
}

export function isAbortLike(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true
  if (!error || typeof error !== 'object') return false
  const row = error as { name?: unknown; code?: unknown }
  const name = String(row.name ?? '')
  const code = String(row.code ?? '')
  return name === 'AbortError' || name === 'TimeoutError' || code === 'ABORT_ERR' || code === 'ABORTED' || isAskAborted(error)
}
