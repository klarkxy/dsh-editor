import type { Context } from '@deepseek-ai/cordis'
import { asHost } from './host.ts'
import { assembleGrillPrompt } from './prompts/index.ts'

export const name = 'dsh-grill-workflow'
export const inject = ['systemPrompt'] as const

export const GRILL_PROMPT_SECTION = 'grill:workflow'
export const GRILL_PROMPT_ORDER = 140

export function apply(ctx: Context): void {
  asHost(ctx).systemPrompt.section({
    name: GRILL_PROMPT_SECTION,
    order: GRILL_PROMPT_ORDER,
    text: assembleGrillPrompt(),
  })
}
