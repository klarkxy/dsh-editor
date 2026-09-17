import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { Box, Callout, Flex, Text } from '@radix-ui/themes'
import type { SettingsScope } from '../dsh-compat.ts'
import {
  normalizeWritingEffort,
  normalizeWritingModelRoute,
  writingModelRouteValue,
  writingPreferences,
  type WritingModelRoute,
  type WritingPreferences,
} from '../writing-settings.tsx'
import { Select, type SelectOption } from './select.tsx'
import { effortDisplay, effortTriggerLabel } from './chat-model-picker.tsx'
import { STANDARD_REASONING_EFFORTS } from './settings-models-store.ts'
import { ActivityDots, ActivitySkeleton } from './ui/index.ts'
import { t, useLocale } from '../i18n/index.ts'

function effortOptions(): SelectOption[] {
  return Object.keys(STANDARD_REASONING_EFFORTS).map((id) => ({ value: id, label: effortDisplay(id) }))
}

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

/** First catalog model whose provider can actually serve requests. */
export function firstUsableCatalogModel(
  catalog: readonly CatalogModelOption[],
  usableProviders: Iterable<string>,
): CatalogModelOption | undefined {
  const usable = new Set(usableProviders)
  if (usable.size === 0) return undefined
  return catalog.find((item) => usable.has(item.provider))
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

  const save = async (field: 'completionModel' | 'rewriteModel' | 'chatModel', route: WritingModelRoute | undefined) => {
    setSaving(field)
    setFailure('')
    try {
      await props.scope.set(field, writingModelRouteValue(route))
      const committed = props.scope.getSnapshot()
      const user = committed.user && typeof committed.user === 'object' ? committed.user as Record<string, unknown> : undefined
      if (!user || !Object.prototype.hasOwnProperty.call(user, field)) throw new Error('write did not commit')
    } catch {
      setFailure(t('models.routeFailed'))
    } finally {
      setSaving(null)
    }
  }

  const updateModel = (field: 'completionModel' | 'rewriteModel' | 'chatModel', value: string) => {
    const parsed = parseRouteKey(value)
    const current = values[field]
    void save(field, parsed ? { ...parsed, reasoningEffort: current?.reasoningEffort } : undefined)
  }

  const updateEffort = (field: 'completionModel' | 'rewriteModel' | 'chatModel', value: string) => {
    const current = values[field]
    if (!current) return
    const reasoningEffort = normalizeWritingEffort(value)
    void save(field, reasoningEffort ? { ...current, reasoningEffort } : { provider: current.provider, model: current.model })
  }

  const rows: Array<{ field: 'completionModel' | 'rewriteModel' | 'chatModel'; label: 'models.completionModel' | 'models.rewriteModel' | 'models.chatModel'; empty?: string }> = [
    { field: 'chatModel', label: 'models.chatModel' },
    { field: 'completionModel', label: 'models.completionModel', empty: t('models.followChat') },
    { field: 'rewriteModel', label: 'models.rewriteModel', empty: t('models.followChat') },
  ]

  if (snapshot.status === 'loading') {
    return (
      <section className="models-writing-routes" aria-label={t('models.writingRoutes')}>
        <Box className="models-status" role="status" aria-live="polite">
          <ActivitySkeleton lines={3} />
          <span className="sr-only">
            {t('writing.loading')}
          </span>
        </Box>
      </section>
    );
  }
  if (snapshot.status === 'unavailable') {
    return (
      <section className="models-writing-routes" aria-label={t('models.writingRoutes')}>
        <Callout.Root color="red" role="alert" className="models-error">
          <Callout.Text>
            {t('writing.unavailable')}
          </Callout.Text>
        </Callout.Root>
      </section>
    );
  }

  return (
    <section className="models-writing-routes" aria-label={t('models.writingRoutes')}>
      {rows.map((row) => {
        const selected = values[row.field]
        const missing = Boolean(selected && !props.catalog.some((item) => item.provider === selected.provider && item.model === selected.model))
        const options: SelectOption[] = [
          ...(row.empty ? [{ value: EMPTY, label: row.empty }] : []),
          ...props.catalog.map((item) => ({ value: routeKey(item), label: item.label })),
        ]
        if (selected && !options.some((item) => item.value === routeKey(selected))) {
          options.push(optionFor(selected, props.catalog, row.empty ?? t(row.label)))
        }
        return (
          <Flex key={row.field} className="settings-row models-writing-route" align="center" justify="between" gap="4" minWidth="0" py="2">
            <Flex direction="column" className="settings-row-text" gap="1" minWidth="0">
              <Text size="2" weight="medium" className="settings-row-title">
                {t(row.label)}
              </Text>
              {missing ? <Text size="1" color="red" className="models-warning" role="status">
                {t('models.missingModelHint')}
              </Text> : null}
            </Flex>
            <Flex className="models-writing-route-controls" align="center" gap="2" minWidth="0">
              <Select
                value={selected ? routeKey(selected) : EMPTY}
                options={options}
                disabled={!writable || saving !== null}
                aria-label={t(row.label)}
                onChange={(value) => { void updateModel(row.field, value) }} />
              {selected ? <span className="model-effort">
                <Select
                  value={selected.reasoningEffort && effortOptions().some((item) => item.value === selected.reasoningEffort) ? selected.reasoningEffort : 'off'}
                  options={effortOptions()}
                  placeholder="none"
                  selectedLabel={effortTriggerLabel(selected.reasoningEffort ?? 'off')}
                  disabled={!writable || saving !== null}
                  aria-label={`${t(row.label)} · ${t('chat.reasoning')}`}
                  title={effortTriggerLabel(selected.reasoningEffort ?? 'off')}
                  align="end"
                  onChange={(value) => { void updateEffort(row.field, value) }} />
              </span> : null}
            </Flex>
            <span
              className="route-saving"
              role={saving === row.field ? 'status' : undefined}
              aria-hidden={saving === row.field ? undefined : 'true'}>
              {saving === row.field ? <ActivityDots /> : null}
              {saving === row.field ? <span className="sr-only">
                {t('common.saving')}
              </span> : null}
            </span>
          </Flex>
        );
      })}
      {failure ? <Callout.Root color="red" role="alert" className="models-warning">
        <Callout.Text>
          {failure}
        </Callout.Text>
      </Callout.Root> : null}
    </section>
  );
}
