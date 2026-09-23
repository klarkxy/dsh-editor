import { useEffect, useRef, useState } from 'react'
import { Button, Flex, Text } from '@radix-ui/themes'
import { readModels, selectModel } from '../adapter.ts'
import type { SessionFace, SessionModels } from '../dsh-compat.ts'
import { Select } from './select.tsx'
import { ActivityText } from './ui/index.ts'
import { t, type MessageKey } from '../i18n/index.ts'
import type { ShellContext } from './shared.ts'
import { STANDARD_REASONING_EFFORTS } from './settings-models-store.ts'

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
export function effortDisplay(id: string): string {
  if (!id) return ''
  const key = EFFORT_LABELS[id]
  return key ? t(key) : id
}

/** Visible trigger next to the model name; never the field name “思考强度”. */
export function effortTriggerLabel(id: string): string {
  return effortDisplay(id) || t('chat.effortOff')
}

function fallbackEffortOptions(): { value: string; label: string }[] {
  return Object.keys(STANDARD_REASONING_EFFORTS).map((id) => ({ value: id, label: effortDisplay(id) }))
}

/* 自定义模型未显式选过强度时的默认档:写真实的选择,而不是只显示一个值。 */
const DEFAULT_FALLBACK_EFFORT = 'medium'

/** Read the hand-declared pi-ai provider profile for `provider`, when the route is one. */
function piAiCustomProfile(ctx: ShellContext, provider: string): { profile: Record<string, unknown>; revision: number } | undefined {
  const ns = ctx.configForms.describe().getSnapshot().view?.namespaces.find((entry) => entry.ns === 'llm-pi-ai')
  const user = ns?.user
  const providers = typeof user === 'object' && user !== null && !Array.isArray(user)
    ? (user as Record<string, unknown>)['providers'] : undefined
  const profile = typeof providers === 'object' && providers !== null && !Array.isArray(providers)
    ? (providers as Record<string, unknown>)[provider] : undefined
  return typeof profile === 'object' && profile !== null && !Array.isArray(profile) && ns
    ? { profile: profile as Record<string, unknown>, revision: ns.revision }
    : undefined
}

export function ModelPicker({ ctx, session, onConfigure }: { ctx: ShellContext; session: SessionFace; onConfigure(): void }) {
  const [models, setModels] = useState<SessionModels | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [customRoute, setCustomRoute] = useState(false)
  const refresh = async () => {
    const result = await readModels(ctx.remote.session, session)
    if (!result.ok) { setNote(t('chat.apiUnavailable')); return }
    await ctx.configForms.describe().ensure()
    setModels(result.value)
    setCustomRoute(piAiCustomProfile(ctx, result.value.current.provider) !== undefined)
    setNote('')
  }
  useEffect(() => { setModels(null); void refresh() }, [session.sessionId])
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
  /* 首次给无元数据的自定义模型选强度:把约定六档写进它的模型声明。 */
  const declareEfforts = async (): Promise<boolean> => {
    if (!models) return false
    const found = piAiCustomProfile(ctx, models.current.provider)
    if (!found) return false
    const list = found.profile['models']
    if (!Array.isArray(list)) return false
    const index = list.findIndex((entry) =>
      typeof entry === 'object' && entry !== null && (entry as Record<string, unknown>)['id'] === models.current.model)
    if (index < 0) return false
    const entry = list[index] as Record<string, unknown>
    if (typeof entry['reasoningEfforts'] === 'object' && entry['reasoningEfforts'] !== null) return true
    const nextModels = list.map((item, at) => at === index ? { ...(item as Record<string, unknown>), reasoningEfforts: { ...STANDARD_REASONING_EFFORTS } } : item)
    const response = await ctx.remote.settings.mutate(
      'llm-pi-ai',
      [{ op: 'set', path: ['providers', models.current.provider, 'models'], value: nextModels }],
      found.revision,
    )
    return response.ok
  }
  const choose = async (provider: string, model: string, reasoningEffort?: string) => {
    if (!models || busy) return
    setBusy(true); setNote('')
    if (reasoningEffort !== undefined) {
      const declared = (models.groups.find((group) => group.id === provider)?.models
        .find((item) => item.id === model)?.reasoning?.efforts.length ?? 0) > 0
      if (!declared && !(await declareEfforts())) {
        setNote(t('chat.reasoningFailed'))
        setBusy(false)
        return
      }
    }
    const result = await selectModel(ctx.remote.session, session.sessionId, provider, model, reasoningEffort)
    if (!result.ok) setNote(t('chat.modelSwitchFailed'))
    await refresh()
    setBusy(false)
  }
  /*
   * 自定义模型还没选过强度时,自动落一个真实的中档默认:先补声明(幂等),
   * 再选 medium。只显示占位符会让"当前强度"无答案,也不符合端点默认即
   * medium 的常识。每个会话+模型只尝试一次,失败就只留提示不纠缠。
   */
  const autoDefaultAttempted = useRef('')
  useEffect(() => {
    if (!models || !customRoute || busy || models.current.reasoningEffort) return
    const catalogModel = models.groups.find((group) => group.id === models.current.provider)?.models
      .find((item) => item.id === models.current.model)
    if ((catalogModel?.reasoning?.efforts.length ?? 0) > 0) return
    const key = `${session.sessionId}:${models.current.provider}:${models.current.model}`
    if (autoDefaultAttempted.current === key) return
    autoDefaultAttempted.current = key
    void (async () => {
      if (!(await declareEfforts())) return
      await selectModel(ctx.remote.session, session.sessionId, models.current.provider, models.current.model, DEFAULT_FALLBACK_EFFORT)
      await refresh()
    })()
  }, [models, customRoute, busy])
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
  const effortOptions = efforts.length > 0
    ? efforts.map((effort) => ({ value: effort.id, label: effortDisplay(effort.id) }))
    : fallbackEffortOptions()
  const showReasoning = efforts.length > 0 || customRoute
  const effortLabel = effortTriggerLabel(effortValue)
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
      {showReasoning ? <Flex className="model-effort" flexShrink="0">
        <Select
          value={effortOptions.some((option) => option.value === effortValue) ? effortValue : ''}
          placeholder={t('chat.effortOff')}
          selectedLabel={effortLabel}
          aria-label={t('chat.reasoning')}
          title={effortLabel}
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

