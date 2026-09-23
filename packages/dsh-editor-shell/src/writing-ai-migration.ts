import type { AiServices, ModelRoute, ModelTarget } from '@klarkxy/dsh-ai-services/contracts'

export function legacyWritingTargets(value: unknown): Record<string, ModelTarget> {
  const settings = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const defaults: Record<string, ModelTarget> = {}
  for (const [field, purpose] of [['completionModel', 'manuscript.completion'], ['rewriteModel', 'manuscript.rewrite']]) {
    const raw = settings[field]
    const route = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
    const provider = typeof route.provider === 'string' ? route.provider.trim() : ''
    const model = typeof route.model === 'string' ? route.model.trim() : ''
    const effort = typeof route.reasoningEffort === 'string' ? route.reasoningEffort.trim() : ''
    defaults[purpose] = provider || model ? { kind: 'model', provider, model, ...(effort && effort !== 'off' && effort !== 'none' ? { reasoningEffort: effort } : {}) } : { kind: 'role', role: field === 'completionModel' ? 'weak' : 'normal' }
  }
  return defaults
}
export async function importWritingModels(ai: AiServices, settings: unknown, hostDefault?: ModelRoute): Promise<void> {
  await ai.importPurposes('manuscript-writing-v1', legacyWritingTargets(settings))
  const record = settings && typeof settings === 'object' ? settings as Record<string, unknown> : {}
  const raw = record.chatModel as ModelRoute | undefined
  const legacy = raw && typeof raw.provider === 'string' && typeof raw.model === 'string' && raw.provider.trim() && raw.model.trim()
    ? { provider: raw.provider.trim(), model: raw.model.trim(), ...(raw.reasoningEffort?.trim() ? { reasoningEffort: raw.reasoningEffort.trim() } : {}) } : undefined
  const route = legacy ?? hostDefault
  // Import only missing bindings. Existing roles and explicit capability choices always win.
  await ai.importPurposes('model-tiers-v1', {
    chat: legacy && ai.getPolicy().roles.normal ? { kind: 'model', ...legacy } : { kind: 'role', role: 'normal' },
  }, route ? { normal: route } : {})
}
