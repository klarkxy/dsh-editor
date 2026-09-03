import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { AUTHOR_MEMORY_MAX_CHARS, AUTHOR_PREFERENCES_MAX_CHARS, normalizeAuthorMemory, normalizeAuthorPreferences } from './author-preferences.ts'
import { WRITING_SETTINGS_NAMESPACE, type WritingPreferences } from './writing-settings-contract.ts'

export const name = 'dsh-editor-shell'
export const inject = ['settings'] as const

const WritingPreferencesSchema = Schema.object({
  completion: Schema.union(['manual', 'pause']).default('manual'),
  authorPreferences: Schema.transform(Schema.string().max(AUTHOR_PREFERENCES_MAX_CHARS), normalizeAuthorPreferences).default(''),
  authorMemory: Schema.transform(Schema.string().max(AUTHOR_MEMORY_MAX_CHARS), normalizeAuthorMemory).default(''),
})

/** Host owns the editor's one durable writing-preference namespace. */
export function apply(ctx: Context): void {
  ctx.settings.register<WritingPreferences>(settingsNamespace(WRITING_SETTINGS_NAMESPACE), WritingPreferencesSchema)
}
