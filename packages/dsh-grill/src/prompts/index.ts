import { DRAFTING_PROMPT } from './drafting.ts'
import { FIRST_READER_PROMPT } from './first-reader.ts'
import { PLANNING_PROMPT } from './planning.ts'
import { REVIEW_PROMPT } from './review.ts'
import { ROUTER_PROMPT } from './router.ts'

export { DRAFTING_PROMPT, FIRST_READER_PROMPT, PLANNING_PROMPT, REVIEW_PROMPT, ROUTER_PROMPT }

/** One additive system-prompt section. Not four competing complete prompts. */
export function assembleGrillPrompt(): string {
  return [ROUTER_PROMPT, PLANNING_PROMPT, DRAFTING_PROMPT, REVIEW_PROMPT, FIRST_READER_PROMPT]
    .map((part) => part.trim())
    .join('\n\n')
}
