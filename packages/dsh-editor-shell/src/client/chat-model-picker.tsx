import { useEffect, useRef, useState } from 'react'
import { Button, Flex, Text } from '@radix-ui/themes'
import { readModels, selectModel } from '../adapter.ts'
import type { SessionFace, SessionModels } from '../dsh-compat.ts'
import { Select } from './select.tsx'
import { ActivityText } from './ui/index.ts'
import { t, type MessageKey } from '../i18n/index.ts'
import type { ShellContext } from './shared.ts'

const EFFORT_LABELS: Record<string, MessageKey> = {
  off: 'chat.effortOff',
  none: 'chat.effortOff',
  low: 'chat.effortLow',
  medium: 'chat.effortMedium',
  high: 'chat.effortHigh',
  xhigh: 'chat.effortXHigh',
  max: 'chat.effortMax',
}

/** Host `off` is the none-thinking slot. Labels follow the UI locale. */
export function effortDisplay(id: string, name?: string): string {
  if (!id) return ''
  const key = EFFORT_LABELS[id]
  return key ? t(key) : name || id
}

/** Visible trigger next to the model name: “思考 关”, not the bare “关” or the field name “思考强度”. */
export function effortTriggerLabel(id: string): string {
  const name = effortDisplay(id) || t('chat.effortOff')
  return t('chat.effortTrigger', { name })
}

export function ModelPicker({ ctx, session, onConfigure }: { ctx: ShellContext; session: SessionFace; onConfigure(): void }) {
  const [models, setModels] = useState<SessionModels | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const refreshGeneration = useRef(0)
  const refresh = async () => {
    const ticket = ++refreshGeneration.current
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
  useEffect(() => { setModels(null); void refresh(); return () => { refreshGeneration.current++ } }, [ctx, session.sessionId])
  useEffect(() => {
    const onCatalog = () => { void refresh() }
    const disposers: Array<unknown> = []
    try { disposers.push(ctx.remote.$on('settings/document-updated', onCatalog)) } catch { /* host may not forward */ }
    try { disposers.push(ctx.remote.$on('credentials/reference-updated', onCatalog)) } catch { /* ignore */ }
    try { disposers.push(ctx.remote.$on('llm/adapters-updated', onCatalog)) } catch { /* ignore */ }
    return () => {
      for (const handle of disposers) {
        if (typeof handle === 'function') {
          try { (handle as () => void)() } catch { /* ignore */ }
        }
      }
    }
  }, [ctx, session.sessionId])
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
        <Button type="button" size="1" variant="soft" color="gray" onClick={() => void refresh()}>
          {t('common.retry')}
        </Button>
        <Button type="button" size="1" variant="soft" color="gray" onClick={onConfigure}>
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
  );
}

