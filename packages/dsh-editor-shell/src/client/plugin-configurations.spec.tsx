import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLocale, resetLocaleForTests, setLocale } from '../i18n/index.ts'
import { ZHIHU_SETTINGS_SLOT } from '../root-registration.ts'
import { legacyZhihuVisible, PluginConfigurationPage, projectPluginConfigurations, usePluginConfigurations } from './plugin-configurations.tsx'
import { PluginsPage } from './plugins-page.tsx'

type Entry = {
  options: { id?: string; key?: string; order?: number; label?: string | (() => string) }
  registrant?: string
}
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


it('names the adopted voice configuration in the active language', () => {
 const host=fixture({'plugins.bundle.config':[{options:{key:'@deepseek-ai/dsh-experimental-voice-input-bundle'}}]})
 expect(projectPluginConfigurations(host.slots)[0]?.label).toBe('语音输入')
 setLocale('en')
 expect(projectPluginConfigurations(host.slots)[0]?.label).toBe('Voice input')
})


it('keeps every keyed bundle on its native configuration route without a special exclusion', () => {
 const host=fixture({'plugins.bundle.config':[{options:{key:'@klarkxy/dsh-model-center'}},{options:{key:'@scope/other'}}]})
 expect(projectPluginConfigurations(host.slots).map(entry=>entry.entryKey)).toEqual(['@klarkxy/dsh-model-center', '@scope/other'])
})

function navigation(rows: Record<string, Entry[]>, zhihu?: ReactNode) {
  const host = fixture(rows)
  const write = console.error
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('useLayoutEffect')) return
    write(...args)
  }
  try {
    return renderToStaticMarkup(createElement(PluginsPage, {
      ctx: host as never,
      renderSlot: () => createElement('div', null, 'official-slot'),
      plugins: createElement('p', null, 'installed-management'),
      zhihu,
      hasWorkspace: true,
      onClose() {},
    }))
  } finally {
    console.error = write
  }
}

const emptyZhihuSlot = createElement('div', { 'data-slot': ZHIHU_SETTINGS_SLOT })

describe('plugin configuration navigation', () => {
  it('hides the legacy Zhihu page when the slot has no registration', () => {
    const rows: Record<string, Entry[]> = {
      'plugins.bundle.config': [{ options: { key: '@klarkxy/dsh-zhihu', label: '知乎' }, registrant: 'dsh-zhihu-client' }],
    }
    const host = fixture(rows)
    expect(legacyZhihuVisible(host.slots)).toBe(false)
    expect(projection(host).legacyZhihu).toBe(false)
    const html = navigation(rows, emptyZhihuSlot)
    expect(html).not.toContain('知乎资料')
    expect(html).not.toContain('知乎')
    expect(html).toContain('installed-management')
    expect(html).toContain('official-slot')
    expect(html).not.toContain('插件模型')
    expect(html).toContain('已安装与市场')
  })

  it('drops a legacy Zhihu registration replaced by that plugin\'s official configuration', () => {
    const rows: Record<string, Entry[]> = {
      [ZHIHU_SETTINGS_SLOT]: [{ options: { id: 'zhihu', label: '知乎资料' }, registrant: 'dsh-zhihu-client' }],
      'plugins.bundle.config': [{ options: { key: '@klarkxy/dsh-zhihu', label: '知乎' }, registrant: 'dsh-zhihu-client' }],
    }
    expect(legacyZhihuVisible(fixture(rows).slots)).toBe(false)
    const official = projectPluginConfigurations(fixture(rows).slots)[0]
    expect(official).toMatchObject({ entryKey: '@klarkxy/dsh-zhihu', label: '知乎', id: 'plugins.bundle.config:@klarkxy/dsh-zhihu' })
    expect(navigation(rows, emptyZhihuSlot)).not.toContain('知乎资料')
    const sameKey = fixture({
      [ZHIHU_SETTINGS_SLOT]: [{ options: { id: '@klarkxy/dsh-zhihu' } }],
      'plugins.bundle.config': [{ options: { key: '@klarkxy/dsh-zhihu', label: '知乎' } }],
    })
    expect(legacyZhihuVisible(sameKey.slots)).toBe(false)
  })

  it('keeps legacy Zhihu when the same registrant has no routable official configuration', () => {
    const rows: Record<string, Entry[]> = {
      [ZHIHU_SETTINGS_SLOT]: [{ options: { id: 'zhihu' }, registrant: 'dsh-zhihu-client' }],
      'plugins.bundle.config': [{ options: { label: '不可达' }, registrant: 'dsh-zhihu-client' }],
      'plugins.item': [{ options: { key: 'item-without-id' }, registrant: 'dsh-zhihu-client' }],
      'plugins.row.config': [{ options: { id: 'row-without-key' }, registrant: 'dsh-zhihu-client' }],
    }
    expect(projectPluginConfigurations(fixture(rows).slots)).toEqual([])
    expect(legacyZhihuVisible(fixture(rows).slots)).toBe(true)
    const modelCenter = fixture({
      [ZHIHU_SETTINGS_SLOT]: [{ options: { id: 'zhihu' }, registrant: 'dsh-zhihu-client' }],
      'plugins.bundle.config': [{ options: { key: '@klarkxy/dsh-model-center' }, registrant: 'dsh-zhihu-client' }],
    })
    expect(projectPluginConfigurations(modelCenter.slots)).toHaveLength(1)
    expect(legacyZhihuVisible(modelCenter.slots)).toBe(false)
  })

  it('keeps a real legacy Zhihu contribution the official catalogue does not replace', () => {
    const rows: Record<string, Entry[]> = {
      [ZHIHU_SETTINGS_SLOT]: [{ options: { id: 'zhihu' }, registrant: 'legacy-zhihu' }],
      'plugins.bundle.config': [{ options: { key: '@klarkxy/dsh-memory' }, registrant: 'dsh-memory-client' }],
    }
    expect(legacyZhihuVisible(fixture(rows).slots)).toBe(true)
    const html = navigation(rows, createElement('p', null, 'legacy-zhihu-body'))
    expect(html).toContain('知乎资料')
    expect(html).not.toContain('@klarkxy/dsh-memory')
    expect(html).not.toContain('>记忆<')
  })

  it('follows legacy registration and removal through the ledger version', () => {
    const host = fixture({})
    const absent = projection(host)
    expect(absent.legacyZhihu).toBe(false)
    host.update(ZHIHU_SETTINGS_SLOT, [{ options: { id: 'zhihu' }, registrant: 'legacy-zhihu' }])
    const registered = projection(host)
    expect(registered.legacyZhihu).toBe(true)
    expect(registered.version).not.toBe(absent.version)
    host.update('plugins.bundle.config', [{ options: { key: '@klarkxy/dsh-zhihu', label: '知乎' }, registrant: 'legacy-zhihu' }])
    const replaced = projection(host)
    expect(replaced.legacyZhihu).toBe(false)
    expect(replaced.version).not.toBe(registered.version)
    host.update('plugins.bundle.config', [])
    const restored = projection(host)
    expect(restored.legacyZhihu).toBe(true)
    host.update(ZHIHU_SETTINGS_SLOT, [])
    expect(projection(host).legacyZhihu).toBe(false)
  })

  it('keeps prototype-shaped bundle keys as their own titles', () => {
    const bare = fixture({ 'plugins.bundle.config': [
      { options: { key: '__proto__' } },
      { options: { key: 'constructor' } },
      { options: { key: 'toString' } },
    ] })
    expect(projectPluginConfigurations(bare.slots).map((entry) => [entry.entryKey, entry.label])).toEqual([
      ['__proto__', '__proto__'],
      ['constructor', 'constructor'],
      ['toString', 'toString'],
    ])
    const labeled = fixture({ 'plugins.bundle.config': [
      { options: { key: '__proto__', label: '  自带标题  ' } },
    ] })
    expect(projectPluginConfigurations(labeled.slots)[0]).toMatchObject({ entryKey: '__proto__', label: '自带标题' })
  })

  it('prefers a plugin label and otherwise names only the adopted bundles', () => {
    const host = fixture({ 'plugins.bundle.config': [
      { options: { key: '@klarkxy/dsh-memory' } },
      { options: { key: '@klarkxy/dsh-web-search-manager', label: '  自定义搜索  ' } },
      { options: { key: '@deepseek-ai/dsh-experimental-voice-input-bundle', label: () => 'Spoken' } },
      { options: { key: '@scope/unknown' } },
      { options: { key: '@scope/blank', label: '   ' } },
      { options: { key: '@klarkxy/dsh-memory-extra', label: () => { throw new Error('broken translation') } } },
    ] })
    expect(projectPluginConfigurations(host.slots).map((entry) => [entry.entryKey, entry.label])).toEqual([
      ['@deepseek-ai/dsh-experimental-voice-input-bundle', 'Spoken'],
      ['@klarkxy/dsh-memory', '@klarkxy/dsh-memory'],
      ['@klarkxy/dsh-memory-extra', '@klarkxy/dsh-memory-extra'],
      ['@klarkxy/dsh-web-search-manager', '自定义搜索'],
      ['@scope/blank', '@scope/blank'],
      ['@scope/unknown', '@scope/unknown'],
    ])
  })

  it('switches adopted bundle titles with the locale and leaves unknown keys unchanged', () => {
    const host = fixture({ 'plugins.bundle.config': [
      { options: { key: '@klarkxy/dsh-memory' } },
      { options: { key: '@klarkxy/dsh-web-search-manager' } },
      { options: { key: '@deepseek-ai/dsh-experimental-voice-input-bundle', label: () => getLocale() === 'en' ? 'Plugin voice' : '插件语音' } },
      { options: { key: '@scope/unknown' } },
    ] })
    const zh = projection(host)
    setLocale('en')
    const en = projection(host)
    setLocale('zh')
    const again = projection(host)
    expect(zh.entries.map((entry) => [entry.entryKey, entry.label])).toEqual([
      ['@deepseek-ai/dsh-experimental-voice-input-bundle', '插件语音'],
      ['@klarkxy/dsh-memory', '@klarkxy/dsh-memory'],
      ['@klarkxy/dsh-web-search-manager', '网络搜索'],
      ['@scope/unknown', '@scope/unknown'],
    ])
    expect(en.entries.map((entry) => entry.label)).toEqual(['Plugin voice', '@klarkxy/dsh-memory', 'Web search', '@scope/unknown'])
    expect(en.entries.map((entry) => entry.entryKey)).toEqual(zh.entries.map((entry) => entry.entryKey))
    expect(en.version).not.toBe(zh.version)
    expect(again.entries.map((entry) => entry.label)).toEqual(zh.entries.map((entry) => entry.label))
    expect(again.version).not.toBe(en.version)
  })
})
