import { isValidElement, useState, type ReactElement, type ReactNode, type SetStateAction } from 'react'
import { Button, Card, Checkbox, Input, Text } from '../ui/index.ts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelListEditor, type ModelFamily } from './settings-models-catalog.tsx'
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
