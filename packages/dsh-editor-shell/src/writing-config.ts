import type { Context, Volatile } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { AUTHOR_MEMORY_MAX_CHARS, AUTHOR_PREFERENCES_MAX_CHARS, normalizeAuthorMemory, normalizeAuthorPreferences } from './author-preferences.ts'
import { COMPLETION_DELAY, type WritingPreferences } from './writing-settings-contract.ts'

export const Config = Schema.object({
  completion: Schema.union(['manual', 'pause']).default('manual').volatile(),
  completionDelayMs: Schema.number().min(COMPLETION_DELAY.min).max(COMPLETION_DELAY.max).default(COMPLETION_DELAY.default).volatile(),
  completionModel: Schema.object({ provider: Schema.string().default(''), model: Schema.string().default(''), reasoningEffort: Schema.string().default('') }).default({ provider: '', model: '', reasoningEffort: '' }).volatile(),
  rewriteModel: Schema.object({ provider: Schema.string().default(''), model: Schema.string().default(''), reasoningEffort: Schema.string().default('') }).default({ provider: '', model: '', reasoningEffort: '' }).volatile(),
  chatModel: Schema.object({ provider: Schema.string().default(''), model: Schema.string().default(''), reasoningEffort: Schema.string().default('') }).default({ provider: '', model: '', reasoningEffort: '' }).volatile(),

  authorPreferences: Schema.string().max(AUTHOR_PREFERENCES_MAX_CHARS).default('').volatile(),
  authorMemory: Schema.string().max(AUTHOR_MEMORY_MAX_CHARS).default('').volatile(),
  typewriter: Schema.boolean().default(false).volatile(),
  focusParagraph: Schema.boolean().default(false).volatile(),
  fontSize: Schema.number().min(14).max(28).default(17).volatile(),
  lineHeight: Schema.number().min(1.4).max(2.4).default(1.9).volatile(),
  fontFamily: Schema.union(['serif', 'sans', 'mono']).default('serif').volatile(),
  paragraphSpacing: Schema.number().min(0).max(1.5).default(0).volatile(),
  paperWidth: Schema.union(['narrow', 'medium', 'wide']).default('wide').volatile(),
})


export const name = 'dsh-editor-writing-settings'
export function apply(ctx: Context, config: Record<string, Volatile<unknown>>): void {
  ctx.provide('editorWritingPreferences', { read: () => ({ ...Object.fromEntries(Object.entries(config).map(([key, field]) => [key, field.get()])), authorPreferences: normalizeAuthorPreferences(config.authorPreferences?.get()), authorMemory: normalizeAuthorMemory(config.authorMemory?.get()) }) as unknown as WritingPreferences })
}
