import type { AiServices, ModelTarget } from '@klarkxy/dsh-ai-services/contracts'

export function legacyWritingTargets(value: unknown): Record<string, ModelTarget> {
  const settings = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const defaults: Record<string, ModelTarget> = {}
  for (const [field, purpose] of [['completionModel', 'manuscript.completion'], ['rewriteModel', 'manuscript.rewrite']]) {
    const raw = settings[field]
    const route = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
    const provider = typeof route.provider === 'string' ? route.provider.trim() : ''
    const model = typeof route.model === 'string' ? route.model.trim() : ''
    const effort = typeof route.reasoningEffort === 'string' ? route.reasoningEffort.trim() : ''
    defaults[purpose] = provider || model ? { kind: 'model', provider, model, ...(effort && effort !== 'off' && effort !== 'none' ? { reasoningEffort: effort } : {}) } : { kind: 'session' }
  }
  return defaults
}
export async function importWritingModels(ai: AiServices, settings: unknown): Promise<void> {
  await ai.importPurposes('manuscript-writing-v1', legacyWritingTargets(settings))
}
