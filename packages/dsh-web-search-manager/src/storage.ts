import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { migrateSearchOrder } from './contracts.ts'
export const settingsSchema = z.object({
  revision: z.number().int().nonnegative(),
  searchEnabled: z.boolean(), fetchEnabled: z.boolean(),
  searchProvider: z.string().max(64), fetchProvider: z.string().max(64),
  searchOrder: z.array(z.string().min(1).max(64)).max(32),
  maxResults: z.number().int().min(1).max(20), maxQueries: z.number().int().min(1).max(5),
  timeoutMs: z.number().int().min(1000).max(120_000), maxFetchChars: z.number().int().min(1000).max(200_000),
  endpoints: z.record(z.string().regex(/^(search|fetch):[a-z][a-z0-9-]{0,63}$/), z.string().max(2048))
    .refine(value => Object.keys(value).length <= 50),
}).strict()
export const updateSchema = z.object({
  expectedRevision: z.number().int().nonnegative(), settings: settingsSchema.omit({ revision: true }),
}).strict()
export const storedSettingsSchema = settingsSchema.extend({
  searchOrder: settingsSchema.shape.searchOrder.optional(),
}).transform(settings => ({ ...settings, searchOrder: migrateSearchOrder(settings) }))
export const webSettingsDomain = defineDomain({
  name: 'dsh_editor_web_search', version: 1,
  tables: { settings: domainTable<string, z.output<typeof storedSettingsSchema>>(storedSettingsSchema) },
})
