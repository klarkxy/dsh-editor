import { createHash } from 'node:crypto'
import type { AiFeatureScope } from '@klarkxy/dsh-ai-services/contracts'

export const WRITING_PURPOSES = [
  { id: 'manuscript.completion', label: '正文补全', defaultTarget: { kind: 'role' as const, role: 'weak' as const } },
  { id: 'manuscript.rewrite', label: '选区改写', defaultTarget: { kind: 'role' as const, role: 'normal' as const } },
]
export async function runWritingAi(input: {
  scope?: AiFeatureScope; purpose: string; sessionId?: string; system: string; text: string; signal: AbortSignal; maxChars: number
}): Promise<string> {
  if (input.signal.aborted) return ''
  if (!input.scope) throw new Error('写作模型服务未启用')
  const result = await input.scope.run({
    purpose: input.purpose, sessionId: input.sessionId, input: input.text, system: input.system,
    sourceVersion: createHash('sha256').update(input.system).update('\0').update(input.text).digest('hex'),
    promptVersion: 'writing-v1', insert: { maxChars: input.maxChars }, signal: input.signal, priority: 'interactive',
  })
  if (input.signal.aborted || input.scope.signal.aborted || ['superseded', 'skipped'].includes(result.receipt.status)) return ''
  if (result.receipt.status === 'cancelled') throw new Error(result.receipt.error || '写作模型调用已取消')
  if (result.receipt.status !== 'success') throw new Error(result.receipt.error || '写作模型调用失败')
  return result.text
}
