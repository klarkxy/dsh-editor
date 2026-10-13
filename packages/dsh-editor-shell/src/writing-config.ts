import type { Context, Volatile } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { SettingsForms } from '@deepseek-ai/dsh-settings'
import { AUTHOR_MEMORY_MAX_CHARS, AUTHOR_PREFERENCES_MAX_CHARS, normalizeAuthorMemory, normalizeAuthorPreferences } from './author-preferences.ts'
import { appendAuthorMemory } from './author-memory.ts'
import { COMPLETION_DELAY, WRITING_SETTINGS_NAMESPACE, type EditorWritingPreferences, type WritingPreferences } from './writing-settings-contract.ts'

export const Config = Schema.object({
  completion: Schema.union(['manual', 'pause']).default('manual').volatile(),
  completionDelayMs: Schema.number().min(COMPLETION_DELAY.min).max(COMPLETION_DELAY.max).default(COMPLETION_DELAY.default).volatile(),
  completionModel: Schema.object({ provider: Schema.string().default(''), model: Schema.string().default(''), reasoningEffort: Schema.string().default('') }).default({ provider: '', model: '', reasoningEffort: '' }).volatile(),
  rewriteModel: Schema.object({ provider: Schema.string().default(''), model: Schema.string().default(''), reasoningEffort: Schema.string().default('') }).default({ provider: '', model: '', reasoningEffort: '' }).volatile(),
  chatModel: Schema.object({ provider: Schema.string().default(''), model: Schema.string().default(''), reasoningEffort: Schema.string().default('') }).default({ provider: '', model: '', reasoningEffort: '' }).volatile(),
  writingModelsImported: Schema.boolean().default(false).hidden().volatile(),

  authorPreferences: Schema.string().max(AUTHOR_PREFERENCES_MAX_CHARS).default('').volatile(),
  authorMemory: Schema.string().max(AUTHOR_MEMORY_MAX_CHARS).default('').volatile(),
  typewriter: Schema.boolean().default(false).volatile(),
  focusParagraph: Schema.boolean().default(false).volatile(),
  fontSize: Schema.number().min(14).max(28).default(17).volatile(),
  lineHeight: Schema.number().min(1.4).max(2.4).default(1.9).volatile(),
  fontFamily: Schema.union(['serif', 'sans', 'mono']).default('sans').volatile(),
  paragraphSpacing: Schema.number().min(0).max(1.5).default(0.25).volatile(),
  paperWidth: Schema.union(['narrow', 'medium', 'wide']).default('medium').volatile(),
  firstLineIndent: Schema.boolean().default(false).volatile(),
  centerSectionMarks: Schema.boolean().default(true).volatile(),
})


export const name = 'dsh-editor-writing-settings'
export const inject = ['settings'] as const

/** Serialize tool appends; namespace revisions protect concurrent author edits. */
export function createAuthorMemoryWriter(settings: Pick<SettingsForms, 'describe' | 'mutate' | 'writable'>): EditorWritingPreferences['remember'] {
  let tail: Promise<unknown> = Promise.resolve()
  return (observation) => {
    const run = tail.then(async () => {
      if (!observation.trim()) throw new Error('作者侧写观察不能为空。')
      const namespace = settings.describe().find(entry => entry.ns === WRITING_SETTINGS_NAMESPACE)
      if (!settings.writable || !namespace) throw new Error('作者侧写配置暂不可写。')
      const value = namespace.value as { authorMemory?: unknown } | undefined
      if (typeof value?.authorMemory !== 'string') throw new Error('作者侧写配置无效，未修改。')
      const next = appendAuthorMemory(value.authorMemory, observation)
      if (next === undefined) return 'already-present' as const
      await settings.mutate(WRITING_SETTINGS_NAMESPACE, [{ op: 'set', path: ['authorMemory'], value: next }], namespace.revision)
      return 'added' as const
    })
    tail = run.then(() => undefined, () => undefined)
    return run
  }
}

export function apply(ctx: Context, config: Record<string, Volatile<unknown>>): void {
  const preferences: EditorWritingPreferences = {
    read: () => ({ ...Object.fromEntries(Object.entries(config).map(([key, field]) => [key, field.get()])), authorPreferences: normalizeAuthorPreferences(config.authorPreferences?.get()), authorMemory: normalizeAuthorMemory(config.authorMemory?.get()) }) as unknown as WritingPreferences,
    remember: createAuthorMemoryWriter(ctx.get('settings') as SettingsForms),
  }
  ctx.provide('editorWritingPreferences', preferences)
}
