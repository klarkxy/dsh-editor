import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Callout, Flex, Text } from '@radix-ui/themes'
import type { ConnectionHandle, SettingsScope, SettingsScopeSnapshot } from '../dsh-compat.ts'
import { normalizeWritingEffort, normalizeWritingModelRoute, type WritingModelRoute, type WritingPreferences } from '../writing-settings.tsx'
import { Select, type SelectOption } from './select.tsx'
import { effortDisplay, effortTriggerLabel } from './chat-model-picker.tsx'
import { ActivityText, Button } from './ui/index.ts'
import { t, useLocale } from '../i18n/index.ts'

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
function routeOptions(route: WritingModelRoute | undefined, catalog: CatalogModelOption[], fallback: string): SelectOption[] {
  const options = [{ value: '', label: fallback }, ...catalog.map(item => ({ value: routeKey(item), label: item.label }))]
  if (route && !options.some(item => item.value === routeKey(route))) {
    const label = route.provider && route.model ? `${route.provider} · ${route.model}` : route.model || route.provider
    options.push({ value: routeKey(route), label: t('models.missingModel', { label }) })
  }
  return options
}
export function WritingModelRoutesView(props: {
  snapshot: SettingsScopeSnapshot<WritingPreferences>; catalog: CatalogModelOption[]; writable: boolean
  saving?: boolean; failure?: string; chatOnly?: boolean
  onSave(field: WritingModelField, route: WritingModelRoute | undefined): void
  onRetry?(): void
}): ReactNode {
  const zh = useLocale() !== 'en'
  const disabled = !props.writable || props.snapshot.status !== 'ready' || props.snapshot.writable === false || props.saving === true
  return <>
    {WRITING_PURPOSES.filter(row => !props.chatOnly || row.field === 'chatModel').map(row => {
      const route = normalizeWritingModelRoute(props.snapshot.value?.[row.field])
      const label = t(row.label)
      const fallback = row.field === 'chatModel' ? (zh ? 'DSH 默认模型' : 'DSH default model') : t('models.followChat')
      const options = routeOptions(route, props.catalog, fallback)
      const value = route ? routeKey(route) : ''
      const efforts = (props.catalog.find(item => item.provider === route?.provider && item.model === route?.model)?.efforts ?? []).map(item => ({ value: normalizeWritingEffort(item.id) ?? item.id, label: effortDisplay(item.id) || item.name }))
      if (route?.reasoningEffort && !efforts.some(item => item.value === route.reasoningEffort)) efforts.push({ value: route.reasoningEffort, label: effortDisplay(route.reasoningEffort) || route.reasoningEffort })
      return <Flex key={row.field} className="settings-row models-writing-route" align="center" justify="between" gap="4" minWidth="0" py="2">
        <Text size="2" weight="medium">{label}</Text>
        <Flex className="models-writing-route-controls" align="center" gap="2" minWidth="0">
          <Select value={value} selectedLabel={options.find(option => option.value === value)?.label} options={options} disabled={disabled} aria-label={label} onChange={value => {
            const next = parseRouteKey(value)
            const reasoningEffort = next && carriedReasoningEffort(route, next, props.catalog)
            props.onSave(row.field, next && reasoningEffort ? { ...next, reasoningEffort } : next)
          }} />
          {route ? <span className="model-effort"><Select value={route.reasoningEffort ?? ''} options={[{ value: '', label: zh ? '模型默认' : 'Model default' }, ...efforts]}
            disabled={disabled} aria-label={`${label} · ${t('chat.reasoning')}`}
            selectedLabel={route.reasoningEffort ? effortTriggerLabel(route.reasoningEffort) : (zh ? '模型默认' : 'Model default')} onChange={value => {
              const { reasoningEffort: _old, ...selection } = route
              props.onSave(row.field, value ? { ...selection, reasoningEffort: value } : selection)
            }} /></span> : null}
        </Flex>
      </Flex>
    })}
    {props.snapshot.status === 'loading' ? <ActivityText>{t('common.loading')}</ActivityText> : null}
    {props.failure || props.snapshot.status === 'unavailable' ? <Callout.Root color="red" role="alert">
      <Callout.Text>{props.failure || t('models.routeLoadFailed')}</Callout.Text>
      {props.onRetry ? <Button onClick={props.onRetry}>{t('common.retry')}</Button> : null}
    </Callout.Root> : null}
  </>
}
export function WritingModelRoutes(props: {
  connection?: ConnectionHandle; scope: SettingsScope<WritingPreferences>; catalog: CatalogModelOption[]; writable: boolean; showSharedPurposes?: boolean
}): ReactNode {
  const subscribe = useCallback((listener: () => void) => props.scope.subscribe(listener), [props.scope])
  const getSnapshot = useCallback(() => props.scope.getSnapshot(), [props.scope])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState('')
  const pending = useRef(false)
  const failedWrite = useRef<{ field: WritingModelField; route: WritingModelRoute | undefined }>()
  const generation = useRef(0)
  useEffect(() => {
    generation.current++
    pending.current = false
    failedWrite.current = undefined
    setSaving(false)
    setFailure('')
    return () => { generation.current++ }
  }, [props.scope])
  const save = async (field: WritingModelField, route: WritingModelRoute | undefined) => {
    if (pending.current) return
    pending.current = true
    const ticket = generation.current
    setSaving(true)
    setFailure('')
    failedWrite.current = undefined
    try { await saveWritingModelRoute(props.scope, field, route) }
    catch (error) {
      if (ticket === generation.current) {
        failedWrite.current = { field, route }
        setFailure(error instanceof Error ? error.message : String(error))
      }
    }
    finally { if (ticket === generation.current) { pending.current = false; setSaving(false) } }
  }
  return <WritingModelRoutesView snapshot={snapshot} catalog={props.catalog} writable={props.writable} saving={saving} failure={failure}
    chatOnly={props.showSharedPurposes === false} onSave={(field, route) => { void save(field, route) }} onRetry={failedWrite.current ? () => {
      const failed = failedWrite.current
      if (failed) void save(failed.field, failed.route)
    } : undefined} />
}
export function EditorModelSettings(props: { scope: SettingsScope<WritingPreferences>; catalog: CatalogModelOption[]; writable: boolean }): ReactNode {
  const zh = useLocale() !== 'en'
  return <section className="editor-model-settings" data-testid="editor-model-settings" aria-label={zh ? '模型设置' : 'Model settings'}><WritingModelRoutes {...props} /></section>
}
