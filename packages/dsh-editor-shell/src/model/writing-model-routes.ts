import type { SettingsScope } from '../dsh-compat.ts'
import {
  normalizeWritingEffort,
  normalizeWritingModelRoute,
  type WritingModelRoute,
  type WritingPreferences,
} from '../writing-settings-contract.ts'
import { t } from '../i18n/index.ts'

export type CatalogModelOption = { provider: string; model: string; label: string; efforts?: readonly { id: string; name: string }[] }
const ROUTE_SEP = '\u001f'
export const WRITING_PURPOSES = [
  { id: 'chat', field: 'chatModel', label: 'models.chatModel' },
  { id: 'manuscript.completion', field: 'completionModel', label: 'models.completionModel' },
  { id: 'manuscript.rewrite', field: 'rewriteModel', label: 'models.rewriteModel' },
] as const
export type WritingModelField = typeof WRITING_PURPOSES[number]['field']

export function mergeCatalogOptions(...lists: CatalogModelOption[][]): CatalogModelOption[] {
  const options: CatalogModelOption[] = []
  const seen = new Set<string>()
  for (const list of lists) for (const item of list) {
    const key = routeKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    options.push(item)
  }
  return options
}
export function catalogFromSessionGroups(groups: ReadonlyArray<{ id: string; name: string; models: ReadonlyArray<{ id: string; name: string; reasoning?: { efforts: readonly { id: string; name: string }[] } }> }>): CatalogModelOption[] {
  return groups.flatMap(group => group.models.map(model => ({ provider: group.id, model: model.id, efforts: model.reasoning?.efforts, label: `${group.name} · ${model.name}` })))
}
export function firstUsableCatalogModel(catalog: readonly CatalogModelOption[], usableProviders: Iterable<string>): CatalogModelOption | undefined {
  const usable = new Set(usableProviders)
  return catalog.find(item => usable.has(item.provider))
}
export function routeKey(route: WritingModelRoute): string { return `${route.provider}${ROUTE_SEP}${route.model}` }
export function parseRouteKey(value: string): WritingModelRoute | undefined {
  const split = value.indexOf(ROUTE_SEP)
  if (split <= 0) return undefined
  return normalizeWritingModelRoute({ provider: value.slice(0, split), model: value.slice(split + ROUTE_SEP.length) })
}
/** Preserve an effort on the same model, or only when its destination advertises it. */
export function carriedReasoningEffort(previous: WritingModelRoute | undefined, next: WritingModelRoute, catalog: readonly CatalogModelOption[]): string | undefined {
  const effort = normalizeWritingEffort(previous?.reasoningEffort)
  if (!effort || !previous) return undefined
  if (previous.provider === next.provider && previous.model === next.model) return effort
  return catalog.find(item => item.provider === next.provider && item.model === next.model)?.efforts?.some(item => normalizeWritingEffort(item.id) === effort) ? effort : undefined
}
/** Native SettingsScope owns durability and revision conflicts; edit only the selected field. */
export async function saveWritingModelRoute(scope: SettingsScope<WritingPreferences>, field: WritingModelField, route: WritingModelRoute | undefined): Promise<void> {
  const snapshot = scope.getSnapshot()
  if (snapshot.status !== 'ready' || snapshot.writable === false) throw new Error(t('models.readOnly'))
  const value = route ?? { provider: '', model: '', reasoningEffort: '' }
  const saved = await scope.mutate([{ op: 'set', path: [field], value }], snapshot.revision)
  if (saved === false) throw new Error(t('models.routeSaveFailed'))
}
