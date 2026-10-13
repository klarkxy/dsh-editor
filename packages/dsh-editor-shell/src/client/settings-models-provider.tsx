/** Provider drafts and credential submission stay local to each editing card. */
import { Fragment, useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from 'react'
import { Box, Callout, Flex, Text, TextField } from '@radix-ui/themes'
import type { CredentialView, SettingsNamespaceView, SettingsPathOpView } from '../dsh-compat.ts'
import { apiKeyFailure, deriveKeyRef, layoutOf, modelDrafts, pathOps, protocolChoices, providerIdOf, refFor, routeFailure, validateModels, type ProviderRow } from './settings-models-store.ts'
import { Select } from './select.tsx'
import type { SelectOption } from '../model/select.ts'
import { ActivityDots } from './ui/index.ts'
import { Button } from '../ui/index.ts'
import type { SettingsSchemaService, ShellContext } from './shared.ts'
import { t } from '../i18n/index.ts'
import { failureMessage, modelFailureLabel, targetLabel, text } from './settings-models-copy.ts'
import type { ModelsStore as Store } from './settings-models-state.ts'
import { ModelListEditor } from './settings-models-catalog.tsx'

/* A loose draft object we hand to the editor. The store layer accepts plain
   records only, so the editor serializes its working copy through this type. */
type ProfileDraft = Record<string, unknown>

/* Read a user-section subtree as a plain draft, falling back to {} when
   missing. Deep clone is not strictly required: the editor rebuilds objects
   through `setPath` / `deletePath`, which return new objects. */
function draftAt(
  schema: SettingsSchemaService,
  namespace: SettingsNamespaceView,
  path: string[],
): ProfileDraft {
  const subtree = schema.getPath(namespace.user, path)
  if (typeof subtree !== 'object' || subtree === null || Array.isArray(subtree)) return {}
  return { ...(subtree as Record<string, unknown>) }
}

/* A single provider's editor card. Owns its own draft and key buffers so
   closing one card never discards a draft in another. */
export function ProviderEditor(props: {
  ctx: ShellContext
  store: Store
  namespace: SettingsNamespaceView
  row: ProviderRow
  hideTitle: boolean
  setup: boolean
  readOnly: boolean
  unavailable?: boolean
  onClose(changed: boolean): void
}): ReactNode {
  const { ctx, store, namespace: currentNamespace, row: currentRow, hideTitle, readOnly, onClose } = props
  const [namespace] = useState(currentNamespace)
  const [row] = useState(currentRow)
  const schema = ctx.settingsSchema
  const [draft, setDraft] = useState<ProfileDraft>(() => draftAt(schema, namespace, row.entry.settingsPath))
  const [committedOriginal, setCommittedOriginal] = useState<ProfileDraft>(() => {
    const value = schema.getPath(namespace.user, row.entry.settingsPath)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? { ...(value as Record<string, unknown>) }
      : {}
  })
  const [expectedRevision, setExpectedRevision] = useState<number>(namespace.revision)
  const revisionChanged = props.unavailable === true || currentNamespace.revision !== expectedRevision
    || currentRow.entry.settingsNs !== row.entry.settingsNs
    || JSON.stringify(currentRow.entry.settingsPath) !== JSON.stringify(row.entry.settingsPath)
  const [keyDraft, setKeyDraft] = useState('')
  const [keyState, setKeyState] = useState<CredentialView | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const latestSnapshot = store.getSnapshot()
  const sourceVerified = latestSnapshot.status === 'ready' && !latestSnapshot.refreshing && latestSnapshot.error === null

  const keyRef = useMemo(
    () => refFor(namespace, row.entry.settingsPath, providerIdOf(row.entry), schema),
    [namespace, row, schema],
  )

  useEffect(() => {
    let stale = false
    void ctx.remote.credentials.describe([keyRef]).then((response) => {
      if (stale) return
      const result = response
      if (result.ok) setKeyState(result.value[keyRef])
    })
    return () => {
      stale = true
    }
  }, [ctx, keyRef])

  const family = layoutOf(namespace.ns)
  const isPiAi = family === 'pi-ai'
  const isDeclared = row.entry.declared === true
  const protocols = useMemo(() => (isPiAi ? protocolChoices(namespace, schema) : []), [isPiAi, namespace, schema])
  const rootSchema = useMemo(() => schema.rehydrate(namespace.schema), [namespace, schema])
  const node = useMemo(
    () => schema.nodeAtPath(rootSchema, row.entry.settingsPath),
    [rootSchema, row, schema],
  )
  const fallback = useMemo(
    () => schema.getPath(namespace.value, row.entry.settingsPath),
    [namespace, row, schema],
  )
  const fallbackRecord = typeof fallback === 'object' && fallback !== null && !Array.isArray(fallback)
    ? (fallback as Record<string, unknown>)
    : undefined

  const setField = (key: string, raw: string): void => {
    const next = raw.trim().length === 0 ? undefined : raw
    setDraft((current) => (next === undefined ? schema.deletePath(current, [key]) : schema.setPath(current, [key], next)) as ProfileDraft)
  }
  const stringAt = (source: Record<string, unknown> | undefined, key: string): string | undefined => {
    if (source === undefined) return undefined
    const value = source[key]
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined
  }
  const setModels = (next: Record<string, unknown>[]): void => {
    setDraft((current) => schema.setPath(current, ['models'], next) as ProfileDraft)
  }

  const modelsValue = schema.getPath(draft, ['models'])
  const models = modelDrafts(modelsValue)
  const modelFailure = validateModels(modelsValue)
  const modelFailureText = modelFailure === undefined ? null : text().modelFailure(modelFailure.index, modelFailureLabel(modelFailure.key))
  const keyFailure = apiKeyFailure(keyDraft)
  const keyValue = keyDraft.trim()
  const isSetup = props.setup
  const showKeyFailure = keyFailure !== undefined ? keyFailure : undefined
  const keyLocked = keyState?.writable === false
  const keyPlaceholder = keyLocked
    ? text().apiKeyPlaceholderLocked
    : keyState?.configured === true
      ? text().apiKeyPlaceholderStored
      : isPiAi
        ? t('models.keyEnv')
        : text().apiKeyPlaceholder

  const setModelsRef = setModels

  const submit = async (): Promise<void> => {
    if (readOnly) return
    const currentSnapshot = store.getSnapshot()
    if (currentSnapshot.status !== 'ready' || currentSnapshot.refreshing || currentSnapshot.error !== null) return
    if (revisionChanged) { setFailure(text().conflict); return }
    if (keyFailure !== undefined) return
    if (modelFailure !== undefined) return
    if (node === undefined) return
    setBusy(true)
    setFailure(undefined)
    try {
      const next = isPiAi
        && stringAt(draft, 'apiKeyEnv') === undefined
        && stringAt(fallbackRecord, 'apiKeyEnv') === undefined
        && keyValue.length > 0
        ? (schema.setPath(draft, ['apiKeyEnv'], keyRef) as ProfileDraft)
        : draft
      if (row.entry.settingsPath.length === 0 && node !== undefined) {
        const sectionError = schema.validate(node, next)
        if (sectionError !== undefined) {
          setFailure(sectionError)
          return
        }
      }
      const materializesNativeProfile = isPiAi
        && fallback === undefined
        && committedOriginal === undefined
        && Object.keys(next).length === 0
      let ops: SettingsPathOpView[]
      if (materializesNativeProfile) {
        ops = [{ op: 'set', path: [...row.entry.settingsPath], value: {} }]
      } else {
        const previous = committedOriginal
        ops = pathOps(row.entry.settingsPath, previous, next)
      }
      if (ops.length > 0) {
        const response = await ctx.remote.settings.mutate(namespace.ns, ops, expectedRevision)
        const result = response
        if (!result.ok) {
          if (result.error?.code === 'settings-conflict') setFailure(text().conflict)
          else setFailure(failureMessage(result))
          return
        }
        store.acceptNamespaceView(result.value)
        setCommittedOriginal(typeof next === 'object' && next !== null ? { ...(next as Record<string, unknown>) } : {})
        setExpectedRevision(result.value.revision)
      }
      if (keyValue.length > 0) {
        const response = await ctx.remote.credentials.set(keyRef, keyValue)
        const result = response
        if (!result.ok) {
          setFailure(failureMessage(result))
          return
        }
      }
      setKeyDraft('')
      onClose(true)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  if (node === undefined) {
    return (
      <Box className="models-editor">
        <Text size="1" color="red" className="models-warning">
          {t('models.pathUnresolvable', { ns: namespace.ns })}
        </Text>
      </Box>
    );
  }

  return (
    <Box className="models-editor">
      {hideTitle ? null : <Flex className="models-editor-header" align="baseline" gap="2">
        <Text size="2" weight="medium" className="models-editor-title">
          {targetLabel(row)}
        </Text>
        {targetLabel(row) !== providerIdOf(row.entry)
          ? <Text size="1" color="gray" className="models-editor-route">
          {providerIdOf(row.entry)}
        </Text>
          : null}
      </Flex>}
      <Flex direction="column" gap="2" className="models-field" minWidth="0">
        <Text size="2" weight="medium" className="models-field-label">
          {text().apiKey}
        </Text>
        <TextField.Root
          type="password"
          autoComplete="off"
          className="models-input"
          value={keyDraft}
          placeholder={keyPlaceholder}
          aria-label={text().apiKey}
          aria-invalid={showKeyFailure !== undefined}
          disabled={readOnly || busy || keyLocked}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setKeyDraft(event.target.value)} />
        {showKeyFailure === undefined
          ? null
          : <Callout.Root color="red" role="alert" className="models-warning">
          <Callout.Text>
            {showKeyFailure === 'keyBlank' ? text().keyBlank : text().keyIllegal}
          </Callout.Text>
        </Callout.Root>}
      </Flex>
      <details className="models-customized">
        <summary className="models-customized-summary">
          {text().customized}
        </summary>
        <div className="models-customized-body">
          {isDeclared ? <Flex direction="column" gap="2" className="models-field" minWidth="0">
            <Text size="2" weight="medium" className="models-field-label">
              {text().displayName}
            </Text>
            <TextField.Root
              type="text"
              className="models-input"
              value={stringAt(draft, 'displayName') ?? ''}
              placeholder={stringAt(fallbackRecord, 'displayName') ?? providerIdOf(row.entry)}
              aria-label={text().displayName}
              disabled={readOnly || busy}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setField('displayName', event.target.value)} />
          </Flex> : null}
          <Flex direction="column" gap="2" className="models-field" minWidth="0">
            <Text size="2" weight="medium" className="models-field-label">
              {text().baseUrl}
            </Text>
            <TextField.Root
              type="text"
              className="models-input"
              value={stringAt(draft, 'baseURL') ?? ''}
              placeholder={family === 'deepseek' ? text().baseUrlDeepseekPlaceholder : text().baseUrlPlaceholder}
              aria-label={text().baseUrl}
              disabled={readOnly || busy}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setField('baseURL', event.target.value)} />
          </Flex>
          {isPiAi && isDeclared ? <Flex direction="column" gap="2" className="models-field" minWidth="0">
            <Text size="2" weight="medium" className="models-field-label">
              {text().protocol}
            </Text>
            <Select
              value={stringAt(draft, 'api') ?? ''}
              options={[
                { value: '', label: text().protocolUnset },
                ...protocols.map<SelectOption>((value) => ({ value, label: value })),
              ]}
              onChange={(value) => setField('api', value)}
              disabled={readOnly || busy}
              aria-label={text().protocol}
              placeholder={text().protocolUnset} />
          </Flex> : null}
          <ModelListEditor
            ctx={ctx}
            models={models}
            settingsNs={namespace.ns}
            provider={providerIdOf(row.entry)}
            baseURL={stringAt(draft, 'baseURL') ?? stringAt(fallbackRecord, 'baseURL')}
            api={isPiAi ? stringAt(draft, 'api') ?? stringAt(fallbackRecord, 'api') : undefined}
            apiKey={keyValue.length > 0 ? keyValue : undefined}
            disabled={readOnly || busy}
            onChange={setModelsRef}
            t={text()} />
        </div>
      </details>
      {failure !== undefined || revisionChanged ? <Callout.Root color="red" role="alert" className="models-warning">
        <Callout.Text>
          {failure ?? text().conflict}
        </Callout.Text>
      </Callout.Root> : null}
      {isSetup || keyFailure === undefined && modelFailure === undefined
        ? <Flex className="models-editor-actions" gap="2" justify="end">
        <Button
          variant="secondary"
          className="models-button"
          disabled={busy}
          onClick={() => onClose(false)}>
          {text().cancel}
        </Button>
        <Button
          variant="primary"
          className="models-button models-button-primary"
          disabled={readOnly || busy || !sourceVerified || keyFailure !== undefined || modelFailure !== undefined}
          onClick={() => void submit()}>
          {busy ? <Fragment>
            <ActivityDots />
            {text().saving}
          </Fragment> : t('common.save')}
        </Button>
      </Flex>
        : null}
      {modelFailureText !== null ? <Callout.Root color="red" role="alert" className="models-warning">
        <Callout.Text>
          {modelFailureText}
        </Callout.Text>
      </Callout.Root> : null}
    </Box>
  );
}

/* The custom-provider creation card. A separate component so the create
   card and the edit card never share state; each owns one keyDraft and
   one model list, both gone the moment either card closes. */
export function CustomProviderCard(props: {
  ctx: ShellContext
  store: Store
  protocols: string[]
  taken: string[]
  readOnly: boolean
  onClose(changed: boolean): void
}): ReactNode {
  const { ctx, store, protocols, taken, readOnly, onClose } = props
  const piAiNamespace = ctx.configForms.describe().getSnapshot().view?.namespaces.find((view) => view.ns === 'llm-pi-ai')
  const revision = piAiNamespace?.revision ?? 0
  const [route, setRoute] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [baseURL, setBaseURL] = useState('')
  const [protocol, setProtocol] = useState<string>(protocols[0] ?? '')
  const [keyDraft, setKeyDraft] = useState('')
  const [models, setModels] = useState<Record<string, unknown>[]>([])
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [committed, setCommitted] = useState(false)

  const routeInvalid = routeFailure(route, taken)
  const modelFailure = validateModels(models)
  const keyFailure = apiKeyFailure(keyDraft)
  const keyValue = keyDraft.trim()
  const ready =
    route.length > 0 &&
    routeInvalid === undefined &&
    baseURL.trim().length > 0 &&
    models.length > 0 &&
    modelFailure === undefined &&
    keyFailure === undefined

  const submit = async (): Promise<void> => {
    if (readOnly || !ready) return
    setBusy(true)
    setFailure(undefined)
    try {
      const keyRef = deriveKeyRef(route)
      const storesKey = keyValue.length > 0
      if (!committed) {
        const profile: Record<string, unknown> = {
          api: protocol,
          baseURL,
          models: models.map((model) => ({ ...model })),
        }
        if (displayName.trim().length > 0) profile['displayName'] = displayName.trim()
        if (storesKey) profile['apiKeyEnv'] = keyRef
        const response = await ctx.remote.settings.mutate(
          'llm-pi-ai',
          [{ op: 'set', path: ['providers', route], value: profile }],
          revision,
        )
        const result = response
        if (!result.ok) {
          if (result.error?.code === 'settings-conflict') setFailure(text().conflict)
          else setFailure(failureMessage(result))
          return
        }
        store.acceptNamespaceView(result.value)
        setCommitted(true)
      }
      if (storesKey) {
        const response = await ctx.remote.credentials.set(deriveKeyRef(route), keyValue)
        const result = response
        if (!result.ok) {
          setFailure(failureMessage(result))
          return
        }
      }
      onClose(true)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box className="models-editor">
      <Flex className="models-editor-header" align="baseline" gap="2">
        <Text size="2" weight="medium" className="models-editor-title">
          {t('models.customProvider')}
        </Text>
      </Flex>
      <Flex direction="column" gap="2" className="models-field" minWidth="0">
        <Text size="2" weight="medium" className="models-field-label">
          {text().customRoute}
        </Text>
        <TextField.Root
          type="text"
          className="models-input"
          value={route}
          placeholder="acme-gateway"
          aria-label={text().customRoute}
          aria-invalid={routeInvalid !== undefined}
          disabled={readOnly || busy || committed}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setRoute(event.target.value)} />
      </Flex>
      {routeInvalid !== undefined
        ? <Callout.Root color="red" role="alert" className="models-warning">
        <Callout.Text>
          {routeInvalid === 'routeInvalid' ? text().customRouteInvalid : text().customRouteTaken}
        </Callout.Text>
      </Callout.Root>
        : <Text size="1" color="gray" className="models-hint">
        {text().customRouteHint}
      </Text>}
      <Flex direction="column" gap="2" className="models-field" minWidth="0">
        <Text size="2" weight="medium" className="models-field-label">
          {text().displayName}
        </Text>
        <TextField.Root
          type="text"
          className="models-input"
          value={displayName}
          placeholder={route.length > 0 ? route : text().displayName}
          aria-label={text().displayName}
          disabled={readOnly || busy || committed}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setDisplayName(event.target.value)} />
      </Flex>
      <Flex direction="column" gap="2" className="models-field" minWidth="0">
        <Text size="2" weight="medium" className="models-field-label">
          {text().baseUrl}
        </Text>
        <TextField.Root
          type="text"
          className="models-input"
          value={baseURL}
          placeholder="https://gateway.example/v1"
          aria-label={text().baseUrl}
          disabled={readOnly || busy || committed}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setBaseURL(event.target.value)} />
      </Flex>
      <Flex direction="column" gap="2" className="models-field" minWidth="0">
        <Text size="2" weight="medium" className="models-field-label">
          {text().protocol}
        </Text>
        <Select
          value={protocol}
          options={protocols.map<SelectOption>((value) => ({ value, label: value }))}
          onChange={setProtocol}
          disabled={readOnly || busy || committed}
          aria-label={text().protocol} />
      </Flex>
      <Flex direction="column" gap="2" className="models-field" minWidth="0">
        <Text size="2" weight="medium" className="models-field-label">
          {text().apiKey}
        </Text>
        <TextField.Root
          type="password"
          autoComplete="off"
          className="models-input"
          value={keyDraft}
          placeholder={text().apiKeyPlaceholder}
          aria-label={text().apiKey}
          aria-invalid={keyFailure !== undefined}
          disabled={readOnly || busy}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setKeyDraft(event.target.value)} />
        {keyFailure === undefined
          ? null
          : <Callout.Root color="red" role="alert" className="models-warning">
          <Callout.Text>
            {keyFailure === 'keyBlank' ? text().keyBlank : text().keyIllegal}
          </Callout.Text>
        </Callout.Root>}
      </Flex>
      <ModelListEditor
        ctx={ctx}
        models={models}
        settingsNs="llm-pi-ai"
        provider={route}
        baseURL={baseURL}
        api={protocol}
        apiKey={keyValue.length > 0 ? keyValue : undefined}
        disabled={readOnly || busy || committed}
        onChange={setModels}
        t={text()} />
      <Text size="1" color="gray" className="models-hint">
        {baseURL.trim().length === 0 ? text().customNeedsBaseUrl
          : models.length === 0 ? text().customNeedsModels
            : null}
      </Text>
      {modelFailure !== undefined
        ? <Callout.Root color="red" role="alert" className="models-warning">
        <Callout.Text>
          {text().modelFailure(modelFailure.index, modelFailureLabel(modelFailure.key))}
        </Callout.Text>
      </Callout.Root>
        : null}
      {failure !== undefined ? <Callout.Root color="red" role="alert" className="models-warning">
        <Callout.Text>
          {failure}
        </Callout.Text>
      </Callout.Root> : null}
      <Flex className="models-editor-actions" gap="2" justify="end">
        <Button
          variant="secondary"
          className="models-button"
          disabled={busy}
          onClick={() => onClose(false)}>
          {text().cancel}
        </Button>
        <Button
          variant="primary"
          className="models-button models-button-primary"
          disabled={readOnly || busy || !ready}
          onClick={() => void submit()}>
          {busy ? <Fragment>
            <ActivityDots />
            {text().creating}
          </Fragment> : text().createCustom}
        </Button>
      </Flex>
    </Box>
  );
}
