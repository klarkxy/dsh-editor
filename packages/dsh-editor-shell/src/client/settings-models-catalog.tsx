/** Model catalog drafts, discovery and candidate selection for provider cards. */
import { Fragment, useState, type ChangeEvent, type ReactNode } from 'react'
import { Badge, Card, Checkbox, Callout, Flex, Heading, Text, TextField } from '@radix-ui/themes'
import type { DiscoveredModelView } from '../dsh-compat.ts'
import { reasoningChoiceOf, reasoningEffortsFor, type ReasoningChoice } from './settings-models-store.ts'
import { Select, type SelectOption } from './select.tsx'
import { ChevronDownIcon, ChevronRightIcon, CrossIcon } from './icons.tsx'
import { ActivityDots, Button, Dialog } from './ui/index.ts'
import type { ShellContext } from './shared.ts'
import { failureMessage, text } from './settings-models-copy.ts'

/* Model-list editor shared by the editing and creating cards. Local state
   owns the per-row capacity keystroke buffer and the candidate picker. */
export function ModelListEditor(props: {
  ctx: ShellContext
  models: Record<string, unknown>[]
  settingsNs: string
  provider: string
  baseURL: string | undefined
  api: string | undefined
  apiKey: string | undefined
  disabled?: boolean
  onChange(models: Record<string, unknown>[]): void
  t: ReturnType<typeof text>
}): ReactNode {
  const { ctx, models, onChange, settingsNs, provider, baseURL, api, apiKey, disabled = false, t } = props
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set())
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [candidates, setCandidates] = useState<DiscoveredModelView[] | undefined>(undefined)
  const [picked, setPicked] = useState<Set<string>>(() => new Set())

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
    setExpanded((current) => {
      const next = new Set<number>()
      for (const at of current) {
        if (at === index) continue
        next.add(at > index ? at - 1 : at)
      }
      return next
    })
  }
  const toggle = (index: number): void => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }
  const add = (): void => {
    onChange([...models, { id: '' }])
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
      byId.set(candidate.id, next)
    }
    onChange([...byId.values()])
    closePicker()
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
          <TextField.Root
            type="text"
            className="models-input models-input-id"
            value={typeof model['id'] === 'string' ? (model['id'] as string) : ''}
            placeholder={t.modelId}
            aria-label={`${t.modelId} ${index + 1}`}
            disabled={disabled}
            onChange={(event: ChangeEvent<HTMLInputElement>) => patch(index, { id: event.target.value })} />
          <TextField.Root
            type="text"
            className="models-input models-input-name"
            value={typeof model['name'] === 'string' ? (model['name'] as string) : ''}
            placeholder={t.modelName}
            aria-label={`${t.modelName} ${index + 1}`}
            disabled={disabled}
            onChange={(event: ChangeEvent<HTMLInputElement>) => patch(index, { name: event.target.value === '' ? undefined : event.target.value })} />
          <Button
            variant="icon"
            className="models-button models-button-icon"
            aria-label={`${t.modelAdvanced} ${index + 1}`}
            aria-expanded={expanded.has(index)}
            onClick={() => toggle(index)}>
            {expanded.has(index) ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
          </Button>
          <Button
            variant="danger"
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
            <TextField.Root
              type="number"
              className="models-input"
              min={1}
              step={1}
              value={typeof model['contextWindow'] === 'number' ? String(model['contextWindow']) : ''}
              placeholder="256000"
              aria-label={`${t.modelContext} ${index + 1}`}
              disabled={disabled}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                const raw = event.target.value
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
            <TextField.Root
              type="number"
              className="models-input"
              min={1}
              step={1}
              value={typeof model['maxTokens'] === 'number' ? String(model['maxTokens']) : ''}
              placeholder="8192"
              aria-label={`${t.modelMax} ${index + 1}`}
              disabled={disabled}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                const raw = event.target.value
                if (raw === '') patch(index, { maxTokens: undefined })
                else {
                  const n = Number(raw)
                  patch(index, { maxTokens: Number.isFinite(n) ? n : raw })
                }
              }} />
            </label>
          </Flex>
          <Flex asChild align="center" gap="3" className="models-field models-field-row">
            <label>
            <Text size="2" weight="medium" className="models-field-label">
              {t.modelReasoning}
            </Text>
            <Select
              value={reasoningChoiceOf(model)}
              options={[
                { value: 'off', label: t.modelReasoningOff },
                { value: 'standard', label: t.modelReasoningStandard },
                ...(reasoningChoiceOf(model) === 'custom' ? [{ value: 'custom', label: t.modelReasoningCustom }] : []),
              ]}
              disabled={disabled}
              aria-label={`${t.modelReasoning} ${index + 1}`}
              onChange={(choice) => {
                // custom 只在读取手写配置时出现,不可由此写入;切回其它档位才会落盘。
                if (choice === 'custom') return
                patch(index, { reasoningEfforts: reasoningEffortsFor(choice as ReasoningChoice) })
              }} />
            </label>
          </Flex>
        </Flex> : null}
      </Card>)}
      <Button
        className="models-button models-button-add"
        disabled={disabled}
        onClick={add}>
        {`+ ${t.addModel}`}
      </Button>
      {failure !== undefined ? <Callout.Root color="red" role="alert" className="models-warning">
        <Callout.Text>
          {failure}
        </Callout.Text>
      </Callout.Root> : null}
      <Dialog
        open={candidates !== undefined}
        onOpenChange={(next: boolean) => { if (!next) closePicker() }}
        title={t.candidateTitle}
        description={t.candidateDescription}
        className="file-dialog models-candidate-dialog"
        overlayClassName="file-dialog-overlay models-overlay">
        <header>
          <Heading as="h2" size="4">
            {t.candidateTitle}
          </Heading>
          <Text as="p" size="2" color="gray" className="models-candidate-description">
            {t.candidateDescription}
          </Text>
          <Button className="models-button" onClick={closePicker}>
            {t.candidateClose}
          </Button>
        </header>
        <Flex className="models-candidate-actions" justify="end" gap="2" mb="2">
          <Button className="models-button" onClick={toggleAll}>
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
              {candidate.name !== undefined ? <Badge size="1" color="gray" className="models-candidate-name">
                {candidate.name}
              </Badge> : null}
            </Flex>
            </li>
          </Card>)}
          </ul>
        </Flex>
        <Flex asChild justify="end" gap="2">
          <footer>
          <Button className="models-button" onClick={closePicker}>
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
