import { isValidElement, useState, type ReactElement, type ReactNode, type SetStateAction } from 'react'
import { Card, Input } from '../ui/index.ts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelListEditor } from './settings-models-catalog.tsx'
import { text } from './settings-models-copy.ts'
import type { ShellContext } from './shared.ts'

vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(), useState: vi.fn(),
}))

/** Exercise editor event handlers and the resulting React reconciliation keys without a browser. */
function editor(initial: Record<string, unknown>[]) {
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
  function render() {
    cursor = 0
    return ModelListEditor({
      ctx: {} as ShellContext, models, settingsNs: 'llm-pi-ai', provider: 'custom',
      baseURL: undefined, api: undefined, apiKey: undefined,
      onChange: next => { models = next }, t: text(),
    })
  }
  return { render, models: () => models }
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
