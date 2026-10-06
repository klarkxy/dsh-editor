import { defineDomain, domainTable, type DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import type { SettingsForms } from '@deepseek-ai/dsh-settings'
import { z } from 'zod'
import { WRITING_SETTINGS_NAMESPACE, type WritingModelRoute } from './writing-settings-contract.ts'

export const NATIVE_WRITING_IMPORT = 'editor-native-writing-v1'
/** Compatibility reader only. Keep unknown historical fields and receipts unchanged. */
const legacyDomain = defineDomain({
  name: 'dsh_editor_ai_services', version: 1,
  tables: {
    policy: domainTable(z.object({
      purposes: z.record(z.string(), z.unknown()),
      roles: z.record(z.string(), z.unknown()),
      imports: z.array(z.string()).optional(),
    }).passthrough()),
    receipts: domainTable(z.unknown()),
  },
})

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
function route(value: unknown): WritingModelRoute | undefined {
  const raw = record(value)
  if (!raw) return undefined
  if (typeof raw.provider !== 'string' || typeof raw.model !== 'string' || !raw.provider.trim() || !raw.model.trim()) throw new Error('旧模型路由缺少提供方或模型。')
  const effort = typeof raw.reasoningEffort === 'string' ? raw.reasoningEffort.trim() : ''
  return { provider: raw.provider.trim(), model: raw.model.trim(), ...(effort ? { reasoningEffort: effort === 'none' ? 'off' : effort } : {}) }
}

export function legacyWritingRoutes(policy: { purposes: Record<string, unknown>; roles: Record<string, unknown> }): Partial<Record<'chatModel' | 'completionModel' | 'rewriteModel', WritingModelRoute>> {
  const values: Partial<Record<'chatModel' | 'completionModel' | 'rewriteModel', WritingModelRoute>> = {}
  for (const [purpose, field] of [['chat', 'chatModel'], ['manuscript.completion', 'completionModel'], ['manuscript.rewrite', 'rewriteModel']] as const) {
    const target = record(policy.purposes[purpose])
    if (!target) continue
    let selected: WritingModelRoute | undefined
    if (target.kind === 'model') selected = route(target)
    else if (target.kind === 'role') selected = route(policy.roles[String(target.role)] ?? policy.roles.normal)
    else if (target.kind !== 'session') throw new Error('旧写作用途的模型路由格式无效。')
    values[field] = selected ?? { provider: '', model: '', reasoningEffort: '' }
  }
  return values
}

/** Persist to native live settings before marking the retired policy imported. No old service is loaded. */
export async function importWritingModels(storage: DomainFacility, settings: Pick<SettingsForms, 'describe' | 'mutate' | 'writable'>): Promise<void> {
  const domain = await storage.open(legacyDomain)
  try {
    const table = domain.table('policy')
    const policy = table.get('current')
    if (!policy || policy.imports?.includes(NATIVE_WRITING_IMPORT)) return
    const namespace = settings.describe().find(entry => entry.ns === WRITING_SETTINGS_NAMESPACE)
    // The native fence shares the SAME durable mutation as the imported fields.
    // A failed historical marker write must never reapply routes over later author edits.
    if (record(namespace?.user)?.writingModelsImported !== true) {
      const routes = legacyWritingRoutes(policy)
      const ops = [
        ...Object.entries(routes).map(([field, value]) => ({ op: 'set' as const, path: [field], value })),
        { op: 'set' as const, path: ['writingModelsImported'], value: true },
      ]
      if (!settings.writable || !namespace) throw new Error('原生写作配置暂不可写。')
      await settings.mutate(WRITING_SETTINGS_NAMESPACE, ops, namespace.revision)
      const committed = record(settings.describe().find(entry => entry.ns === WRITING_SETTINGS_NAMESPACE)?.user)
      if (committed?.writingModelsImported !== true) throw new Error('写作模型配置迁移标记尚未落盘。')
      for (const [field, expected] of Object.entries(routes)) {
        const actual = record(committed?.[field])
        if (!actual || actual.provider !== expected.provider || actual.model !== expected.model || (actual.reasoningEffort || '') !== (expected.reasoningEffort || '')) throw new Error('写作模型配置迁移尚未落盘。')
      }
    }
    await table.put('current', { ...policy, imports: [...(policy.imports ?? []), NATIVE_WRITING_IMPORT] })
  } finally { await domain.close() }
}
