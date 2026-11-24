/** Model catalog drafts, discovery and candidate selection for provider cards. */
import { Fragment, useState, type ReactNode } from 'react'
import { Badge, Button, Card, Checkbox, Flex, Heading, IconButton, Input, Notice, Text } from '../ui/index.ts'
import type { DiscoveredModelView } from '../dsh-compat.ts'
import { catalogFill, inputFieldFor, reasoningChoiceOf, reasoningEffortsFor, type CatalogFacts, type CatalogField, type ModelFamily, type ReasoningChoice } from './settings-models-store.ts'
import { SHELL_RPC_CHANNEL } from '../capabilities.ts'
import { Select } from './select.tsx'
import type { SelectOption } from '../model/select.ts'
import { ChevronDownIcon, ChevronRightIcon, CrossIcon } from './icons.tsx'
import { ActivityDots, Dialog, DialogDescription, DialogTitle } from './ui/index.ts'

import { safeRpcCall, type ShellContext } from './shared.ts'
import { failureMessage, joinList, text } from './settings-models-copy.ts'

export type { ModelFamily }

type LookupValue = { fetchedAt: string; stale: boolean; models: Record<string, CatalogFacts> }

/* 宿主 `models.catalog.lookup` 的单批上限(入参 ids 去重后最多 200)。 */
const LOOKUP_BATCH = 200

export type CatalogLookupResult = {
  facts: Record<string, CatalogFacts>
  stale: boolean
  /* 第一批失败的起始下标与错误信息;该批及其后的 id 都没有结果。 */
  failure?: { start: number; message: string }
}

/* `models.catalog.lookup` 的分批调用,供模型编辑器的自动补全和「添加接口」
   卡的保存前补全共用:顺序请求,结果合并返回。某一批失败后跳过剩余批次,
   避免缓存刷新失败时连续叠 15s 超时。 */
export async function lookupCatalogFacts(ctx: ShellContext, provider: string, ids: string[]): Promise<CatalogLookupResult> {
  const facts: Record<string, CatalogFacts> = {}
  let stale = false
  for (let at = 0; at < ids.length; at += LOOKUP_BATCH) {
    const result = await safeRpcCall<LookupValue>(() => ctx.connection.rpc.call(SHELL_RPC_CHANNEL, 'models.catalog.lookup', { provider, ids: ids.slice(at, at + LOOKUP_BATCH) }))
    if (!result.ok) return { facts, stale, failure: { start: at, message: failureMessage(result) } }
    stale = stale || result.value.stale === true
    Object.assign(facts, result.value.models)
  }
  return { facts, stale }
}

/* JSON 值相等即可——来源记录里只有数字、字符串数组和 string|null 表。 */
function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/* Model-list editor shared by the editing and creating cards. Local state
   owns the per-row capacity keystroke buffer, the candidate picker, and the
   models.dev autofill bookkeeping. */
export function ModelListEditor(props: {
  ctx: ShellContext
  models: Record<string, unknown>[]
  settingsNs: string
  provider: string
  baseURL: string | undefined
  api: string | undefined
  apiKey: string | undefined
  family: ModelFamily
  catalogBacked: boolean
  disabled?: boolean
  /* models.dev 查询进行中报 true,让外层卡片先禁用保存/创建。 */
  onBusyChange?(busy: boolean): void
  onChange(models: Record<string, unknown>[]): void
  t: ReturnType<typeof text>
}): ReactNode {
  const { ctx, models, onChange, onBusyChange, settingsNs, provider, baseURL, api, apiKey, family, catalogBacked, disabled = false, t } = props
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set())
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [candidates, setCandidates] = useState<DiscoveredModelView[] | undefined>(undefined)
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  const [catalogBusy, setCatalogBusy] = useState(false)
  const [statuses, setStatuses] = useState<Record<number, string>>({})
  /* Mutable bookkeeping shared across renders: input types seen on discovery
     candidates, ids the author typed by hand (so a blur without an edit does
     not hit the network), the id each row last asked models.dev about,
     per-row field→auto-value provenance (so an id change drops only the
     values autofill actually wrote), overlapping lookup count (save stays
     gated until every in-flight request settles), whether the built-in
     catalog answer was already fetched for inherited input types, and the
     freshest model draft — an in-flight lookup applies against it so a
     slow fetch cannot overwrite edits made while the request was out. */
  const [refs] = useState(() => ({
    discoveredInputs: new Map<string, ('text' | 'image')[]>(),
    editedIds: new Set<number>(),
    lookupKeys: new Map<number, string>(),
    provenance: new Map<number, Map<string, unknown>>(),
    inflight: 0,
    discoveryAsked: false,
    latest: [] as Record<string, unknown>[],
  }))
  refs.latest = models
  const inputKey = inputFieldFor(family)
  const [, setDiscoveryTick] = useState(0)

  const fetchable = (provider !== '' || (baseURL !== undefined && baseURL.length > 0)) && apiKey === undefined || apiKey !== undefined

  const patch = (index: number, next: Record<string, unknown>): void => {
    onChange(models.map((model, at) => {
      if (at !== index) return model
      const cleared: string[] = []
      for (const [key, value] of Object.entries(next)) {
        if (value === undefined || value === '') cleared.push(key)
      }
      const merged = { ...model, ...next } as Record<string, unknown>
      for (const key of cleared) delete merged[key]
      return merged
    }))
  }
  const remove = (index: number): void => {
    onChange(models.filter((_, at) => at !== index))
    // 行号键的状态都跟行走:删掉被删行的项,后面的行号减一。
    const shifted = (at: number): number | undefined => (at === index ? undefined : at > index ? at - 1 : at)
    setExpanded((current) => {
      const next = new Set<number>()
      for (const at of current) {
        const moved = shifted(at)
        if (moved !== undefined) next.add(moved)
      }
      return next
    })
    setStatuses((current) => {
      const next: Record<number, string> = {}
      for (const [key, value] of Object.entries(current)) {
        const moved = shifted(Number(key))
        if (moved !== undefined) next[moved] = value
      }
      return next
    })
    const nextEdited = new Set<number>()
    refs.editedIds.forEach((at) => {
      const moved = shifted(at)
      if (moved !== undefined) nextEdited.add(moved)
    })
    refs.editedIds = nextEdited
    const nextLookups = new Map<number, string>()
    refs.lookupKeys.forEach((id, at) => {
      const moved = shifted(at)
      if (moved !== undefined) nextLookups.set(moved, id)
    })
    refs.lookupKeys = nextLookups
    const nextProvenance = new Map<number, Map<string, unknown>>()
    refs.provenance.forEach((fields, at) => {
      const moved = shifted(at)
      if (moved !== undefined) nextProvenance.set(moved, fields)
    })
    refs.provenance = nextProvenance
  }
  const toggle = (index: number): void => {
    const opening = !expanded.has(index)
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
    if (opening) ensureInheritedInputs(index)
  }
  /* 内置目录提供方(catalogBacked)不联网:这一行的 id 没有已知输入类型
     时,第一次展开高级区向 pi-ai 内置目录要一次 discoverModels(本地
     应答),把 inputModalities 当继承值显示。同一编辑器实例只调一次,
     结果缓存;失败就保持「文本」占位。 */
  const ensureInheritedInputs = (index: number): void => {
    if (!catalogBacked || inputKey === undefined || refs.discoveryAsked) return
    const id = models[index]?.['id']
    if (typeof id !== 'string' || id === '' || refs.discoveredInputs.has(id)) return
    refs.discoveryAsked = true
    void ctx.remote.llm.discoverModels(settingsNs, { provider }).then((result) => {
      if (!result?.ok || !Array.isArray(result.value)) return
      for (const candidate of result.value) {
        const input = candidate['inputModalities']
        if (Array.isArray(input)) {
          refs.discoveredInputs.set(candidate.id, input.filter((kind): kind is 'text' | 'image' => kind === 'text' || kind === 'image'))
        }
      }
      setDiscoveryTick((tick) => tick + 1)
    }).catch(() => { /* 本地目录读取失败就保持默认继承值 */ })
  }
  const add = (): void => {
    onChange([...models, { id: '' }])
  }

  const FIELD_LABEL: Record<CatalogField, string> = {
    context: t.fieldContext,
    max: t.fieldMax,
    input: t.fieldInput,
    reasoning: t.fieldReasoning,
  }

  /**
   * Ask `models.catalog.lookup` about the ids on the given rows and fill the
   * fields still empty. `announce` gates the miss and failure notices: auto
   * triggers (adopt, blur) stay silent when nothing was filled, while the
   * explicit row button always reports the outcome. Built-in catalog
   * providers inherit from the installed catalog, so the RPC is skipped
   * entirely for them.
   */
  const lookupIds = async (targets: { index: number; id: string }[], announce: boolean): Promise<void> => {
    if (catalogBacked || targets.length === 0) return
    targets.forEach(({ index, id }) => refs.lookupKeys.set(index, id))
    const setLookupBusy = (delta: number) => {
      const was = refs.inflight > 0
      refs.inflight += delta
      const next = refs.inflight > 0
      if (was === next) return
      setCatalogBusy(next)
      onBusyChange?.(next)
    }
    setLookupBusy(1)
    const notes: Record<number, string> = {}
    let merged: Record<string, CatalogFacts> = {}
    let stale = false
    try {
      const answer = await lookupCatalogFacts(ctx, provider, targets.map((target) => target.id))
      merged = answer.facts
      stale = answer.stale
      if (announce) {
        const failure = answer.failure
        if (failure !== undefined) targets.slice(failure.start).forEach(({ index }) => { notes[index] = failure.message })
      }
    } finally {
      setLookupBusy(-1)
    }
    /* 在请求挂起期间作者可能继续编辑;按最新草稿逐行判断——行还在原位
       (id 相同)且字段仍为空才补,绝不覆盖挂起期间敲进去的值。 */
    const latest = refs.latest
    const fills: Record<number, Record<string, unknown>> = {}
    for (const { index, id } of targets) {
      const row = latest[index]
      if (row?.id !== id) continue
      const facts = merged[id]
      if (facts === undefined) {
        if (announce && notes[index] === undefined) notes[index] = t.autofillMiss
        continue
      }
      const { patch: fill, fields } = catalogFill(row, family, api, facts)
      if (fields.length === 0) {
        if (announce && notes[index] === undefined) notes[index] = t.autofillNone
        continue
      }
      fills[index] = fill
      const note = t.autofilled(joinList(fields.map((field) => FIELD_LABEL[field])))
      notes[index] = stale ? note + t.autofillStale : note
    }
    if (Object.keys(fills).length > 0) {
      /* 立刻写回 refs.latest：重叠的 lookup 在同一轮完成时叠在已补全的草稿上，
         后到的 onChange 不会用过期快照盖掉先补上的行。 */
      const next = latest.map((model, index) => (fills[index] !== undefined ? { ...model, ...fills[index] } : model))
      refs.latest = next
      onChange(next)
      // 记录每个字段的自动写入值;作者改 ID 时把没被手改的自动值清回去。
      for (const [indexText, fill] of Object.entries(fills)) {
        const proven = refs.provenance.get(Number(indexText)) ?? new Map<string, unknown>()
        for (const [key, value] of Object.entries(fill)) proven.set(key, value)
        refs.provenance.set(Number(indexText), proven)
      }
    }
    if (Object.keys(notes).length > 0) setStatuses((prev) => ({ ...prev, ...notes }))
  }

  const fetch = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    try {
      const response = await ctx.remote.llm.discoverModels(settingsNs, {
        ...(provider !== '' ? { provider } : {}),
        ...(baseURL !== undefined && baseURL.length > 0 ? { baseURL } : {}),
        ...(api !== undefined ? { api } : {}),
        ...(apiKey !== undefined ? { apiKey } : {}),
      })
      const result = response
      if (!result.ok) {
        setFailure(failureMessage(result))
        return
      }
      if (result.value.length === 0) {
        setFailure(t.noListed)
        return
      }
      const known = new Set(models.map((model) => (typeof model['id'] === 'string' ? (model['id'] as string) : '')))
      for (const candidate of result.value) {
        const input = candidate['inputModalities']
        if (Array.isArray(input)) {
          refs.discoveredInputs.set(candidate.id, input.filter((kind): kind is 'text' | 'image' => kind === 'text' || kind === 'image'))
        }
      }
      setCandidates(result.value)
      setPicked(new Set(result.value.filter((model) => !known.has(model.id)).map((model) => model.id)))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // 协议不支持自动发现时,host 返回 model-discovery-failed,message 已经可读;
      // 其它失败同样显示 message,以免用户被空白卡住。
      if (/discovery|not support|不支持/.test(message)) setFailure(t.fetchUnsupported)
      else setFailure(message)
    } finally {
      setBusy(false)
    }
  }
  const closePicker = (): void => {
    setCandidates(undefined)
    setPicked(new Set())
  }
  const adoptPicked = (): void => {
    if (candidates === undefined) return
    const byId = new Map<string, Record<string, unknown>>()
    for (const model of models) {
      const id = model['id']
      if (typeof id === 'string') byId.set(id, model)
    }
    for (const candidate of candidates) {
      if (!picked.has(candidate.id)) continue
      const next: Record<string, unknown> = { id: candidate.id }
      if (candidate.name !== undefined) next['name'] = candidate.name
      if (candidate.contextWindow !== undefined) next['contextWindow'] = candidate.contextWindow
      if (candidate.maxTokens !== undefined) next['maxTokens'] = candidate.maxTokens
      if (inputKey !== undefined) {
        const input = candidate['inputModalities']
        if (Array.isArray(input)) {
          const kinds = input.filter((kind): kind is 'text' | 'image' => kind === 'text' || kind === 'image')
          if (kinds.length > 0) next[inputKey] = kinds
        }
      }
      byId.set(candidate.id, next)
    }
    const next = [...byId.values()]
    onChange(next)
    closePicker()
    // 下一次渲染前 lookup 就已经在读 refs.latest;先同步过去,采纳结果不丢。
    refs.latest = next
    /* 采纳候选自带字段也算自动写入:作者随后改 ID 时,没被手改的字段
       跟 models.dev 补的一样被清掉。 */
    next.forEach((model, index) => {
      if (typeof model['id'] !== 'string' || !picked.has(model['id'] as string)) return
      const proven = refs.provenance.get(index) ?? new Map<string, unknown>()
      for (const key of ['name', 'contextWindow', 'maxTokens', ...(inputKey !== undefined ? [inputKey] : [])]) {
        if (model[key] !== undefined) proven.set(key, model[key])
      }
      if (proven.size > 0) refs.provenance.set(index, proven)
    })
    // 发现候选自带字段之外，向 models.dev 补齐这一批 id 仍空着的字段。
    void lookupIds(
      next.map((model, index) => ({ index, id: model['id'] }))
        .filter((row): row is { index: number; id: string } => typeof row.id === 'string' && picked.has(row.id)),
      false,
    )
  }
  const togglePick = (id: string): void => {
    setPicked((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const allPicked = candidates !== undefined && candidates.length > 0 && candidates.every((candidate) => picked.has(candidate.id))
  const toggleAll = (): void => {
    if (candidates === undefined) return
    setPicked((current) => {
      if (candidates.every((candidate) => current.has(candidate.id))) return new Set()
      return new Set(candidates.map((candidate) => candidate.id))
    })
  }

  return (
    <section className="models-catalog" aria-label={t.models}>
      <Flex className="models-catalog-head" align="center" justify="between" gap="2">
        <Text size="2" weight="medium" className="models-catalog-title">
          {t.models}
        </Text>
        <Button
          variant="secondary"
          className="models-button"
          disabled={disabled || busy || !fetchable}
          onClick={() => void fetch()}>
          {busy ? <Fragment>
            <ActivityDots />
            {t.fetching}
          </Fragment> : t.fetchModels}
        </Button>
      </Flex>
      {models.length === 0
        ? <Text size="1" color="gray" className="models-empty">
        {t.noneAdded}
      </Text>
        : null}
      {models.map((model, index) => <Card
        // Rows only append or delete; the editable model ID must not own the input's identity.
        key={index}
        className="models-catalog-entry">
        <Flex className="models-catalog-row" align="center" gap="2" wrap="wrap">
          <Input
            type="text"
            className="models-input models-input-id"
            value={typeof model['id'] === 'string' ? (model['id'] as string) : ''}
            placeholder={t.modelId}
            aria-label={`${t.modelId} ${index + 1}`}
            disabled={disabled}
            onChange={(value) => {
              refs.editedIds.add(index)
              /* 键入只改 id。自动写入字段等到失焦且最终 id 确实变了
                 才清:失焦前改回去时保留已补全的参数。 */
              patch(index, { id: value })
            }}
            onBlur={() => {
              // 手动改过 ID 后失焦才查目录；同一 id 已查过就不再打扰。
              const id = model['id']
              if (typeof id !== 'string' || id === '' || !refs.editedIds.has(index)) return
              if (refs.lookupKeys.get(index) === id) return
              /* 最终 id 与上次查询不同:删掉仍等于自动写入值的字段
                 (作者手动改过的不动),并清空来源记录,再按新 id 重补。 */
              const proven = refs.provenance.get(index)
              if (proven !== undefined && proven.size > 0) {
                const clear: Record<string, unknown> = {}
                for (const [key, auto] of proven) {
                  if (sameValue(model[key], auto)) clear[key] = undefined
                }
                refs.provenance.delete(index)
                if (Object.keys(clear).length > 0) {
                  const row = { ...model } as Record<string, unknown>
                  for (const key of Object.keys(clear)) delete row[key]
                  patch(index, clear)
                  refs.latest = refs.latest.map((current, at) => at === index ? row : current)
                }
              }
              void lookupIds([{ index, id }], false)
            }} />
          <Input
            type="text"
            className="models-input models-input-name"
            value={typeof model['name'] === 'string' ? (model['name'] as string) : ''}
            placeholder={t.modelName}
            aria-label={`${t.modelName} ${index + 1}`}
            disabled={disabled}
            onChange={(value) => patch(index, { name: value === '' ? undefined : value })} />
          <IconButton
            label={`${t.modelAdvanced} ${index + 1}`}
            className="models-button models-button-icon"
            aria-expanded={expanded.has(index)}
            onClick={() => toggle(index)}>
            {expanded.has(index) ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
          </IconButton>
          <Button
            variant="danger"
            size="sm"
            className="models-button models-button-icon models-button-danger"
            aria-label={`${t.removeModel} ${index + 1}`}
            disabled={disabled}
            onClick={() => remove(index)}>
            <CrossIcon size={14} />
          </Button>
        </Flex>
        {expanded.has(index) ? <Flex className="models-catalog-advanced" direction="column" gap="2">
          <Flex asChild align="center" gap="3" className="models-field models-field-row">
            <label>
            <Text size="2" weight="medium" className="models-field-label">
              {t.modelContext}
            </Text>
            <Input
              type="number"
              className="models-input"
              min={1}
              step={1}
              value={typeof model['contextWindow'] === 'number' ? String(model['contextWindow']) : ''}
              placeholder={catalogBacked ? t.followCatalog : '256000'}
              aria-label={`${t.modelContext} ${index + 1}`}
              disabled={disabled}
              onChange={(raw) => {
                if (raw === '') patch(index, { contextWindow: undefined })
                else {
                  const n = Number(raw)
                  patch(index, { contextWindow: Number.isFinite(n) ? n : raw })
                }
              }} />
            </label>
          </Flex>
          <Flex asChild align="center" gap="3" className="models-field models-field-row">
            <label>
            <Text size="2" weight="medium" className="models-field-label">
              {t.modelMax}
            </Text>
            <Input
              type="number"
              className="models-input"
              min={1}
              step={1}
              value={typeof model['maxTokens'] === 'number' ? String(model['maxTokens']) : ''}
              placeholder={catalogBacked ? t.followCatalog : '8192'}
              aria-label={`${t.modelMax} ${index + 1}`}
              disabled={disabled}
              onChange={(raw) => {
                if (raw === '') patch(index, { maxTokens: undefined })
                else {
                  const n = Number(raw)
                  patch(index, { maxTokens: Number.isFinite(n) ? n : raw })
                }
              }} />
            </label>
          </Flex>
          {inputKey !== undefined ? <Flex align="center" gap="3" className="models-field models-field-row">
            <Text size="2" weight="medium" className="models-field-label">
              {t.modelInputTypes}
            </Text>
            {/* 两个复选框是一个控件组,只占 grid 第二列;窄窗整组换行而不是图片孤行。 */}
            <Flex align="center" gap="3" className="models-input-types">
              {(['text', 'image'] as const).map((kind) => {
                const stored = model[inputKey]
                // 字段为空时只显示继承值:内置目录的取发现结果,其余默认文本;
                // 只有点过复选框才会真正写入 input / inputModalities。
                const inherited = catalogBacked && typeof model['id'] === 'string'
                  ? refs.discoveredInputs.get(model['id'] as string) ?? ['text']
                  : ['text']
                const active = Array.isArray(stored)
                  ? stored.filter((value): value is 'text' | 'image' => value === 'text' || value === 'image')
                  : inherited
                const checked = active.includes(kind)
                return <Checkbox
                  key={kind}
                  checked={checked}
                  disabled={disabled || (checked && active.length === 1)}
                  label={kind === 'text' ? t.modelInputText : t.modelInputImage}
                  onCheckedChange={() => {
                    // 至少保留一种输入类型;空集对 pi-ai 与 deepseek 都非法。
                    const next = checked ? active.filter((value) => value !== kind) : [...active, kind]
                    if (next.length > 0) patch(index, { [inputKey]: next })
                  }} />
              })}
            </Flex>
          </Flex> : null}
          <Flex asChild align="center" gap="3" className="models-field models-field-row">
            <label>
            <Text size="2" weight="medium" className="models-field-label">
              {t.modelReasoning}
            </Text>
            <Select
              value={catalogBacked && model['reasoningEfforts'] === undefined ? 'catalog' : reasoningChoiceOf(model)}
              options={
                catalogBacked && model['reasoningEfforts'] === undefined
                  ? [
                    { value: 'catalog', label: t.followCatalog },
                    { value: 'standard', label: t.modelReasoningStandard },
                  ]
                  : [
                    { value: 'off', label: t.modelReasoningOff },
                    { value: 'standard', label: t.modelReasoningStandard },
                    ...(reasoningChoiceOf(model) === 'custom'
                      ? [{
                        value: 'custom',
                        // 自定义档位只读;标签列出除 off 外的键,方便对照手写配置。
                        label: t.modelReasoningCustom(joinList(Object.keys(model['reasoningEfforts'] as Record<string, unknown>).filter((key) => key !== 'off'))),
                      }]
                      : []),
                  ]}
              disabled={disabled}
              aria-label={`${t.modelReasoning} ${index + 1}`}
              onChange={(choice) => {
                // custom 与 catalog 都是只读态:前者回写手会清掉手写键,后者只是占位的继承提示。
                if (choice === 'custom' || choice === 'catalog') return
                patch(index, { reasoningEfforts: reasoningEffortsFor(choice as ReasoningChoice) })
              }} />
            </label>
          </Flex>
          {!catalogBacked ? <Flex align="center" gap="2" className="models-field models-field-row">
            <Button
              variant="secondary"
              size="sm"
              className="models-button"
              disabled={disabled || catalogBusy || typeof model['id'] !== 'string' || (model['id'] as string) === ''}
              onClick={() => {
                const id = model['id'] as string
                void lookupIds([{ index, id }], true)
              }}>
              {t.autofill}
            </Button>
          </Flex> : null}
          {statuses[index] !== undefined ? <Text size="1" color="gray" className="models-field models-autofill-status">
            {statuses[index]}
          </Text> : null}
        </Flex> : null}
      </Card>)}
      <Button
        variant="secondary"
        className="models-button models-button-add"
        disabled={disabled}
        onClick={add}>
        {`+ ${t.addModel}`}
      </Button>
      {failure !== undefined ? <Notice tone="danger" className="models-warning">
        {failure}
      </Notice> : null}
      <Dialog
        open={candidates !== undefined}
        onOpenChange={(next: boolean) => { if (!next) closePicker() }}
        className="file-dialog models-candidate-dialog"
        overlayClassName="file-dialog-overlay models-overlay">
        <header>
          <DialogTitle asChild>
            <Heading as="h2" size="4">
              {t.candidateTitle}
            </Heading>
          </DialogTitle>
          <DialogDescription asChild>
            <Text as="p" size="2" color="gray" className="models-candidate-description">
              {t.candidateDescription}
            </Text>
          </DialogDescription>
          <Button variant="secondary" className="models-button" onClick={closePicker}>
            {t.candidateClose}
          </Button>
        </header>
        <Flex className="models-candidate-actions" justify="end" gap="2" mb="2">
          <Button variant="secondary" className="models-button" onClick={toggleAll}>
            {allPicked ? t.candidateDeselectAll : t.candidateSelectAll}
          </Button>
        </Flex>
        <Flex asChild direction="column" gap="1" m="0" p="0">
          <ul className="models-candidate-list">
          {(candidates ?? []).map((candidate) => <Card asChild key={candidate.id}>
            <li className="models-candidate">
            <Flex className="models-candidate-label" align="center" gap="2">
              <Checkbox
                id={`model-candidate-${candidate.id}`}
                checked={picked.has(candidate.id)}
                onCheckedChange={() => togglePick(candidate.id)} />
              <Text as="label" htmlFor={`model-candidate-${candidate.id}`} size="2" weight="medium" className="models-candidate-id">
                {candidate.id}
              </Text>
              {candidate.name !== undefined ? <Badge tone="neutral" className="models-candidate-name">
                {candidate.name}
              </Badge> : null}
            </Flex>
            </li>
          </Card>)}
          </ul>
        </Flex>
        <Flex asChild justify="end" gap="2">
          <footer>
          <Button variant="secondary" className="models-button" onClick={closePicker}>
            {t.cancel}
          </Button>
          <Button variant="primary" className="models-button models-button-primary" onClick={adoptPicked}>
            {t.candidateAdopt}
          </Button>
          </footer>
        </Flex>
      </Dialog>
    </section>
  );
}
