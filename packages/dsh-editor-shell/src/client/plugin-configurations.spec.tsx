import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLocale, resetLocaleForTests, setLocale } from '../i18n/index.ts'
import { PluginConfigurationPage, projectPluginConfigurations, usePluginConfigurations } from './plugin-configurations.tsx'

type Entry = { options: { id?: string; key?: string; order?: number; label?: string | (() => string) } }
type SlotRender = (slot: string, owner?: object, opts?: { only?: string; entryKey?: string }) => ReactNode

function fixture(rows: Record<string, Entry[]> = {}) {
  const versions: Record<string, number> = {}
  const listeners = new Map<string, Set<() => void>>()
  const slots = {
    entries: (key: string) => rows[key] ?? [],
    getVersion: (key: string) => versions[key] ?? 0,
    subscribe: (key: string, listener: () => void) => {
      const group = listeners.get(key) ?? new Set<() => void>()
      group.add(listener)
      listeners.set(key, group)
      return () => group.delete(listener)
    },
  }
  return { slots, update(key: string, entries: Entry[]) {
    rows[key] = entries
    versions[key] = (versions[key] ?? 0) + 1
    for (const listener of listeners.get(key) ?? []) listener()
  } }
}

function projection(ctx: unknown) {
  let value: ReturnType<typeof usePluginConfigurations> | undefined
  function Probe() {
    value = usePluginConfigurations(ctx)
    return null
  }
  renderToStaticMarkup(createElement(Probe))
  return value!
}

function page(props: {
  entry: ReturnType<typeof projectPluginConfigurations>[number]
  namespaces: string[]
  renderSlot: ReturnType<typeof vi.fn<SlotRender>>
  revision?: number
  locale?: 'zh' | 'en'
}) {
  const mutate = vi.fn(async () => true)
  const state = { status: 'ready' as const, value: { enabled: true }, revision: props.revision ?? 4, writable: true }
  const form = { getSnapshot: () => state, subscribe: () => () => {}, mutate }
  const describe = {
    getSnapshot: () => ({ status: 'ready' as const, view: { namespaces: props.namespaces.map((ns) => ({ ns })) } }),
    subscribe: () => () => {}, ensure: vi.fn(async () => {}), acceptView: vi.fn(),
  }
  const ctx = { configForms: { describe: () => describe, get: vi.fn(() => form) } }
  const onClose = vi.fn()
  const html = renderToStaticMarkup(createElement(PluginConfigurationPage, {
    ctx: ctx as never, renderSlot: props.renderSlot, entry: props.entry, version: 1,
    locale: props.locale ?? 'zh', onClose,
  }))
  return { html, ctx, form, mutate, onClose }
}

afterEach(resetLocaleForTests)

describe('official plugin configuration adapter', () => {
  it('projects item IDs and keyed bundle/row entries, preserving their distinct namespaces', () => {
    const host = fixture({
      'plugins.item': [{ options: { id: 'official-model', label: () => '模型配置', order: 2 } }],
      'plugins.bundle.config': [{ options: { key: '@scope/bundle', label: 'Bundle', order: 3 } }],
      'plugins.row.config': [{ options: { key: '@scope/bundle#row-7', label: 'Row', order: 1 } }],
    })
    expect(projectPluginConfigurations(host.slots)).toEqual([
      { id: 'plugins.row.config:@scope/bundle#row-7', label: 'Row', slot: 'plugins.row.config', entryKey: '@scope/bundle#row-7', namespace: 'row-7' },
      { id: 'plugins.item:official-model', label: '模型配置', slot: 'plugins.item', namespace: 'official-model' },
      { id: 'plugins.bundle.config:@scope/bundle', label: 'Bundle', slot: 'plugins.bundle.config', entryKey: '@scope/bundle' },
    ])
    const before = projection(host)
    host.update('plugins.item', [{ options: { id: 'new', label: () => '新增' } }])
    const after = projection(host)
    expect(after.version).not.toBe(before.version)
    expect(after.entries.map((entry) => entry.label)).toContain('新增')
  })

  it('re-evaluates localized labels without a new registration and isolates a bad label', () => {
    const host = fixture({ 'plugins.item': [
      { options: { id: 'localized', label: () => setLocaleValue() } },
      { options: { id: 'broken', label: () => { throw new Error('broken translation') } } },
    ] })
    const setLocaleValue = () => getLocale() === 'zh' ? '本地化' : 'Localized'
    const before = projection(host)
    setLocale('en')
    const after = projection(host)
    expect(after.version).not.toBe(before.version)
    expect(before.entries.map((entry) => entry.label)).toEqual(['broken', '本地化'])
    expect(after.entries.map((entry) => entry.label)).toEqual(['broken', 'Localized'])
  })

  it('passes the Host-owned item form and its expected revision through to the contribution', async () => {
    const renderSlot = vi.fn<SlotRender>(() => createElement('p', null, 'configuration form'))
    const entry = { id: 'plugins.item:item-a', label: 'Item A', slot: 'plugins.item', namespace: 'item-a' }
    const result = page({ entry, namespaces: ['item-a'], renderSlot, revision: 19, locale: 'en' })
    expect(result.html).toContain('Item A')
    expect(result.html).toContain('data-dsh-plugin-surface')
    expect(result.ctx.configForms.get).toHaveBeenCalledExactlyOnceWith('item-a')
    const [slot, owner, opts] = renderSlot.mock.calls[0]!
    const pluginOwner = owner as { form: { state: { revision: number }; mutate(ops: unknown, revision: number): Promise<unknown> } }
    expect(slot).toBe('plugins.item')
    expect(opts).toEqual({ only: 'item-a' })
    expect(owner).toMatchObject({ view: 'page', locale: 'en', close: result.onClose,
      form: { state: { value: { enabled: true }, revision: 19 } } })
    const ops = [{ op: 'set', path: ['enabled'], value: false }]
    await pluginOwner.form.mutate(ops, pluginOwner.form.state.revision)
    expect(result.mutate).toHaveBeenCalledExactlyOnceWith(ops, 19)
  })

  it('uses the row ID for a known Host form, and never guesses a bundle namespace', () => {
    const renderSlot = vi.fn<SlotRender>(() => null)
    const row = { id: 'plugins.row.config:bundle#feature', label: 'Feature', slot: 'plugins.row.config', entryKey: 'bundle#feature', namespace: 'feature' }
    const rowPage = page({ entry: row, namespaces: ['feature'], renderSlot })
    expect(rowPage.ctx.configForms.get).toHaveBeenCalledWith('feature')
    expect(renderSlot.mock.calls[0]?.[2]).toEqual({ entryKey: 'bundle#feature' })
    renderSlot.mockClear()
    const bundle = { id: 'plugins.bundle.config:bundle', label: 'Bundle', slot: 'plugins.bundle.config', entryKey: 'bundle' }
    const bundlePage = page({ entry: bundle, namespaces: ['bundle'], renderSlot })
    expect(bundlePage.ctx.configForms.get).not.toHaveBeenCalled()
    expect(renderSlot.mock.calls[0]?.[1]).not.toHaveProperty('form')
    expect(renderSlot.mock.calls[0]?.[2]).toEqual({ entryKey: 'bundle' })
  })

  it('keeps rendering a contribution without form when Host has no matching namespace', () => {
    const renderSlot = vi.fn<SlotRender>(() => createElement('p', null, 'plugin-owned recovery'))
    const result = page({
      entry: { id: 'plugins.item:late', label: 'Late', slot: 'plugins.item', namespace: 'late' },
      namespaces: [], renderSlot,
    })
    expect(result.ctx.configForms.get).not.toHaveBeenCalled()
    expect(renderSlot.mock.calls[0]?.[1]).not.toHaveProperty('form')
    expect(result.html).toContain('plugin-owned recovery')
  })
})
