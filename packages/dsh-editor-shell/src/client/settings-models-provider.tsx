/** Provider drafts and credential submission stay local to each editing card. */
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Badge, Box, Button, Checkbox, Flex, Input, Notice, Text } from '../ui/index.ts'
import type { CredentialView, DiscoveredModelView, SettingsNamespaceView, SettingsPathOpView } from '../dsh-compat.ts'
import { apiKeyFailure, catalogFill, deriveDisplayName, deriveKeyRef, deriveRoute, discoveryFailureKind, layoutOf, modelDrafts, NO_KEY_PLACEHOLDER, normalizeBaseURL, parseModelIds, pathOps, protocolChoices, protocolOrder, providerIdOf, refFor, validateModels, type ProviderRow } from './settings-models-store.ts'
import { Select } from './select.tsx'
import type { SelectOption } from '../model/select.ts'
import { ActivityDots } from './ui/index.ts'

import type { SettingsSchemaService, ShellContext } from './shared.ts'
import { t } from '../i18n/index.ts'
import { failureMessage, modelFailureLabel, protocolLabel, targetLabel, text } from './settings-models-copy.ts'
import type { ModelsStore as Store } from './settings-models-state.ts'
import { ModelListEditor, lookupCatalogFacts } from './settings-models-catalog.tsx'

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
  /* models.dev 补全还在进行时禁掉保存:点快了会漏掉查询结果。 */
  const [catalogBusy, setCatalogBusy] = useState(false)
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
      : text().apiKeyPlaceholder

  const setModelsRef = setModels

  const submit = async (): Promise<void> => {
    if (readOnly || catalogBusy) return
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
      </Flex>}
      <Flex direction="column" gap="2" className="models-field" minWidth="0">
        <Text size="2" weight="medium" className="models-field-label">
          {text().apiKey}
        </Text>
        <Input
          type="password"
          autoComplete="off"
          className="models-input"
          value={keyDraft}
          placeholder={keyPlaceholder}
          aria-label={text().apiKey}
          aria-invalid={showKeyFailure !== undefined}
          disabled={readOnly || busy || keyLocked}
          onChange={setKeyDraft} />
        {showKeyFailure === undefined
          ? null
          : <Notice tone="danger" className="models-warning">
          <>
            {showKeyFailure === 'keyBlank' ? text().keyBlank : text().keyIllegal}
          </>
        </Notice>}
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
            <Input
              type="text"
              className="models-input"
              value={stringAt(draft, 'displayName') ?? ''}
              placeholder={stringAt(fallbackRecord, 'displayName') ?? providerIdOf(row.entry)}
              aria-label={text().displayName}
              disabled={readOnly || busy}
              onChange={(value) => setField('displayName', value)} />
          </Flex> : null}
          <Flex direction="column" gap="2" className="models-field" minWidth="0">
            <Text size="2" weight="medium" className="models-field-label">
              {text().baseUrl}
            </Text>
            <Input
              type="text"
              className="models-input"
              value={stringAt(draft, 'baseURL') ?? ''}
              placeholder={family === 'deepseek' ? text().baseUrlDeepseekPlaceholder : text().baseUrlPlaceholder}
              aria-label={text().baseUrl}
              disabled={readOnly || busy}
              onChange={(value) => setField('baseURL', value)} />
          </Flex>
          {isPiAi && isDeclared ? <Flex direction="column" gap="2" className="models-field" minWidth="0">
            <Text size="2" weight="medium" className="models-field-label">
              {text().protocol}
            </Text>
            <Select
              value={stringAt(draft, 'api') ?? ''}
              options={[
                { value: '', label: text().protocolUnset },
                ...protocolOrder(protocols).map<SelectOption>((value) => ({ value, label: protocolLabel(value) })),
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
            family={family === 'unknown' ? 'other' : family}
            catalogBacked={isPiAi && !isDeclared}
            disabled={readOnly || busy}
            onBusyChange={setCatalogBusy}
            onChange={setModelsRef}
            t={text()} />
        </div>
      </details>
      {failure !== undefined || revisionChanged ? <Notice tone="danger" className="models-warning">
        <>
          {failure ?? text().conflict}
        </>
      </Notice> : null}
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
          disabled={readOnly || busy || catalogBusy || !sourceVerified || keyFailure !== undefined || modelFailure !== undefined}
          onClick={() => void submit()}>
          {busy ? <Fragment>
            <ActivityDots />
            {text().saving}
          </Fragment> : t('common.save')}
        </Button>
      </Flex>
        : null}
      {modelFailureText !== null ? <Notice tone="danger" className="models-warning">
        <>
          {modelFailureText}
        </>
      </Notice> : null}
    </Box>
  );
}

/* 添加接口卡。面向不懂配置的作者:只问 API 地址、密钥、协议,连接后由
   端点与 models.dev 给出模型及参数,不需要手填模型 id 或容量。连接失败
   或端点不返回列表时提供手填模型名称的兜底。 */
export function CustomProviderCard(props: {
  ctx: ShellContext
  store: Store
  protocols: string[]
  taken: string[]
  readOnly: boolean
  onClose(changed: boolean, note?: string): void
}): ReactNode {
  const { ctx, store, protocols, taken, readOnly, onClose } = props
  const piAiNamespace = ctx.configForms.describe().getSnapshot().view?.namespaces.find((view) => view.ns === 'llm-pi-ai')
  const revision = piAiNamespace?.revision ?? 0
  const ordered = protocolOrder(protocols)
  const [baseURL, setBaseURL] = useState('')
  const [keyDraft, setKeyDraft] = useState('')
  const [protocol, setProtocol] = useState<string>(ordered[0] ?? '')
  const [displayName, setDisplayName] = useState('')
  const [candidates, setCandidates] = useState<DiscoveredModelView[] | undefined>(undefined)
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  const [filter, setFilter] = useState('')
  /* 连接失败或端点返回空列表后给出手动兜底输入。 */
  const [manual, setManual] = useState(false)
  const [manualIds, setManualIds] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  /* 首次保存前钉住路由:成功后重试必须沿用同一路由,而不是按已变新的
     taken 重新派生。credentialStored/profileStored 让重试从失败的步骤续跑。 */
  const [pinnedRoute, setPinnedRoute] = useState<string | undefined>(undefined)
  const [credentialStored, setCredentialStored] = useState(false)
  const [profileStored, setProfileStored] = useState(false)

  const keyFailure = apiKeyFailure(keyDraft)
  const keyValue = keyDraft.trim()
  const busy = connecting || saving
  /* 本机/局域网地址没有可读的站名;显示名退到带端口的本地化文案。 */
  const defaultName = (normalized: string): string => {
    const name = deriveDisplayName(normalized)
    if (name !== undefined) return name
    let port = ''
    try { port = new URL(normalized).port } catch { /* 解析不出就按无端口 */ }
    return port === '' ? text().localServiceNoPort : text().localService(port)
  }
  const filtered = candidates === undefined ? [] : candidates.filter((candidate) => {
    const needle = filter.trim().toLowerCase()
    if (needle === '') return true
    const name = typeof candidate.name === 'string' ? candidate.name : ''
    return candidate.id.toLowerCase().includes(needle) || name.toLowerCase().includes(needle)
  })
  const manualList = parseModelIds(manualIds)
  const pickedCount = candidates === undefined ? manualList.length : picked.size

  /* 改连接三件套就作废已取回的清单:候选属于旧的地址/密钥/协议组合。 */
  const dropCandidates = (): void => {
    if (candidates === undefined) return
    setCandidates(undefined)
    setPicked(new Set())
    setFilter('')
  }
  const editConnection = (setter: (value: string) => void) => (value: string): void => {
    setter(value)
    dropCandidates()
    setFailure(undefined)
  }

  const showFailure = (message: string, code?: string): void => {
    switch (discoveryFailureKind(message, code)) {
      case 'key': setFailure(text().connectKey); break
      case 'address': setFailure(text().connectAddress); break
      case 'network': setFailure(text().connectNetwork); break
      case 'unsupported': setFailure(text().fetchUnsupported); break
      default: setFailure(text().connectFailed(message))
    }
    setManual(true)
  }

  const connect = async (): Promise<void> => {
    if (readOnly || busy || baseURL.trim() === '' || keyFailure !== undefined) return
    const normalized = normalizeBaseURL(baseURL)
    setBaseURL(normalized)
    setConnecting(true)
    setFailure(undefined)
    try {
      const response = await ctx.remote.llm.discoverModels('llm-pi-ai', {
        baseURL: normalized,
        api: protocol,
        ...(keyValue.length > 0 ? { apiKey: keyValue } : {}),
      })
      const result = response
      if (!result.ok) {
        showFailure(result.error?.message ?? '', result.error?.code)
        return
      }
      if (!Array.isArray(result.value) || result.value.length === 0) {
        setFailure(text().connectAddress)
        setManual(true)
        return
      }
      setCandidates(result.value)
      setPicked(result.value.length <= 20 ? new Set(result.value.map((candidate) => candidate.id)) : new Set())
      setManual(false)
      setDisplayName((current) => (current.trim() === '' ? defaultName(normalized) : current))
    } catch (error) {
      const code = typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : undefined
      showFailure(error instanceof Error ? error.message : String(error), code)
    } finally {
      setConnecting(false)
    }
  }

  const save = async (): Promise<void> => {
    if (readOnly || busy || pickedCount === 0) return
    const normalized = normalizeBaseURL(baseURL)
    const route = pinnedRoute ?? deriveRoute(normalized, taken)
    if (pinnedRoute === undefined) setPinnedRoute(route)
    setSaving(true)
    setFailure(undefined)
    try {
      let models: Record<string, unknown>[]
      if (candidates === undefined) {
        models = manualList.map((id) => ({ id }))
      } else {
        models = candidates.filter((candidate) => picked.has(candidate.id)).map((candidate) => {
          const model: Record<string, unknown> = { id: candidate.id }
          if (typeof candidate.name === 'string' && candidate.name !== candidate.id) model['name'] = candidate.name
          if (typeof candidate.contextWindow === 'number') model['contextWindow'] = candidate.contextWindow
          if (typeof candidate.maxTokens === 'number') model['maxTokens'] = candidate.maxTokens
          const input = candidate['inputModalities']
          if (Array.isArray(input)) {
            const kinds = input.filter((kind): kind is 'text' | 'image' => kind === 'text' || kind === 'image')
            if (kinds.length > 0) model['input'] = kinds
          }
          return model
        })
      }
      const ids = models.map((model) => model['id'] as string)
      /* models.dev 补空字段;查询失败或查不到就静默沿用发现结果。 */
      try {
        const answer = await lookupCatalogFacts(ctx, route, ids)
        models = models.map((model) => {
          const facts = answer.facts[model['id'] as string]
          if (facts === undefined) return model
          return { ...model, ...catalogFill(model, 'pi-ai', protocol, facts).patch }
        })
      } catch { /* 补全失败不挡保存 */ }
      const name = displayName.trim() || defaultName(normalized) || route
      /* 密钥先写:settings.mutate 触发 settings/document-updated,模型目录随
         之刷新;密钥必须在此之前落库,否则目录把这条路由看成缺凭据。 */
      if (!credentialStored) {
        const credential = await ctx.remote.credentials.set(deriveKeyRef(route), keyValue.length > 0 ? keyValue : NO_KEY_PLACEHOLDER)
        if (!credential.ok) {
          setFailure(failureMessage(credential))
          return
        }
        setCredentialStored(true)
      }
      if (!profileStored) {
        const profile: Record<string, unknown> = {
          api: protocol,
          baseURL: normalized,
          models,
          cacheRetention: 'long',
          displayName: name,
          apiKeyEnv: deriveKeyRef(route),
        }
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
        setProfileStored(true)
      }
      onClose(true, text().addedNote(name, ids.length))
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  const togglePick = (id: string): void => {
    setPicked((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const filteredPicked = filtered.length > 0 && filtered.every((candidate) => picked.has(candidate.id))
  const toggleFiltered = (): void => {
    setPicked((current) => {
      const next = new Set(current)
      if (filteredPicked) for (const candidate of filtered) next.delete(candidate.id)
      else for (const candidate of filtered) next.add(candidate.id)
      return next
    })
  }
  const many = candidates !== undefined && candidates.length > 20

  return (
    <Box className="models-editor" data-testid="dsh-models-add-endpoint">
      <Flex className="models-editor-header" align="baseline" gap="2">
        <Text size="2" weight="medium" className="models-editor-title">
          {text().addEndpoint}
        </Text>
      </Flex>
      <Flex direction="column" gap="2" className="models-field" minWidth="0">
        <Text size="2" weight="medium" className="models-field-label">
          {text().baseUrl}
        </Text>
        <Input
          type="text"
          className="models-input"
          value={baseURL}
          placeholder="https://api.example.com/v1"
          aria-label={text().baseUrl}
          disabled={readOnly || busy}
          onChange={editConnection(setBaseURL)} />
        <Text size="1" color="gray" className="models-hint">
          {text().baseUrlHint}
        </Text>
      </Flex>
      <Flex direction="column" gap="2" className="models-field" minWidth="0">
        <Text size="2" weight="medium" className="models-field-label">
          {text().apiKey}
        </Text>
        <Input
          type="password"
          autoComplete="off"
          className="models-input"
          value={keyDraft}
          placeholder={text().apiKeyPlaceholder}
          aria-label={text().apiKey}
          aria-invalid={keyFailure !== undefined}
          disabled={readOnly || busy}
          onChange={editConnection(setKeyDraft)} />
        {keyFailure === undefined
          ? <Text size="1" color="gray" className="models-hint">
            {text().keyHint}
          </Text>
          : <Notice tone="danger" className="models-warning">
          <>
            {keyFailure === 'keyBlank' ? text().keyBlank : text().keyIllegal}
          </>
        </Notice>}
      </Flex>
      <Flex direction="column" gap="2" className="models-field" minWidth="0">
        <Text size="2" weight="medium" className="models-field-label">
          {text().protocol}
        </Text>
        <Select
          value={protocol}
          options={ordered.map<SelectOption>((value) => ({ value, label: protocolLabel(value) }))}
          onChange={editConnection(setProtocol)}
          disabled={readOnly || busy}
          aria-label={text().protocol} />
      </Flex>
      {failure !== undefined ? <Notice tone="danger" className="models-warning">
        <>
          {failure}
        </>
      </Notice> : null}
      {manual && candidates === undefined ? <Flex direction="column" gap="2" className="models-field" minWidth="0">
        <Text size="2" weight="medium" className="models-field-label">
          {text().manualModels}
        </Text>
        <Input
          type="text"
          className="models-input"
          value={manualIds}
          aria-label={text().manualModels}
          disabled={readOnly || busy}
          onChange={setManualIds} />
        <Text size="1" color="gray" className="models-hint">
          {text().manualModelsHint}
        </Text>
      </Flex> : null}
      {candidates === undefined ? null : <Fragment>
        <Text size="2" weight="medium" className="models-field-label">
          {text().foundModels(candidates.length)}
        </Text>
        {many ? <Text size="1" color="gray" className="models-hint">
          {text().manyModelsHint}
        </Text> : null}
        {candidates.length > 12 ? <Flex align="center" gap="2" className="models-pick-tools">
          <Input
            type="text"
            className="models-input"
            value={filter}
            aria-label={text().filterModels}
            disabled={readOnly || busy}
            onChange={setFilter} />
          <Button
            variant="secondary"
            size="sm"
            className="models-button"
            disabled={readOnly || busy}
            onClick={toggleFiltered}>
            {filteredPicked ? text().candidateDeselectAll : text().candidateSelectAll}
          </Button>
        </Flex> : null}
        <Flex asChild direction="column" gap="1" m="0" p="0">
          <ul className="models-candidate-list models-pick-list">
          {filtered.map((candidate) => <li key={candidate.id} className="models-candidate">
            <Flex className="models-candidate-label" align="center" gap="2">
              <Checkbox
                id={`model-pick-${candidate.id}`}
                checked={picked.has(candidate.id)}
                disabled={readOnly || busy}
                onCheckedChange={() => togglePick(candidate.id)} />
              <Text as="label" htmlFor={`model-pick-${candidate.id}`} size="2" weight="medium" className="models-candidate-id">
                {candidate.id}
              </Text>
              {typeof candidate.name === 'string' && candidate.name !== candidate.id ? <Badge tone="neutral" className="models-candidate-name">
                {candidate.name}
              </Badge> : null}
            </Flex>
          </li>)}
          </ul>
        </Flex>
      </Fragment>}
      {candidates !== undefined || manual ? <Flex direction="column" gap="2" className="models-field" minWidth="0">
        <Text size="2" weight="medium" className="models-field-label">
          {text().displayName}
        </Text>
        <Input
          type="text"
          className="models-input"
          value={displayName}
          placeholder={baseURL.trim() === '' ? text().displayName : defaultName(normalizeBaseURL(baseURL))}
          aria-label={text().displayName}
          disabled={readOnly || busy}
          onChange={setDisplayName} />
      </Flex> : null}
      <Flex className="models-editor-actions" gap="2" justify="end">
        <Button
          variant="secondary"
          className="models-button"
          disabled={busy}
          onClick={() => onClose(false)}>
          {text().cancel}
        </Button>
        {candidates !== undefined ? <Button
          variant="primary"
          className="models-button models-button-primary"
          disabled={readOnly || busy || pickedCount === 0}
          onClick={() => void save()}>
          {saving ? <Fragment>
            <ActivityDots />
            {text().saving}
          </Fragment> : t('common.save')}
        </Button> : <Fragment>
          {/* 手动兜底仍留在连接步:连接是次要的重试入口,保存是主操作。 */}
          {manual ? <Button
            variant="secondary"
            className="models-button"
            disabled={readOnly || busy || baseURL.trim() === '' || keyFailure !== undefined}
            onClick={() => void connect()}>
            {connecting ? <Fragment>
              <ActivityDots />
              {text().connecting}
            </Fragment> : text().connect}
          </Button> : null}
          {manual ? <Button
            variant="primary"
            className="models-button models-button-primary"
            disabled={readOnly || busy || pickedCount === 0}
            onClick={() => void save()}>
            {saving ? <Fragment>
              <ActivityDots />
              {text().saving}
            </Fragment> : t('common.save')}
          </Button> : <Button
            variant="primary"
            className="models-button models-button-primary"
            disabled={readOnly || busy || baseURL.trim() === '' || keyFailure !== undefined}
            onClick={() => void connect()}>
            {connecting ? <Fragment>
              <ActivityDots />
              {text().connecting}
            </Fragment> : text().connect}
          </Button>}
        </Fragment>}
      </Flex>
    </Box>
  );
}
