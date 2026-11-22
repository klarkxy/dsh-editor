/* CustomProviderCard busy gating: ModelListEditor reports catalog-lookup state
   through onBusyChange; while it is true the 创建提供方 button is disabled and
   submit() early-returns, so a fast click cannot save a row whose autofill has
   not landed yet. The lookup→onBusyChange wiring itself is covered in
   settings-models-catalog.spec.tsx. Same hook-slot harness (no DOM renderer). */
import { isValidElement, useState, type ReactElement, type ReactNode, type SetStateAction } from 'react'
import { Button, Input } from '../ui/index.ts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomProviderCard } from './settings-models-provider.tsx'
import { ModelListEditor } from './settings-models-catalog.tsx'
import { text } from './settings-models-copy.ts'
import type { ShellContext } from './shared.ts'
import type { ModelsStore } from './settings-models-state.ts'

vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(), useState: vi.fn(),
}))

function card() {
  let cursor = 0
  const state: unknown[] = []
  vi.mocked(useState).mockImplementation(((initial: unknown) => {
    const slot = cursor++
    if (!(slot in state)) state[slot] = typeof initial === 'function' ? initial() : initial
    return [state[slot], (next: SetStateAction<unknown>) => {
      state[slot] = typeof next === 'function' ? next(state[slot]) : next
    }]
  }) as typeof useState)
  const mutate = vi.fn(async () => ({ ok: true, value: {} }))
  const setCredential = vi.fn(async () => ({ ok: true, value: undefined }))
  const ctx = {
    configForms: { describe: () => ({ getSnapshot: () => ({ view: { namespaces: [{ ns: 'llm-pi-ai', revision: 0 }] } }) }) },
    connection: { rpc: { call: vi.fn() } },
    remote: {
      llm: { discoverModels: vi.fn(async () => ({ ok: true, value: [] })) },
      settings: { mutate },
      credentials: { set: setCredential },
    },
  } as unknown as ShellContext
  const store = { acceptNamespaceView: vi.fn() } as unknown as ModelsStore
  const onClose = vi.fn()
  function render() {
    cursor = 0
    return CustomProviderCard({
      ctx, store, protocols: ['openai'], taken: [], readOnly: false, onClose,
    })
  }
  return { render, mutate, setCredential, onClose }
}

function nodes(tree: ReactNode, predicate: (node: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(tree)) return tree.flatMap(child => nodes(child, predicate))
  if (!isValidElement<Record<string, unknown>>(tree)) return []
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props.children as ReactNode, predicate)]
}
function input(tree: ReactNode, label: string) {
  return nodes(tree, node => node.type === Input && node.props['aria-label'] === label)[0]!
}
function type(tree: ReactNode, label: string, value: string) {
  ;(input(tree, label).props.onChange as (next: string) => void)(value)
}
function labelOf(children: ReactNode): string {
  return Array.isArray(children) ? children.filter(c => typeof c === 'string').join('') : String(children)
}
function button(tree: ReactNode, label: string) {
  return nodes(tree, node => node.type === Button && labelOf(node.props['children'] as ReactNode) === label)[0]!
}
function clickButton(tree: ReactNode, label: string) {
  ;(button(tree, label).props.onClick as () => void)()
}
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0))

beforeEach(() => vi.clearAllMocks())

describe('custom provider card busy gating', () => {
  it('disables 创建提供方 and blocks submit while a catalog lookup is in flight', async () => {
    const harness = card()
    type(harness.render(), text().customRoute, 'acme')
    type(harness.render(), text().baseUrl, 'https://acme.test/v1')
    // 一行合法模型让 ready 成立;再模拟 ModelListEditor 在 catalog 查询中上报 busy。
    const tree = harness.render()
    const list = nodes(tree, node => node.type === ModelListEditor)[0]!
    ;(list.props['onChange'] as (models: unknown[]) => void)([{ id: 'm-1' }])
    ;(nodes(harness.render(), node => node.type === ModelListEditor)[0]!
      .props['onBusyChange'] as (busy: boolean) => void)(true)

    let next = harness.render()
    expect(button(next, text().createCustom).props['disabled']).toBe(true)
    clickButton(next, text().createCustom)
    await settle()
    expect(harness.mutate).not.toHaveBeenCalled()

    ;(nodes(next, node => node.type === ModelListEditor)[0]!.props['onBusyChange'] as (busy: boolean) => void)(false)
    next = harness.render()
    expect(button(next, text().createCustom).props['disabled']).toBe(false)
    clickButton(next, text().createCustom)
    await settle()
    expect(harness.mutate).toHaveBeenCalledTimes(1)
  })
})
