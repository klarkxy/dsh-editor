import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { SETTINGS_KEY, defaultSettings, isTitleLocaleMode, type TitleSettings } from './contracts.ts'

export { SETTINGS_KEY }

export const titleSettingsSchema = z.object({
  revision: z.number().int().nonnegative(),
  locale: z.enum(['auto', 'zh', 'en']),
}).strict()

export const titleDomain = defineDomain({
  name: 'dsh_editor_current_title',
  version: 1,
  tables: {
    settings: domainTable<string, TitleSettings>(titleSettingsSchema),
  },
})

export function parseTitleSettings(value: unknown): TitleSettings | undefined {
  const parsed = titleSettingsSchema.safeParse(value)
  if (!parsed.success) return undefined
  if (!isTitleLocaleMode(parsed.data.locale)) return undefined
  return parsed.data
}

export function storedSettings(value: unknown, fallbackLocale: TitleSettings['locale'] = 'auto'): TitleSettings {
  return parseTitleSettings(value) ?? defaultSettings(fallbackLocale)
}
