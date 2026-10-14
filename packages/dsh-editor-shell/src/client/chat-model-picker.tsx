import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Button, Flex, Text } from '../ui/index.ts'
import { readModels, selectModel } from '../adapter.ts'
import type { SessionFace, SessionModels } from '../dsh-compat.ts'
import { Select } from './select.tsx'
import { ActivityText } from './ui/index.ts'
import { t } from '../i18n/index.ts'
import type { ShellContext } from './shared.ts'
import { ModelsStore } from './settings-models-state.ts'
import { currentModelNeedsKey, effortDisplay } from '../model/chat-model-picker.ts'

export function ModelPicker({ ctx, session, onConfigure }: { ctx: ShellContext; session: SessionFace; onConfigure(): void }) {
  const providerStore = useMemo(() => new ModelsStore(ctx.remote, ctx.configForms.describe(), ctx.settingsSchema), [ctx])
  const providers = useSyncExternalStore(providerStore.subscribe, providerStore.getSnapshot, providerStore.getSnapshot)
  const [models, setModels] = useState<SessionModels | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const refreshGeneration = useRef(0)
  const refresh = async () => {
    const ticket = ++refreshGeneration.current
    void providerStore.load()
    try {
      const result = await readModels(ctx.remote.session, session)
      if (ticket !== refreshGeneration.current) return
      if (!result.ok) { setNote(t('chat.apiUnavailable')); return }
      setModels(result.value)
      setNote('')
    } catch {
      if (ticket === refreshGeneration.current) setNote(t('chat.apiUnavailable'))
    }
  }
  useEffect(() => { setModels(null); void refresh(); return () => { refreshGeneration.current++; providerStore.generation++ } }, [ctx, session.sessionId, providerStore])
  useEffect(() => {
    const onCatalog = () => { void refresh() }
    const disposers: Array<unknown> = []
    try { disposers.push(ctx.remote.$on('settings/document-updated', onCatalog)) } catch { /* host may not forward */ }
    try { disposers.push(ctx.remote.$on('credentials/reference-updated', onCatalog)) } catch { /* ignore */ }
    try { disposers.push(ctx.remote.$on('llm/adapters-updated', onCatalog)) } catch { /* ignore */ }
    const host = ctx as unknown as { on?: (event: string, listener: () => void) => unknown }
    try { disposers.push(host.on?.('connection/reset', onCatalog)) } catch { /* host may not expose this event */ }
    return () => {
      for (const handle of disposers) {
        if (typeof handle === 'function') {
          try { (handle as () => void)() } catch { /* ignore */ }
        }
      }
    }
  }, [ctx, session.sessionId, providerStore])
  const choose = async (provider: string, model: string, reasoningEffort?: string) => {
    if (!models || busy) return
    setBusy(true); setNote('')
    try {
      const result = await selectModel(ctx.remote.session, session.sessionId, provider, model, reasoningEffort)
      if (!result.ok) { setNote(t('chat.modelSwitchFailed')); return }
      await refresh()
    } catch {
      setNote(t('chat.modelSwitchFailed'))
    } finally {
      setBusy(false)
    }
  }
  if (!models || models.groups.length === 0) {
    return (
      <Flex className="model-picker" align="center" gap="2" wrap="wrap" minWidth="0">
        <Text size="1" color="gray">
          {note || (models ? t('chat.noModels') : <ActivityText>
            {t('common.loading')}
          </ActivityText>)}
        </Text>
        <Button type="button" size="sm" variant="secondary" onClick={() => void refresh()}>
          {t('common.retry')}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onConfigure}>
          {t('chat.setApi')}
        </Button>
      </Flex>
    );
  }
  const options = models.groups.flatMap((group) => group.models.map((model) => ({
    value: `${group.id} ${model.id}`,
    label: `${group.name} · ${model.name || model.id}`,
  })))
  const currentValue = `${models.current.provider} ${models.current.model}`
  const currentCatalogModel = models.groups
    .find((group) => group.id === models.current.provider)?.models
    .find((model) => model.id === models.current.model)
  const currentFull = currentCatalogModel
    ? `${models.groups.find((group) => group.id === models.current.provider)?.name ?? models.current.provider} · ${currentCatalogModel.name || currentCatalogModel.id}`
    : models.current.model
  const efforts = currentCatalogModel?.reasoning?.efforts ?? []
  const effortValue = models.current.reasoningEffort ?? currentCatalogModel?.reasoning?.defaultEffort ?? ''
  const effortOptions = efforts.map((effort) => ({ value: effort.id, label: effortDisplay(effort.id, effort.name) }))
  const selectedEffort = efforts.find((effort) => effort.id === effortValue)
  const effortName = effortDisplay(effortValue, selectedEffort?.name) || t('select.unselected')
  const effortLabel = t('chat.effortTrigger', { name: effortName })
  return (
    <Flex direction="column" gap="2" minWidth="0">
    <Flex className="model-picker" align="center" gap="1" wrap="nowrap" minWidth="0">
      <Select
        value={options.some((option) => option.value === currentValue) ? currentValue : ''}
        placeholder={currentCatalogModel?.name || models.current.model}
        selectedLabel={currentCatalogModel?.name || models.current.model}
        aria-label={t('chat.chooseModel')}
        title={currentFull}
        align="start"
        disabled={busy}
        options={options}
        onChange={(next) => {
          const [provider, model] = next.split(' ')
          if (provider && model) void choose(provider, model)
        }} />
      {efforts.length > 0 ? <Flex className="model-effort" flexShrink="0">
        <Select
          value={effortOptions.some((option) => option.value === effortValue) ? effortValue : ''}
          placeholder={t('select.unselected')}
          selectedLabel={effortLabel}
          aria-label={t('chat.reasoning')}
          title={t('chat.effortValue', { name: effortName })}
          align="end"
          disabled={busy}
          options={effortOptions}
          onChange={(next) => { void choose(models.current.provider, models.current.model, next) }} />
      </Flex> : null}
      {note ? <Text size="1" className="warning" color="red" role="alert">
        {note}
      </Text> : null}
    </Flex>
    {!busy && !note && currentModelNeedsKey(models.current.provider, providers) ? <Flex align="center" gap="2" wrap="wrap" role="status">
      <Text size="2" color="gray">{t('chat.modelKeyMissing')}</Text>
      <Button type="button" size="sm" variant="secondary" onClick={onConfigure}>
        {t('chat.setApi')}
      </Button>
    </Flex> : null}
    </Flex>
  );
}

