import { createElement as e, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { SettingsScope } from '../dsh-compat.ts'
import {
  normalizeWritingModelRoute,
  writingModelRouteValue,
  writingPreferences,
  type WritingModelRoute,
  type WritingPreferences,
} from '../writing-settings.ts'
import { Select, type SelectOption } from './select.tsx'
import { t, useLocale } from '../i18n/index.ts'

export type CatalogModelOption = {
  provider: string
  model: string
  label: string
}

const ROUTE_SEP = '\u001f'

export function mergeCatalogOptions(...lists: CatalogModelOption[][]): CatalogModelOption[] {
  const options: CatalogModelOption[] = []
  const seen = new Set<string>()
  for (const list of lists) {
    for (const item of list) {
      const key = `${item.provider}${ROUTE_SEP}${item.model}`
      if (seen.has(key)) continue
      seen.add(key)
      options.push(item)
    }
  }
  return options
}

export function catalogFromSessionGroups(groups: ReadonlyArray<{ id: string; name: string; models: ReadonlyArray<{ id: string; name: string }> }>): CatalogModelOption[] {
  return groups.flatMap((group) => group.models.map((model) => ({
    provider: group.id,
    model: model.id,
    label: `${group.name} · ${model.name}`,
  })))
}

const EMPTY = ''

function routeKey(route: WritingModelRoute): string {
  return `${route.provider}${ROUTE_SEP}${route.model}`
}

function parseRouteKey(value: string): WritingModelRoute | undefined {
  if (!value) return undefined
  const split = value.indexOf(ROUTE_SEP)
  if (split <= 0) return undefined
  return normalizeWritingModelRoute({
    provider: value.slice(0, split),
    model: value.slice(split + ROUTE_SEP.length),
  })
}

function optionFor(route: WritingModelRoute, catalog: CatalogModelOption[], fallbackLabel: string): SelectOption {
  const key = routeKey(route)
  const found = catalog.find((item) => item.provider === route.provider && item.model === route.model)
  if (found) return { value: key, label: found.label }
  const label = route.provider && route.model ? `${route.provider} · ${route.model}` : route.model || route.provider
  return { value: key, label: t('models.missingModel', { label: label || fallbackLabel }) }
}

export function WritingModelRoutes(props: {
  scope: SettingsScope<WritingPreferences>
  catalog: CatalogModelOption[]
  writable: boolean
}): ReactNode {
  useLocale()
  const snapshot = useSyncExternalStore(
    props.scope.subscribe.bind(props.scope),
    props.scope.getSnapshot.bind(props.scope),
    props.scope.getSnapshot.bind(props.scope),
  )
  const values = writingPreferences(snapshot)
  const writable = props.writable && snapshot.status === 'ready' && snapshot.writable !== false
  const [saving, setSaving] = useState<keyof WritingPreferences | null>(null)
  const [failure, setFailure] = useState('')

  const update = async (field: 'completionModel' | 'rewriteModel' | 'chatModel', value: string) => {
    setSaving(field)
    setFailure('')
    try {
      const route = writingModelRouteValue(parseRouteKey(value))
      await props.scope.set(field, route)
      const committed = props.scope.getSnapshot()
      const user = committed.user && typeof committed.user === 'object' ? committed.user as Record<string, unknown> : undefined
      if (!user || !Object.prototype.hasOwnProperty.call(user, field)) throw new Error('write did not commit')
    } catch {
      setFailure(t('models.routeFailed'))
    } finally {
      setSaving(null)
    }
  }

  const rows: Array<{ field: 'completionModel' | 'rewriteModel' | 'chatModel'; label: 'models.completionModel' | 'models.rewriteModel' | 'models.chatModel'; empty: string }> = [
    { field: 'completionModel', label: 'models.completionModel', empty: t('models.followChat') },
    { field: 'rewriteModel', label: 'models.rewriteModel', empty: t('models.followChat') },
    { field: 'chatModel', label: 'models.chatModel', empty: t('models.runtimeDefault') },
  ]

  if (snapshot.status === 'loading') {
    return e('section', { className: 'models-writing-routes', 'aria-label': t('models.writingRoutes') },
      e('p', { className: 'models-status', role: 'status' }, t('writing.loading')),
    )
  }
  if (snapshot.status === 'unavailable') {
    return e('section', { className: 'models-writing-routes', 'aria-label': t('models.writingRoutes') },
      e('p', { className: 'models-error', role: 'alert' }, t('writing.unavailable')),
    )
  }

  return e('section', { className: 'models-writing-routes', 'aria-label': t('models.writingRoutes') },
    e('header', { className: 'settings-block-head' },
      e('h3', { className: 'settings-block-title' }, t('models.writingRoutes')),
      e('p', { className: 'settings-block-help' }, t('models.writingRoutesHint')),
    ),
    rows.map((row) => {
      const selected = values[row.field]
      const missing = Boolean(selected && !props.catalog.some((item) => item.provider === selected.provider && item.model === selected.model))
      const options: SelectOption[] = [
        { value: EMPTY, label: row.empty },
        ...props.catalog.map((item) => ({ value: routeKey(item), label: item.label })),
      ]
      if (selected && !options.some((item) => item.value === routeKey(selected))) {
        options.push(optionFor(selected, props.catalog, row.empty))
      }
      return e('div', { key: row.field, className: 'settings-row models-writing-route' },
        e('div', { className: 'settings-row-text' },
          e('span', { className: 'settings-row-title' }, t(row.label)),
          missing ? e('small', { className: 'models-warning', role: 'status' }, t('models.missingModelHint')) : null,
        ),
        e(Select, {
          value: selected ? routeKey(selected) : EMPTY,
          options,
          disabled: !writable || saving !== null,
          'aria-label': t(row.label),
          onChange: (value) => { void update(row.field, value) },
        }),
      )
    }),
    failure ? e('p', { className: 'models-warning', role: 'alert' }, failure) : null,
  )
}
