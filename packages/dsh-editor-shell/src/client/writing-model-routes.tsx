import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Flex, Notice, Text } from '../ui/index.ts'
import type { ConnectionHandle, SettingsScope, SettingsScopeSnapshot } from '../dsh-compat.ts'
import { normalizeWritingEffort, normalizeWritingModelRoute, type WritingModelRoute, type WritingPreferences } from '../writing-settings.tsx'
import { Select } from './select.tsx'
import type { SelectOption } from '../model/select.ts'
import { effortDisplay, effortTriggerLabel } from '../model/chat-model-picker.ts'
import { ActivityText, Button } from './ui/index.ts'
import { t, useLocale } from '../i18n/index.ts'

import {
  carriedReasoningEffort,
  parseRouteKey,
  routeKey,
  saveWritingModelRoute,
  WRITING_PURPOSES,
  type CatalogModelOption,
  type WritingModelField,
} from '../model/writing-model-routes.ts'

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
    {props.failure || props.snapshot.status === 'unavailable' ? <Notice tone="danger"
      action={props.onRetry ? <Button onClick={props.onRetry}>{t('common.retry')}</Button> : null}>
      {props.failure || t('models.routeLoadFailed')}
    </Notice> : null}
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
