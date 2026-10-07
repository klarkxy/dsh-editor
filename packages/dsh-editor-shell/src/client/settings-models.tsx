/** Models settings entry points and provider page orchestration. */
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { SettingsNamespaceView, SettingsScope } from '../dsh-compat.ts'
import { addableRows, credentialDot, modelDrafts, protocolChoices, providerIdOf, providerUsable, type ProviderRow } from './settings-models-store.ts'
import { Badge, Box, Callout, Card, Flex, Heading, Text } from '@radix-ui/themes'
import { Select, type SelectOption } from './select.tsx'
import { ConfirmDialog } from './dialogs.tsx'
import { ActivitySkeleton, ActivityText, Button } from './ui/index.ts'
import { isSuccessWorkbenchNote, TRANSIENT_STATUS_NOTE_MS, type SettingsSchemaService, type ShellContext } from './shared.ts'
import { t, useLocale } from '../i18n/index.ts'
import type { RpcResult } from '../dsh-compat.ts'
import type { WritingPreferences } from '../writing-settings.tsx'
import { catalogFromSessionGroups, mergeCatalogOptions, WritingModelRoutes, EditorModelSettings, type CatalogModelOption } from './writing-model-routes.tsx'
import { failureMessage, formatTemplate, targetLabel, text } from './settings-models-copy.ts'
import { managedCredentialRef, ModelsStore, removeProviderProfile, type ModelsSnapshot as Snapshot } from './settings-models-state.ts'
import { ProviderEditor, CustomProviderCard } from './settings-models-provider.tsx'

type Store = ModelsStore

/* Whether a row is the first-run setup posture: the only existing row whose
   empty settingsPath is the whole section, and only while no other row can
   already serve requests. */
function needsSetup(row: ProviderRow, anyUsable: boolean): boolean {
  if (anyUsable) return false
  if (row.entry.settingsPath.length > 0) return false
  return row.credential?.configured !== true
}

/* Top-level page state the section owns. The three card kinds each track
   their own draft; this object only records which card (if any) is open. */
type SectionState = {
  editing: ProviderRow | undefined
  editingNamespace?: SettingsNamespaceView
  setups: Map<string, { row: ProviderRow; namespace: SettingsNamespaceView }>
  adding: boolean
  declaring: boolean
  deleteTarget: ProviderRow | undefined
  dismissing: Set<string>
  savedNote: string | null
  deleteError: string | null
}

function emptySectionState(): SectionState {
  return { editing: undefined, setups: new Map(), adding: false, declaring: false, deleteTarget: undefined, dismissing: new Set(), savedNote: null, deleteError: null }
}

/* The exported entry point. Builds the store once, subscribes to the
   store, and registers the host's invalidation listeners. The component
   delegates all rendering to `Loaded` once the store is ready. */
export function SettingsModelsSection(props: {
  ctx: ShellContext
  writingScope: SettingsScope<WritingPreferences>
  showWritingRoutes?: boolean
}): ReactNode {
  useLocale()
  const store = useMemo(
    () => new ModelsStore(props.ctx.remote, props.ctx.configForms.describe(), props.ctx.settingsSchema),
    [props.ctx],
  )

  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)

  useEffect(() => {
    const refresh = () => store.refreshIfLoaded()
    // The remote bridge and the cordis context both expose `$on` / `on`
    // with the same `() => disposer` contract. Subscribe to all four
    // events, then return a single cleanup that disposes every handle.
    const disposers: Array<unknown> = []
    try {
      disposers.push(props.ctx.remote.$on('settings/document-updated', refresh))
    } catch { /* host may not forward this event in every mode */ }
    try {
      disposers.push(props.ctx.remote.$on('credentials/reference-updated', refresh))
    } catch { /* ignore */ }
    try {
      disposers.push(props.ctx.remote.$on('llm/adapters-updated', refresh))
    } catch { /* ignore */ }
    const ctxAny = props.ctx as unknown as { on?: (event: string, listener: () => void) => unknown }
    if (typeof ctxAny.on === 'function') {
      try { disposers.push(ctxAny.on('connection/reset', refresh)) } catch { /* ignore */ }
    }
    return () => {
      for (const handle of disposers) {
        if (typeof handle === 'function') {
          try { (handle as () => void)() } catch { /* ignore */ }
        }
      }
    }
  }, [props.ctx, store])

  useEffect(() => {
    void store.load()
  }, [store])

  return (
    <Loaded
      ctx={props.ctx}
      store={store}
      state={state}
      writingScope={props.writingScope}
      showWritingRoutes={props.showWritingRoutes !== false} />
  );
}

/** Runtime-owned model catalogue; a newer refresh or connection supersedes older responses. */
function useModelCatalog(ctx: ShellContext): CatalogModelOption[] {
  const [catalog, setCatalog] = useState<CatalogModelOption[]>([])
  useEffect(() => {
    let live = true
    let generation = 0
    const load = async () => {
      const ticket = ++generation
      try {
        const result = await ctx.remote.session.modelCatalog()
        if (live && ticket === generation && result.ok) setCatalog(catalogFromSessionGroups(result.value.groups))
      } catch { /* Stored selections remain visible while the catalogue is unavailable. */ }
    }
    void load()
    const refresh = () => { void load() }
    window.addEventListener('focus', refresh)
    const disposers: unknown[] = []
    for (const event of ['settings/document-updated', 'llm/adapters-updated']) {
      try { disposers.push(ctx.remote.$on(event as 'settings/document-updated', refresh)) } catch { /* Host may not forward the event. */ }
    }
    return () => {
      live = false
      generation++
      window.removeEventListener('focus', refresh)
      for (const dispose of disposers) if (typeof dispose === 'function') dispose()
    }
  }, [ctx])
  return catalog
}

export function SettingsEditorModelsSection(props: { ctx: ShellContext; writingScope: SettingsScope<WritingPreferences> }): ReactNode {
  const catalog = useModelCatalog(props.ctx)
  const locale = useLocale()
  const [migrationFailure, setMigrationFailure] = useState('')
  const [migrationBusy, setMigrationBusy] = useState(true)
  useEffect(() => {
    let live = true
    setMigrationBusy(true)
    void props.ctx.connection.rpc.call('/dsh-editor-shell', 'models.migration.status', {}).then(raw => {
      const result = raw as RpcResult<{ error?: string }>
      if (live) setMigrationFailure(result.ok ? result.value.error ?? '' : failureMessage(result))
    }).catch(error => { if (live) setMigrationFailure(error instanceof Error ? error.message : String(error)) })
      .finally(() => { if (live) setMigrationBusy(false) })
    return () => { live = false }
  }, [props.ctx])
  const retryMigration = async () => {
    setMigrationBusy(true)
    try {
      const result = await props.ctx.connection.rpc.call('/dsh-editor-shell', 'models.migrate', {}) as RpcResult<{ error?: string }>
      setMigrationFailure(result.ok ? result.value.error ?? '' : failureMessage(result))
    } catch (error) { setMigrationFailure(error instanceof Error ? error.message : String(error)) }
    finally { setMigrationBusy(false) }
  }
  return <>
    {migrationBusy ? <ActivityText>{t('common.loading')}</ActivityText> : null}
    {migrationFailure ? <Callout.Root color="red" role="alert"><Callout.Text>{migrationFailure}</Callout.Text>
      <Button disabled={migrationBusy} onClick={() => { void retryMigration() }}>{t('common.retry')}</Button>
    </Callout.Root> : null}
    <EditorModelSettings scope={props.writingScope} catalog={catalog} writable={!migrationBusy} />
    <Heading as="h3" size="3" mt="4" mb="3">{locale === 'en' ? 'Providers' : '供应商'}</Heading>
    <SettingsModelsSection {...props} showWritingRoutes={false} />
  </>
}

export function SettingsChatModelRoute(props: {
  ctx: ShellContext
  writingScope: SettingsScope<WritingPreferences>
}): ReactNode {
  const [catalog, setCatalog] = useState<CatalogModelOption[]>([])
  useEffect(() => {
    let live = true
    void props.ctx.remote.session.modelCatalog().then((result) => {
      if (!live || !result.ok) return
      setCatalog(catalogFromSessionGroups(result.value.groups))
    }).catch(() => { /* selected route remains visible as missing */ })
    return () => { live = false }
  }, [props.ctx])
  return <WritingModelRoutes
    connection={props.ctx.connection}
    scope={props.writingScope}
    catalog={catalog}
    writable={true}
    showSharedPurposes={false} />
}

function catalogOptions(rows: ProviderRow[], namespaces: Map<string, SettingsNamespaceView>, schema: SettingsSchemaService): CatalogModelOption[] {
  const options: CatalogModelOption[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (!row.configured) continue
    const namespace = namespaces.get(row.entry.settingsNs)
    if (namespace === undefined) continue
    const profile = schema.getPath(namespace.value, row.entry.settingsPath)
    const models = modelDrafts(typeof profile === 'object' && profile !== null ? (profile as Record<string, unknown>)['models'] : undefined)
    const provider = providerIdOf(row.entry)
    const providerLabel = targetLabel(row)
    for (const model of models) {
      const id = typeof model['id'] === 'string' ? model['id'].trim() : ''
      if (!id) continue
      const key = `${provider}\0${id}`
      if (seen.has(key)) continue
      seen.add(key)
      const name = typeof model['name'] === 'string' && model['name'].trim() ? model['name'].trim() : id
      options.push({ provider, model: id, label: `${providerLabel} · ${name}` })
    }
  }
  return options
}

/* Inner component: renders the page after the store is wired up. Owns the
   open-card bookkeeping and the delete confirmation target. */
function Loaded(props: {
  ctx: ShellContext
  store: Store
  state: Snapshot
  writingScope: SettingsScope<WritingPreferences>
  showWritingRoutes: boolean
}): ReactNode {
  const { ctx, store, state } = props
  const [section, setSection] = useState<SectionState>(emptySectionState)
  useEffect(() => {
    if (state.status !== 'ready' || state.refreshing) return
    const anyUsable = state.rows.some(providerUsable)
    setSection((current) => {
      const setups = new Map(current.setups)
      for (const row of state.rows) {
        const id = providerIdOf(row.entry)
        const namespace = state.namespaces.get(row.entry.settingsNs)
        if (namespace && needsSetup(row, anyUsable) && !current.dismissing.has(id) && !setups.has(id)) setups.set(id, { row, namespace })
      }
      return setups.size === current.setups.size ? current : { ...current, setups }
    })
  }, [state.rows, state.namespaces, state.status, state.refreshing])
  useEffect(() => {
    const saved = section.savedNote
    if (!saved || !isSuccessWorkbenchNote(saved)) return
    const timer = globalThis.setTimeout(() => {
      setSection((current) => current.savedNote === saved ? { ...current, savedNote: null } : current)
    }, TRANSIENT_STATUS_NOTE_MS)
    return () => globalThis.clearTimeout(timer)
  }, [section.savedNote])
  const [runtimeCatalog, setRuntimeCatalog] = useState<CatalogModelOption[]>([])
  useEffect(() => {
    if (!props.showWritingRoutes) return
    let live = true
    void ctx.remote.session.modelCatalog().then((result) => {
      if (!live || !result.ok) return
      setRuntimeCatalog(catalogFromSessionGroups(result.value.groups))
    }).catch(() => { /* keep profile catalog */ })
    return () => { live = false }
  }, [ctx, state.rows, props.showWritingRoutes])


  if (state.status === 'idle' || state.status === 'loading') {
    return (
      <section className="models-page" aria-label={t('settings.models')}>
        <Header />
        <Box className="models-status" role="status" aria-live="polite">
          <ActivitySkeleton lines={4} className="models-loading" />
          <span className="sr-only">
            {text().loading}
          </span>
        </Box>
      </section>
    );
  }

  if (state.status === 'error') {
    const message = state.error ?? text().loadFailed
    return (
      <section className="models-page" aria-label={t('settings.models')}>
        <Header />
        <Callout.Root color="red" role="alert" className="models-error">
          <Callout.Text>
            {`${text().loadFailed}：${message}`}
          </Callout.Text>
          <Button className="models-button" onClick={() => void store.load()}>
            {text().retry}
          </Button>
        </Callout.Root>
      </section>
    );
  }

  const writable = state.writable
  const anyUsable = state.rows.some(providerUsable)
  const configured = state.rows.filter((row) => row.configured)
  if (!section.adding && section.editing && !configured.some((row) => providerIdOf(row.entry) === providerIdOf(section.editing!.entry))) {
    configured.push(section.editing)
  }
  for (const { row } of section.setups.values()) {
    if (!configured.some((entry) => providerIdOf(entry.entry) === providerIdOf(row.entry))) configured.push(row)
  }
  const addable = addableRows(state.rows)
  const piAiNamespace = state.namespaces.get('llm-pi-ai')
  const protocols = protocolChoices(piAiNamespace, ctx.settingsSchema)
  const addTarget = section.adding ? section.editing : undefined
  const addNamespace = addTarget === undefined ? undefined : state.namespaces.get(addTarget.entry.settingsNs) ?? section.editingNamespace

  return (
    <section className="models-page" aria-label={t('settings.models')}>
      <Header note={section.savedNote} />
      {state.refreshing ? <ActivityText>{text().loading}</ActivityText> : null}
      {state.error ? <Callout.Root color="red" className="models-error" role="alert">
        <Callout.Text>{`${text().loadFailed}：${state.error}`}</Callout.Text>
        <Button onClick={() => void store.load()}>{text().retry}</Button>
      </Callout.Root> : null}
      {section.deleteError ? <Callout.Root color="red" className="models-error" role="alert">
        <Callout.Text>
          {section.deleteError}
        </Callout.Text>
      </Callout.Root> : null}
      {props.showWritingRoutes ? <WritingModelRoutes
        connection={ctx.connection}
        scope={props.writingScope}
        catalog={mergeCatalogOptions(runtimeCatalog, catalogOptions(state.rows, state.namespaces, ctx.settingsSchema))}
        writable={writable} /> : null}
      {!writable ? <Text size="1" color="gray" className="models-notice" role="status">
        {text().readOnly}
      </Text> : null}
      {state.credentialError !== null
        ? <Callout.Root color="red" className="models-warning" role="status">
        <Callout.Text>
          {`${text().credentialErrorPrefix}${state.credentialError}`}
        </Callout.Text>
      </Callout.Root>
        : null}
      <Flex asChild direction="column" gap="3" m="0" p="0">
        <ul className="models-rows">
        {configured.map((row) => {
          const target = row
          const namespace = state.namespaces.get(target.entry.settingsNs) ?? section.setups.get(providerIdOf(target.entry))?.namespace ?? section.editingNamespace
          if (namespace === undefined) return null
          const editing = !section.adding && section.editing !== undefined && providerIdOf(section.editing.entry) === providerIdOf(target.entry)
          const wantsSetup = (section.setups.has(providerIdOf(target.entry)) || needsSetup(target, anyUsable)) && !section.dismissing.has(providerIdOf(target.entry))
          if (wantsSetup) {
            return (
              <Card asChild key={providerIdOf(target.entry)}>
                <li className="models-row-card">
                <ProviderEditor
                  ctx={ctx}
                  store={store}
                  namespace={namespace}
                  row={target}
                  hideTitle={false}
                  setup={true}
                  readOnly={!writable}
                  unavailable={!state.rows.some((row) => row.configured && providerIdOf(row.entry) === providerIdOf(target.entry))}
                  onClose={(changed) => {
                    setSection((current) => {
                      const dismissing = new Set(current.dismissing)
                      dismissing.add(providerIdOf(target.entry))
                      const setups = new Map(current.setups)
                      setups.delete(providerIdOf(target.entry))
                      return {
                        ...current,
                        dismissing,
                        setups,
                        savedNote: changed ? text().saved : current.savedNote,
                      }
                    })
                  }} />
                </li>
              </Card>
            );
          }
          return (
            <Card asChild key={providerIdOf(target.entry)}>
              <li className="models-row-card">
              <RowHead
                row={target}
                writable={writable}
                open={editing}
                onEdit={() => {
                  setSection((current) => ({
                    ...current,
                    editing: editing ? undefined : target,
                    editingNamespace: editing ? undefined : namespace,
                    adding: false,
                    declaring: false,
                    savedNote: null,
                  }))
                }}
                onDelete={() => {
                  setSection((current) => ({ ...current, deleteTarget: target, savedNote: null, deleteError: null }))
                }} />
              {editing ? <ProviderEditor
                ctx={ctx}
                store={store}
                namespace={namespace}
                row={target}
                hideTitle={false}
                setup={false}
                readOnly={!writable}
                unavailable={!state.rows.some((row) => row.configured && providerIdOf(row.entry) === providerIdOf(target.entry))}
                onClose={(changed) => {
                  setSection((current) => ({
                    ...current,
                    editing: undefined,
                    adding: false,
                    declaring: false,
                    savedNote: changed ? text().saved : current.savedNote,
                  }))
                }} /> : null}
              </li>
            </Card>
          );
        })}
        </ul>
      </Flex>
      {addTarget !== undefined && addNamespace !== undefined
        ? <Card className="models-add-card">
        <Box className="models-add-picker">
          <Flex direction="column" gap="2" className="models-field">
            <Text size="2" weight="medium" className="models-field-label">
              {t('models.provider')}
            </Text>
            <Select
              value={providerIdOf(addTarget.entry)}
              options={addable.map<SelectOption>((row) => ({ value: providerIdOf(row.entry), label: targetLabel(row) }))}
              onChange={(provider) => {
                const next = addable.find((row) => providerIdOf(row.entry) === provider)
                if (next === undefined) return
                setSection((current) => ({ ...current, editing: next, editingNamespace: state.namespaces.get(next.entry.settingsNs), adding: true }))
              }}
              disabled={!writable}
              aria-label={t('models.provider')} />
          </Flex>
        </Box>
        <ProviderEditor
          key={providerIdOf(addTarget.entry)}
          ctx={ctx}
          store={store}
          namespace={addNamespace}
          row={addTarget}
          hideTitle={true}
          setup={false}
          readOnly={!writable}
          onClose={(changed) => {
            setSection((current) => ({
              ...current,
              editing: undefined,
              adding: false,
              declaring: false,
              savedNote: changed ? text().saved : current.savedNote,
            }))
          }} />
      </Card>
        : section.declaring
          ? <Card className="models-add-card">
        <CustomProviderCard
          ctx={ctx}
          store={store}
          protocols={protocols}
          taken={state.rows.map((row) => providerIdOf(row.entry))}
          readOnly={!writable}
          onClose={(changed) => {
            setSection((current) => ({
              ...current,
              declaring: false,
              savedNote: changed ? text().saved : current.savedNote,
            }))
          }} />
      </Card>
          : <Flex className="models-add-actions" gap="2">
        <Button
          className="models-button"
          disabled={!writable || addable.length === 0}
          onClick={() => {
            const first = addable[0]
            if (first === undefined) return
            setSection({ ...emptySectionState(), editing: first, editingNamespace: state.namespaces.get(first.entry.settingsNs), adding: true })
          }}>
          {text().add}
        </Button>
        <Button
          className="models-button"
          disabled={!writable || protocols.length === 0}
          onClick={() => setSection({ ...emptySectionState(), declaring: true })}>
          {text().addCustom}
        </Button>
      </Flex>}
      <DeleteDialog
        open={section.deleteTarget !== undefined}
        row={section.deleteTarget}
        onCancel={() => setSection((current) => ({ ...current, deleteTarget: undefined }))}
        onConfirm={() => {
          const target = section.deleteTarget
          if (target === undefined) return
          void removeProviderProfile(ctx.remote, store, target)
            .then(() => setSection((current) => ({ ...current, deleteTarget: undefined, savedNote: text().saved, deleteError: null })))
            .catch((error: unknown) => {
              const message = error instanceof Error ? error.message : String(error)
              setSection((current) => ({ ...current, deleteTarget: undefined, deleteError: message }))
            })
        }} />
    </section>
  );
}

function Header(props: { note?: string | null }): ReactNode {
  if (!props.note) return null
  return (
    <header className="models-header settings-block-head">
      <Callout.Root color="green" className="models-saved" role="status">
        <Callout.Text>
          {props.note}
        </Callout.Text>
      </Callout.Root>
    </header>
  );
}

function RowHead(props: {
  row: ProviderRow
  writable: boolean
  open: boolean
  onEdit(): void
  onDelete(): void
}): ReactNode {
  const { row, writable, open, onEdit, onDelete } = props
  const dot = credentialDot(row)
  const label = targetLabel(row)
  return (
    <Flex className="models-row-head" align="center" justify="between" gap="3">
      <Flex className="models-row-identity" align="center" gap="2" minWidth="0">
        <Text size="2" weight="medium" className="models-row-name">
          {label}
        </Text>
        {row.entry.declared === true ? <Badge size="1" className="models-row-tag">
          {text().custom}
        </Badge> : null}
        {dot === 'configured'
          ? <span
          className="models-credential-dot models-credential-dot-configured"
          role="img"
          aria-label={t('models.keyConfigured')}
          title={t('models.keyConfigured')} />
          : dot === 'missing'
            ? <span
          className="models-credential-dot models-credential-dot-missing"
          role="img"
          aria-label={t('models.keyMissing')}
          title={t('models.keyMissing')} />
            : null}
      </Flex>
      <Flex className="models-row-actions" align="center" gap="2">
        <Button
          className="models-button"
          aria-label={formatTemplate(text().editProviderAria, label)}
          onClick={onEdit}>
          {text().edit}
        </Button>
        {row.removable
          ? <Button
          variant="danger"
          className="models-button models-button-danger"
          aria-label={formatTemplate(text().deleteProviderAria, label)}
          disabled={!writable}
          onClick={onDelete}>
          {text().delete}
        </Button>
          : null}
        {open ? null : <span className="models-row-state" aria-hidden={open ? 'true' : 'false'} />}
      </Flex>
    </Flex>
  );
}

/* The delete-confirmation dialog. The message changes depending on whether
   this page also owns the stored credential or only the configuration. */
function DeleteDialog(props: { open: boolean; row?: ProviderRow; onCancel(): void; onConfirm(): void }): ReactNode {
  const row = props.row
  const managed = row !== undefined && managedCredentialRef(row) !== undefined
  const message = managed ? text().confirmDeleteManage : text().confirmDeleteKeep
  return (
    <ConfirmDialog
      open={props.open}
      id="models-delete"
      title={row ? formatTemplate(text().deleteTitle, targetLabel(row)) : text().delete}
      message={message}
      confirmLabel={text().delete}
      onCancel={props.onCancel}
      onConfirm={props.onConfirm} />
  );
}
