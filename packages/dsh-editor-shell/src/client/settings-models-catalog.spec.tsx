import { isValidElement, useState, type ReactElement, type ReactNode, type SetStateAction } from 'react'
import { Button, Card, Checkbox, Input, Text } from '../ui/index.ts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Schema from '@deepseek-ai/schemastery'
import { ModelListEditor, type ModelFamily } from './settings-models-catalog.tsx'
import { reasoningEffortsFromCatalog } from './settings-models-store.ts'
import { Select } from './select.tsx'
import { text } from './settings-models-copy.ts'
import type { ShellContext } from './shared.ts'

vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(), useState: vi.fn(),
}))

type EditorOptions = {
  family?: ModelFamily
  catalogBacked?: boolean
  api?: string
  /** Stub for ctx.connection.rpc.call (models.catalog.lookup answers). */
  call?: (...args: unknown[]) => Promise<unknown>
  /** Stub for ctx.remote.llm.discoverModels. */
  discover?: (...args: unknown[]) => Promise<unknown>
  /** Wired to the card's save-button gate. */
  onBusyChange?: (busy: boolean) => void
}

/** Exercise editor event handlers and the resulting React reconciliation keys without a browser. */
function editor(initial: Record<string, unknown>[], options: EditorOptions = {}) {
  let models = initial
  let cursor = 0
  const state: unknown[] = []
  vi.mocked(useState).mockImplementation(((initialState: unknown) => {
    const slot = cursor++
    if (!(slot in state)) state[slot] = typeof initialState === 'function' ? initialState() : initialState
    return [state[slot], (next: SetStateAction<unknown>) => {
      state[slot] = typeof next === 'function' ? next(state[slot]) : next
    }]
  }) as typeof useState)
  const call = options.call ?? vi.fn(async () => ({ ok: true, value: { fetchedAt: '', stale: false, models: {} } }))
  const discover = options.discover ?? vi.fn(async () => ({ ok: true, value: [] }))
  const ctx = {
    connection: { rpc: { call } },
    remote: { llm: { discoverModels: discover } },
  } as unknown as ShellContext
  function render() {
    cursor = 0
    return ModelListEditor({
      ctx, models, settingsNs: 'llm-pi-ai', provider: 'custom',
      baseURL: undefined, api: options.api, apiKey: undefined,
      family: options.family ?? 'pi-ai',
      catalogBacked: options.catalogBacked ?? false,
      onBusyChange: options.onBusyChange,
      onChange: next => { models = next }, t: text(),
    })
  }
  return { render, models: () => models, call, discover }
}

function nodes(tree: ReactNode, predicate: (node: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(tree)) return tree.flatMap(child => nodes(child, predicate))
  if (!isValidElement<Record<string, unknown>>(tree)) return []
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props.children as ReactNode, predicate)]
}
function rows(tree: ReactNode) { return nodes(tree, node => node.type === Card) }
function field(tree: ReactNode, label: string) {
  return nodes(tree, node => node.type === Input && node.props['aria-label'] === label)[0]!
}
function typeValue(input: ReactElement<Record<string, unknown>>, value: string) {
  (input.props.onChange as (next: string) => void)(value)
}
function click(tree: ReactNode, label: string) {
  /* 内部 IconButton 的可访问名走 label prop（渲染成 aria-label），两种都要认。 */
  const button = nodes(tree, node => node.props['aria-label'] === label || node.props['label'] === label)[0]!
  ;(button.props.onClick as () => void)()
}
function pressButton(tree: ReactNode, label: string) {
  const button = nodes(tree, node => node.type === Button && node.props['children'] === label)[0]!
  ;(button.props.onClick as () => void)()
}
/** Let the models.catalog.lookup promise chain settle before asserting. */
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0))

beforeEach(() => vi.clearAllMocks())

describe('provider model draft editing', () => {
  it('retains row identity through ordinary typing, paste and Chinese display names', () => {
    const form = editor([{ id: '' }])
    const key = rows(form.render())[0]!.key
    let value = ''
    for (const character of 'mimo-v2.6-flash') {
      value += character
      typeValue(field(form.render(), `${text().modelId} 1`), value)
      expect(rows(form.render())[0]!.key).toBe(key)
      expect(field(form.render(), `${text().modelId} 1`).props.value).toBe(value)
    }
    typeValue(field(form.render(), `${text().modelId} 1`), 'pasted-model')
    typeValue(field(form.render(), `${text().modelName} 1`), '中文模型名称')
    expect(rows(form.render())[0]!.key).toBe(key)
    expect(form.models()).toEqual([{ id: 'pasted-model', name: '中文模型名称' }])
  })

  it('keeps advanced fields attached to the surviving draft after deleting an earlier row', () => {
    const form = editor([{ id: 'first', contextWindow: 100 }, { id: 'second', contextWindow: 200, maxTokens: 50 }])
    click(form.render(), `${text().modelAdvanced} 2`)
    click(form.render(), `${text().removeModel} 1`)
    expect(field(form.render(), `${text().modelContext} 1`).props.value).toBe('200')
    expect(field(form.render(), `${text().modelMax} 1`).props.value).toBe('50')
    typeValue(field(form.render(), `${text().modelContext} 1`), '400')
    expect(form.models()).toEqual([{ id: 'second', contextWindow: 400, maxTokens: 50 }])
  })

  it('drops the deleted draft expansion instead of opening a later row', () => {
    const form = editor([{ id: 'first' }, { id: 'second', contextWindow: 200 }])
    click(form.render(), `${text().modelAdvanced} 1`)
    click(form.render(), `${text().removeModel} 1`)
    expect(nodes(form.render(), node => node.props['aria-label'] === `${text().modelContext} 1`)).toHaveLength(0)
    expect(form.models()).toEqual([{ id: 'second', contextWindow: 200 }])
  })
})

const FLASH = {
  contextWindow: 131072,
  maxTokens: 16384,
  input: ['text', 'image'],
  reasoning: { efforts: ['low', 'high', 'max'], canDisable: true },
}
function catalogOk(models: Record<string, unknown>, stale = false) {
  return { ok: true, value: { fetchedAt: 'now', stale, models } }
}

describe('models.dev autofill', () => {
  it('fills every empty field after a hand-typed id blurs, using pi-ai field names', async () => {
    const call = vi.fn(async () => catalogOk({ 'deepseek-flash': FLASH }))
    const form = editor([{ id: '' }], { call })
    click(form.render(), `${text().modelAdvanced} 1`)
    typeValue(field(form.render(), `${text().modelId} 1`), 'deepseek-flash')
    ;(field(form.render(), `${text().modelId} 1`).props['onBlur'] as () => void)()
    await settle()
    expect(call).toHaveBeenCalledTimes(1)
    expect(call).toHaveBeenCalledWith('/dsh-editor-shell', 'models.catalog.lookup', { provider: 'custom', ids: ['deepseek-flash'] })
    expect(form.models()).toEqual([{
      id: 'deepseek-flash',
      contextWindow: 131072,
      maxTokens: 16384,
      input: ['text', 'image'],
      reasoningEfforts: { off: null, low: 'low', high: 'high', max: 'max' },
    }])
    expect(nodes(form.render(), node => node.props['children'] === text().autofilled('上下文、最大输出、输入类型、思考强度'))).toHaveLength(1)
  })

  it('does not fire the lookup on a blur without an edit, nor twice for the same id', async () => {
    const call = vi.fn(async () => catalogOk({ 'deepseek-flash': FLASH }))
    const form = editor([{ id: 'deepseek-flash' }], { call })
    ;(field(form.render(), `${text().modelId} 1`).props['onBlur'] as () => void)()
    await settle()
    expect(call).not.toHaveBeenCalled()
    typeValue(field(form.render(), `${text().modelId} 1`), 'deepseek-flash')
    ;(field(form.render(), `${text().modelId} 1`).props['onBlur'] as () => void)()
    ;(field(form.render(), `${text().modelId} 1`).props['onBlur'] as () => void)()
    await settle()
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('writes inputModalities and skips reasoningEfforts for deepseek providers', async () => {
    const call = vi.fn(async () => catalogOk({ 'deepseek-flash': FLASH }))
    const form = editor([{ id: '' }], { call, family: 'deepseek' })
    typeValue(field(form.render(), `${text().modelId} 1`), 'deepseek-flash')
    ;(field(form.render(), `${text().modelId} 1`).props['onBlur'] as () => void)()
    await settle()
    expect(form.models()).toEqual([{
      id: 'deepseek-flash',
      contextWindow: 131072,
      maxTokens: 16384,
      inputModalities: ['text', 'image'],
    }])
  })

  it('never overwrites values the author or discovery already set', async () => {
    const call = vi.fn(async () => catalogOk({ m: { contextWindow: 999, maxTokens: 999 } }))
    const form = editor([{ id: 'm', contextWindow: 1 }], { call })
    typeValue(field(form.render(), `${text().modelId} 1`), 'm')
    ;(field(form.render(), `${text().modelId} 1`).props['onBlur'] as () => void)()
    await settle()
    expect(form.models()).toEqual([{ id: 'm', contextWindow: 1, maxTokens: 999 }])
  })

  it('keeps only the Gemini effort spellings and omits off when thinking cannot be disabled', async () => {
    const call = vi.fn(async () => catalogOk({
      'gemini-3-pro': {
        contextWindow: 1048576,
        reasoning: { efforts: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'], canDisable: false },
      },
    }))
    const form = editor([{ id: '' }], { call, api: 'google-generative-ai' })
    typeValue(field(form.render(), `${text().modelId} 1`), 'gemini-3-pro')
    ;(field(form.render(), `${text().modelId} 1`).props['onBlur'] as () => void)()
    await settle()
    expect(form.models()).toEqual([{
      id: 'gemini-3-pro',
      contextWindow: 1048576,
      reasoningEfforts: { minimal: 'minimal', low: 'low', medium: 'medium', high: 'high' },
    }])
  })

  it('writes no reasoningEfforts when the catalog marks the model non-reasoning', async () => {
    const call = vi.fn(async () => catalogOk({ m: { contextWindow: 10, reasoning: false } }))
    const form = editor([{ id: '' }], { call })
    typeValue(field(form.render(), `${text().modelId} 1`), 'm')
    ;(field(form.render(), `${text().modelId} 1`).props['onBlur'] as () => void)()
    await settle()
    expect(form.models()).toEqual([{ id: 'm', contextWindow: 10 }])
  })

  it('keeps discovery candidate fields ahead of the catalog on adopt', async () => {
    const call = vi.fn(async () => catalogOk({
      alpha: { contextWindow: 999, maxTokens: 50 },
      beta: { contextWindow: 5, maxTokens: 6 },
    }))
    const discover = vi.fn(async () => ({
      ok: true,
      value: [
        { id: 'alpha', contextWindow: 100, inputModalities: ['text', 'image'] },
        { id: 'beta' },
      ],
    }))
    const form = editor([], { call, discover })
    pressButton(form.render(), text().fetchModels)
    await settle()
    pressButton(form.render(), text().candidateAdopt)
    expect(form.models()).toEqual([
      { id: 'alpha', contextWindow: 100, input: ['text', 'image'] },
      { id: 'beta' },
    ])
    await settle()
    expect(call).toHaveBeenCalledWith('/dsh-editor-shell', 'models.catalog.lookup', { provider: 'custom', ids: ['alpha', 'beta'] })
    expect(form.models()).toEqual([
      { id: 'alpha', contextWindow: 100, input: ['text', 'image'], maxTokens: 50 },
      { id: 'beta', contextWindow: 5, maxTokens: 6 },
    ])
  })

  it('reports the miss only for the explicit row button', async () => {
    const call = vi.fn(async () => catalogOk({}))
    const form = editor([{ id: 'unknown' }], { call })
    click(form.render(), `${text().modelAdvanced} 1`)
    typeValue(field(form.render(), `${text().modelId} 1`), 'unknown')
    ;(field(form.render(), `${text().modelId} 1`).props['onBlur'] as () => void)()
    await settle()
    expect(nodes(form.render(), node => node.props['children'] === text().autofillMiss)).toHaveLength(0)
    pressButton(form.render(), text().autofill)
    await settle()
    expect(nodes(form.render(), node => node.props['children'] === text().autofillMiss)).toHaveLength(1)
  })

  it('marks the notice when the host answered from the stale cache', async () => {
    const call = vi.fn(async () => catalogOk({ m: { contextWindow: 7 } }, true))
    const form = editor([{ id: 'm' }], { call })
    click(form.render(), `${text().modelAdvanced} 1`)
    pressButton(form.render(), text().autofill)
    await settle()
    const note = text().autofilled(text().fieldContext) + text().autofillStale
    expect(nodes(form.render(), node => node.props['children'] === note)).toHaveLength(1)
  })

  it('keeps edits typed while the lookup is in flight', async () => {
    let release!: (value: unknown) => void
    const call = vi.fn(() => new Promise((resolve) => { release = resolve }))
    const form = editor([{ id: 'm' }, { id: 'other' }], { call })
    click(form.render(), `${text().modelAdvanced} 1`)
    typeValue(field(form.render(), `${text().modelId} 1`), 'm')
    ;(field(form.render(), `${text().modelId} 1`).props['onBlur'] as () => void)()
    // 请求挂起期间作者继续编辑:同一行的上下文、另一行的 id。
    typeValue(field(form.render(), `${text().modelContext} 1`), '42')
    typeValue(field(form.render(), `${text().modelId} 2`), 'renamed')
    form.render() // React 重渲染会同步 refs.latest;结果只补仍为空的字段
    await settle() // 让 rpc.call 在微任务里先被调起,拿到挂起的 release
    release(catalogOk({
      m: {
        contextWindow: 999,
        maxTokens: 50,
        input: ['text'],
        reasoning: { efforts: ['low'], canDisable: true },
      },
    }))
    await settle()
    expect(form.models()).toEqual([
      { id: 'm', contextWindow: 42, maxTokens: 50, input: ['text'], reasoningEfforts: { off: null, low: 'low' } },
      { id: 'renamed' },
    ])
  })

  it('keeps each row status with its row when an earlier row is removed', async () => {
    const call = vi.fn(async () => catalogOk({}))
    const form = editor([{ id: 'a' }, { id: 'b' }], { call })
    click(form.render(), `${text().modelAdvanced} 2`)
    pressButton(form.render(), text().autofill)
    await settle()
    expect(nodes(form.render(), node => node.props['children'] === text().autofillMiss)).toHaveLength(1)
    click(form.render(), `${text().removeModel} 1`)
    const tree = form.render()
    // 状态跟行不跟行号:b 挪到第 1 行后,miss 提示仍挂在它自己的高级区。
    expect(field(tree, `${text().modelId} 1`).props['value']).toBe('b')
    expect(nodes(tree, node => node.props['children'] === text().autofillMiss)).toHaveLength(1)
  })

  /* 真实条目摘录:openai/gpt-5.2 的 effort 值含 none(可关思考),写进
     reasoningEfforts 必须过宿主 schema——pi-ai 的 THINKING_LEVELS 键集合
     {off,minimal,low,medium,high,xhigh,max},值是 string|null。 */
  const REASONING_SCHEMA = Schema.dict(
    Schema.union([Schema.string(), null] as const),
    Schema.union(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const),
  )

  it('maps a real gpt-5.2 none effort to off:none inside the host thinking levels', async () => {
    const call = vi.fn(async () => catalogOk({
      'gpt-5.2': {
        contextWindow: 400000,
        maxTokens: 128000,
        input: ['text', 'image'],
        reasoning: { efforts: ['none', 'low', 'medium', 'high', 'xhigh'], canDisable: false },
      },
    }))
    const form = editor([{ id: '' }], { call })
    typeValue(field(form.render(), `${text().modelId} 1`), 'gpt-5.2')
    ;(field(form.render(), `${text().modelId} 1`).props['onBlur'] as () => void)()
    await settle()
    const written = form.models()[0]!['reasoningEfforts']
    expect(written).toEqual({ off: 'none', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' })
    expect(() => REASONING_SCHEMA(written as Parameters<typeof REASONING_SCHEMA>[0])).not.toThrow()
  })

  it('drops unknown effort spellings, prefers off:none over off:null, and skips off-only maps', () => {
    // toggle + none 并存时 off:'none' 优先;非法键(spicy)丢弃。
    expect(reasoningEffortsFromCatalog('openai', { efforts: ['none', 'spicy', 'low'], canDisable: true }))
      .toEqual({ off: 'none', low: 'low' })
    // toggle 无 none → off:null。
    expect(reasoningEffortsFromCatalog('openai', { efforts: ['low'], canDisable: true }))
      .toEqual({ off: null, low: 'low' })
    // 只剩 off(none)没有非 off 档位 → 整个字段不写(宿主拒绝 all-off)。
    expect(reasoningEffortsFromCatalog('openai', { efforts: ['none'], canDisable: true })).toBeUndefined()
  })

  it('chunks large adoptions into sequential 200-id batches and merges the answers', async () => {
    const ids = Array.from({ length: 450 }, (_, index) => `m-${index}`)
    const discover = vi.fn(async () => ({ ok: true, value: ids.map((id) => ({ id })) }))
    const calls: string[][] = []
    const call = vi.fn(async (_channel: unknown, _endpoint: unknown, payload: unknown) => {
      const batchIds = (payload as { ids: string[] }).ids
      calls.push(batchIds)
      return catalogOk(Object.fromEntries(batchIds.map((id) => [id, { contextWindow: 1 }])))
    })
    const form = editor([], { call, discover })
    pressButton(form.render(), text().fetchModels)
    await settle()
    pressButton(form.render(), text().candidateAdopt)
    await settle()
    expect(calls.map((batch) => batch.length)).toEqual([200, 200, 50])
    expect(form.models()).toHaveLength(450)
    expect(form.models().every((model) => model['contextWindow'] === 1)).toBe(true)
  })

  it('keeps results from the batches that answer when one batch fails', async () => {
    const ids = Array.from({ length: 450 }, (_, index) => `m-${index}`)
    const discover = vi.fn(async () => ({ ok: true, value: ids.map((id) => ({ id })) }))
    let batch = 0
    const call = vi.fn(async (_channel: unknown, _endpoint: unknown, payload: unknown) => {
      batch += 1
      if (batch === 2) return { ok: false, error: { code: 'network', message: 'boom', details: {} } }
      return catalogOk(Object.fromEntries((payload as { ids: string[] }).ids.map((id) => [id, { contextWindow: 1 }])))
    })
    const form = editor([], { call, discover })
    pressButton(form.render(), text().fetchModels)
    await settle()
    pressButton(form.render(), text().candidateAdopt)
    await settle()
    // 第二批失败后不再打第三批,避免连续叠网络超时。
    expect(call).toHaveBeenCalledTimes(2)
    const models = form.models()
    expect(models.slice(0, 200).every((model) => model['contextWindow'] === 1)).toBe(true)
    expect(models.slice(200).every((model) => model['contextWindow'] === undefined)).toBe(true)
  })

  it('reports catalog busy to the card while a lookup is in flight', async () => {
    let release!: (value: unknown) => void
    const call = vi.fn(() => new Promise((resolve) => { release = resolve }))
    const busy = vi.fn()
    const form = editor([{ id: 'm' }], { call, onBusyChange: busy })
    click(form.render(), `${text().modelAdvanced} 1`)
    pressButton(form.render(), text().autofill)
    await settle()
    expect(busy).toHaveBeenLastCalledWith(true)
    release(catalogOk({ m: { contextWindow: 1 } }))
    await settle()
    expect(busy).toHaveBeenLastCalledWith(false)
  })

  it('keeps save gated until every overlapping lookup settles', async () => {
    const releases: Array<(value: unknown) => void> = []
    const call = vi.fn(() => new Promise((resolve) => { releases.push(resolve) }))
    const busy = vi.fn()
    const form = editor([{ id: 'a' }, { id: 'b' }], { call, onBusyChange: busy })
    typeValue(field(form.render(), `${text().modelId} 1`), 'a')
    ;(field(form.render(), `${text().modelId} 1`).props['onBlur'] as () => void)()
    await settle()
    typeValue(field(form.render(), `${text().modelId} 2`), 'b')
    ;(field(form.render(), `${text().modelId} 2`).props['onBlur'] as () => void)()
    await settle()
    expect(call).toHaveBeenCalledTimes(2)
    expect(busy).toHaveBeenLastCalledWith(true)
    releases[0]!(catalogOk({ a: { contextWindow: 1 } }))
    await settle()
    expect(busy).toHaveBeenLastCalledWith(true)
    releases[1]!(catalogOk({ b: { contextWindow: 2 } }))
    await settle()
    expect(busy).toHaveBeenLastCalledWith(false)
  })

  it('clears auto-written fields when the id changes, keeps author edits, and refills for the new id', async () => {
    const discover = vi.fn(async () => ({
      ok: true,
      value: [{ id: 'model-a', contextWindow: 100, inputModalities: ['text'] }],
    }))
    const call = vi.fn(async () => catalogOk({
      'model-a': { maxTokens: 50 },
      'model-b': { contextWindow: 77, maxTokens: 88 },
    }))
    const form = editor([], { call, discover })
    pressButton(form.render(), text().fetchModels)
    await settle()
    pressButton(form.render(), text().candidateAdopt)
    await settle()
    // 采纳自带字段 + models.dev 补齐:自动写入的来源都记录在这行。
    expect(form.models()).toEqual([{ id: 'model-a', contextWindow: 100, input: ['text'], maxTokens: 50 }])

    // 作者手动改过 contextWindow——来源记录的值已被覆盖,改 ID 时保留。
    click(form.render(), `${text().modelAdvanced} 1`)
    typeValue(field(form.render(), `${text().modelContext} 1`), '42')

    typeValue(field(form.render(), `${text().modelId} 1`), 'model-b')
    // 键入过程中仍保留自动写入值;失焦且 id 确实变了才清。
    expect(form.models()).toEqual([{ id: 'model-b', contextWindow: 42, input: ['text'], maxTokens: 50 }])

    ;(field(form.render(), `${text().modelId} 1`).props['onBlur'] as () => void)()
    await settle()
    // 新 id 的补全照跑:空位补齐,手改的 contextWindow 仍不被覆盖。
    expect(form.models()).toEqual([{ id: 'model-b', contextWindow: 42, maxTokens: 88 }])
  })

  it('keeps autofilled params when the id is typed away and back before blur', async () => {
    const discover = vi.fn(async () => ({
      ok: true,
      value: [{ id: 'vision-m', contextWindow: 100, inputModalities: ['text', 'image'] }],
    }))
    const call = vi.fn(async () => catalogOk({
      'vision-m': { maxTokens: 50 },
    }))
    const form = editor([], { call, discover })
    pressButton(form.render(), text().fetchModels)
    await settle()
    pressButton(form.render(), text().candidateAdopt)
    await settle()
    expect(form.models()).toEqual([{ id: 'vision-m', contextWindow: 100, input: ['text', 'image'], maxTokens: 50 }])
    expect(call).toHaveBeenCalledTimes(1)

    typeValue(field(form.render(), `${text().modelId} 1`), 'vision-mx')
    expect(form.models()).toEqual([{ id: 'vision-mx', contextWindow: 100, input: ['text', 'image'], maxTokens: 50 }])
    typeValue(field(form.render(), `${text().modelId} 1`), 'vision-m')
    ;(field(form.render(), `${text().modelId} 1`).props['onBlur'] as () => void)()
    await settle()
    expect(call).toHaveBeenCalledTimes(1)
    expect(form.models()).toEqual([{ id: 'vision-m', contextWindow: 100, input: ['text', 'image'], maxTokens: 50 }])
  })
})

describe('input types', () => {
  function kind(tree: ReactNode, label: string) {
    return nodes(tree, node => node.type === Checkbox && node.props['label'] === label)[0]!
  }

  it('defaults to a text-only display and only writes after a checkbox click', () => {
    const form = editor([{ id: 'm' }])
    click(form.render(), `${text().modelAdvanced} 1`)
    const tree = form.render()
    expect(kind(tree, text().modelInputText).props['checked']).toBe(true)
    expect(kind(tree, text().modelInputImage).props['checked']).toBe(false)
    ;(kind(tree, text().modelInputImage).props['onCheckedChange'] as () => void)()
    expect(form.models()).toEqual([{ id: 'm', input: ['text', 'image'] }])
  })

  it('keeps at least one input type checked', () => {
    const form = editor([{ id: 'm', input: ['text'] }])
    click(form.render(), `${text().modelAdvanced} 1`)
    expect(kind(form.render(), text().modelInputText).props['disabled']).toBe(true)
    const tree = form.render()
    ;(kind(tree, text().modelInputText).props['onCheckedChange'] as () => void)()
    expect(form.models()).toEqual([{ id: 'm', input: ['text'] }])
  })

  it('writes inputModalities for deepseek providers and stays hidden for other families', () => {
    const deepseek = editor([{ id: 'm' }], { family: 'deepseek' })
    click(deepseek.render(), `${text().modelAdvanced} 1`)
    ;(kind(deepseek.render(), text().modelInputImage).props['onCheckedChange'] as () => void)()
    expect(deepseek.models()).toEqual([{ id: 'm', inputModalities: ['text', 'image'] }])
    const other = editor([{ id: 'm' }], { family: 'other' })
    click(other.render(), `${text().modelAdvanced} 1`)
    expect(nodes(other.render(), node => node.type === Checkbox && node.props['label'] === text().modelInputImage)).toHaveLength(0)
  })
})

describe('built-in catalog providers', () => {
  it('shows the follow-catalog placeholders and never asks models.dev', async () => {
    const call = vi.fn(async () => catalogOk({ m: FLASH }))
    const form = editor([{ id: 'm' }], { call, catalogBacked: true })
    click(form.render(), `${text().modelAdvanced} 1`)
    const tree = form.render()
    expect(field(tree, `${text().modelContext} 1`).props['placeholder']).toBe(text().followCatalog)
    expect(field(tree, `${text().modelMax} 1`).props['placeholder']).toBe(text().followCatalog)
    const select = nodes(tree, node => node.type === Select)[0]!
    expect(select.props['value']).toBe('catalog')
    expect((select.props['options'] as { value: string; label: string }[])[0]!.label).toBe(text().followCatalog)
    ;(field(tree, `${text().modelId} 1`).props['onBlur'] as () => void)()
    await settle()
    expect(nodes(form.render(), node => node.props['children'] === text().autofill)).toHaveLength(0)
    expect(call).not.toHaveBeenCalled()
  })

  it('asks the installed catalog once for inherited input types on first expand', async () => {
    const discover = vi.fn(async () => ({
      ok: true,
      value: [{ id: 'vision-m', inputModalities: ['text', 'image'] }],
    }))
    const form = editor([{ id: 'vision-m' }], { catalogBacked: true, discover })
    click(form.render(), `${text().modelAdvanced} 1`)
    await settle()
    // pi-ai 内置目录应答,不走 models.dev;同一编辑器实例只调一次。
    expect(discover).toHaveBeenCalledTimes(1)
    expect(discover).toHaveBeenCalledWith('llm-pi-ai', { provider: 'custom' })
    const kind = (tree: ReactNode, label: string) =>
      nodes(tree, node => node.type === Checkbox && node.props['label'] === label)[0]!
    // 继承的输入类型显示了图片勾选;再次展开不再查询。
    expect(kind(form.render(), text().modelInputImage).props['checked']).toBe(true)
    click(form.render(), `${text().modelAdvanced} 1`)
    click(form.render(), `${text().modelAdvanced} 1`)
    await settle()
    expect(discover).toHaveBeenCalledTimes(1)
    // 取消继承来的图片即真正写入 ['text'](至少一项的规则照旧)。
    ;(kind(form.render(), text().modelInputImage).props['onCheckedChange'] as () => void)()
    expect(form.models()).toEqual([{ id: 'vision-m', input: ['text'] }])
  })
})

describe('reasoning select labels', () => {
  it('lists the custom effort keys in the read-only option label', () => {
    const form = editor([{ id: 'm', reasoningEfforts: { off: null, low: 'low', high: 'high' } }])
    click(form.render(), `${text().modelAdvanced} 1`)
    const select = nodes(form.render(), node => node.type === Select)[0]!
    const options = select.props['options'] as { value: string; label: string }[]
    const custom = options.find(option => option.value === 'custom')!
    expect(custom.label).toBe('自定义（low、high）')
  })
})
