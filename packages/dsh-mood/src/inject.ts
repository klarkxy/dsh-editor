import { createUserMessage } from '@deepseek-ai/dsh-llm'
import {
  CONTRACT_SECTION, MOOD_PLUGIN, readinessLabel, type ClarificationItem, type TaskContract,
} from './contracts.ts'
import { isMoodMessage, type UserMessageLike } from './evidence.ts'

export interface ContractMessageInput {
  source: {
    kind: 'plugin'
    plugin: string
    form: 'snapshot'
    sections: Array<{ name: string; text: string }>
  }
  content: Array<{ type: 'text'; text: string }>
}

export function contractMessageInput(text: string): ContractMessageInput {
  return {
    source: {
      kind: 'plugin',
      plugin: MOOD_PLUGIN,
      form: 'snapshot',
      sections: [{ name: CONTRACT_SECTION, text }],
    },
    content: [{ type: 'text', text }],
  }
}

export function createMoodContextMessage(text: string): unknown {
  return createUserMessage(contractMessageInput(text))
}

export function formatContract(contract: TaskContract, clarification: readonly ClarificationItem[] = []): string {
  const lines = [
    `【需求约定 · ${readinessLabel(contract.readiness)}】`,
    contract.goal ? `目标：${contract.goal}` : '',
    contract.deliverables.length ? `交付：${contract.deliverables.join('；')}` : '',
    contract.inScope.length ? `范围内：${contract.inScope.join('；')}` : '',
    contract.outOfScope.length ? `范围外：${contract.outOfScope.join('；')}` : '',
    contract.constraints.length ? `约束：${contract.constraints.join('；')}` : '',
    contract.acceptance.length ? `验收：${contract.acceptance.join('；')}` : '',
    contract.assumptions.length ? `假定：${contract.assumptions.join('；')}` : '',
  ]
  if (clarification.length) {
    lines.push('澄清：')
    for (const item of clarification) {
      const answer = item.answer ? ` → ${item.answer}` : ''
      lines.push(`- [${item.status}] ${item.question}${answer}`)
    }
  } else if (contract.questions.length) {
    lines.push(`待确认：${contract.questions.join('；')}`)
  }
  if (contract.evidence.length) {
    lines.push('证据：' + contract.evidence.map((item: { seq: number; excerpt?: string }) => `#${item.seq}${item.excerpt ? `「${item.excerpt}」` : ''}`).join(' '))
  }
  lines.push('本约定不能代替文件修改或发布审批。未确认前不要当作已授权。')
  return lines.filter(Boolean).join('\n')
}

export function mergeContractMessage(
  messages: readonly unknown[],
  extra: unknown,
): unknown[] {
  const kept = messages.filter(message => !isMoodMessage(message as UserMessageLike))
  return [...kept, extra]
}
