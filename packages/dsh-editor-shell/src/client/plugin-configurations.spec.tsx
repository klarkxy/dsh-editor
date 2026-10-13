import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLocale, resetLocaleForTests, setLocale } from '../i18n/index.ts'
import { ZHIHU_SETTINGS_SLOT } from '../root-registration.ts'
import { PLUGINS_SETTINGS_SLOT } from '../root-registration.ts'
import { PluginConfigurationPage, usePluginConfigurations } from './plugin-configurations.tsx'
import { legacyZhihuVisible, projectPluginConfigurations } from '../model/plugin-configurations.ts'
import { SettingsPage } from '../app/settings/settings-page.tsx'
import { mergeSections, secondaryConfigKeys } from '../model/plugins-page.ts'
import { CatalogRow, PluginsCatalog } from './plugins-catalog.tsx'
import {
  catalogBadgeLabel,
  advancedCatalogCard,
  catalogIconSource,
  catalogSectionsOf,
  catalogToggleRequest,
  filterCatalogSections,
  mergeConfigurationCards,
  newUserCardKeys,
  presetEnabledRequest,
  userSectionKeys,
  type PluginCatalogSection,
} from '../model/plugins-catalog.ts'

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
 const host=fixture({'plugins.bundle.config':[{options:{key:'@scope/configurable'}},{options:{key:'@scope/other'}}]})
 expect(projectPluginConfigurations(host.slots).map(entry=>entry.entryKey)).toEqual(['@scope/configurable', '@scope/other'])
})

const UNAVAILABLE_SNAPSHOT = { status: 'unavailable' } as const
const unavailableWritingScope = {
  subscribe: () => () => {},
  getSnapshot: () => UNAVAILABLE_SNAPSHOT,
}

function navigation(rows: Record<string, Entry[]>, zhihu?: ReactNode, section = 'plugins-installed') {
  const host = fixture(rows)
  const write = console.error
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('useLayoutEffect')) return
    write(...args)
  }
  try {
    return renderToStaticMarkup(createElement(SettingsPage, {
      ctx: host as never,
      writingScope: unavailableWritingScope as never,
      migrateWriting: async () => ({ failed: [] }),
      renderSlot: slot => createElement('div', null, slot === PLUGINS_SETTINGS_SLOT ? 'installed-management' : 'official-slot'),
      plugins: createElement('p', null, 'installed-management'),
      zhihu,
      hasWorkspace: true,
      section,
      onSelectSection() {},
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
    /* The routable official configuration is a nav link; the legacy page is gone. */
    expect(html).toContain('知乎')
    expect(html).toContain('installed-management')
    expect(html).toContain('official-slot')
    expect(html).not.toContain('插件模型')
    expect(html).toContain('已安装')
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
    const configurablePlugin = fixture({
      [ZHIHU_SETTINGS_SLOT]: [{ options: { id: 'zhihu' }, registrant: 'dsh-zhihu-client' }],
      'plugins.bundle.config': [{ options: { key: '@scope/configurable' }, registrant: 'dsh-zhihu-client' }],
    })
    expect(projectPluginConfigurations(configurablePlugin.slots)).toHaveLength(1)
    expect(legacyZhihuVisible(configurablePlugin.slots)).toBe(false)
  })

  it('keeps a real legacy Zhihu contribution the official catalogue does not replace', () => {
    const rows: Record<string, Entry[]> = {
      [ZHIHU_SETTINGS_SLOT]: [{ options: { id: 'zhihu' }, registrant: 'legacy-zhihu' }],
      'plugins.bundle.config': [{ options: { key: '@klarkxy/dsh-memory' }, registrant: 'dsh-memory-client' }],
    }
    expect(legacyZhihuVisible(fixture(rows).slots)).toBe(true)
    const html = navigation(rows, createElement('p', null, 'legacy-zhihu-body'))
    expect(html).toContain('知乎资料')
    /* The package name may appear as a configuration link, never as page content. */
    const content = html.slice(html.indexOf('data-testid="settings-content"'))
    expect(content).not.toContain('@klarkxy/dsh-memory')
    expect(content).not.toContain('>记忆<')
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

const SECTION_IDS = ['official', 'builtin', 'user'] as const

const CATALOG_SECTIONS: PluginCatalogSection[] = [
  { id: 'official', items: [
    { key: 'bundle:@deepseek-ai/dsh-web-search', title: '网络搜索', description: '写作时检索公开资料', packageName: '@deepseek-ai/dsh-web-search', badges: ['experimental'], enabled: true, action: 'switch' },
    { key: 'bundle:@klarkxy/dsh-terminal', title: '终端', description: '在应用内运行命令', packageName: '@klarkxy/dsh-terminal', badges: ['preinstalled'], action: 'detail' },
  ] },
  { id: 'builtin', items: [
    { key: 'bundle:dsh-editor-proofread', title: '文稿校对', description: '检查错别字与标点', badges: ['builtin', 'session-managed'], action: 'config' },
  ] },
  { id: 'user', items: [] },
]

function catalog(props: Partial<Parameters<typeof PluginsCatalog>[0]> = {}) {
  return renderToStaticMarkup(createElement(PluginsCatalog, {
    status: 'ready',
    sections: CATALOG_SECTIONS,
    query: '',
    pending: '',
    actionError: '',
    onToggle() {}, onTogglePreset() {}, onConfigure() {}, onDetail() {},
    ...props,
  }))
}

function sectionHtml(html: string, id: typeof SECTION_IDS[number]): string {
  const start = html.indexOf(`data-testid="plugins-catalog-${id}"`)
  if (start < 0) return ''
  const ends = SECTION_IDS.filter((other) => other !== id)
    .map((other) => html.indexOf(`data-testid="plugins-catalog-${other}"`, start + 1))
    .filter((at) => at > start)
  return html.slice(start, ends.length ? Math.min(...ends) : html.length)
}

function countIn(html: string, id: typeof SECTION_IDS[number]): string | undefined {
  return sectionHtml(html, id).match(/plugins-catalog-count[^>]*>([^<]*)</)?.[1]
}

describe('plugin catalog', () => {
  it('folds runtime and developer components while keeping author controls and search results reachable', () => {
    const completion = { key: 'entry:manuscript-assist', entryId: 'manuscript-assist', title: '补全服务', description: '行内补全',
      packageName: 'dsh-manuscript', badges: [], enabled: true, action: 'switch' as const }
    const runtime = { key: 'entry:runtime', title: '运行时', description: 'Internal runtime', badges: ['required'], action: 'detail' as const }
    expect(advancedCatalogCard(completion)).toBe(false)
    expect(advancedCatalogCard(runtime)).toBe(true)
    const html = catalog({ sections: [{ id: 'builtin', items: [completion, runtime] }] })
    const advancedAt = html.indexOf('<details class="plugins-catalog-advanced"')
    expect(advancedAt).toBeGreaterThan(-1)
    expect(html.indexOf('plugins-catalog-toggle-entry:manuscript-assist')).toBeLessThan(advancedAt)
    expect(html.indexOf('plugins-catalog-detail-entry:runtime')).toBeGreaterThan(advancedAt)
    expect(html).not.toContain('<details class="plugins-catalog-advanced" open=""')
    expect(catalog({ sections: [{ id: 'builtin', items: [runtime] }], query: 'runtime' }))
      .toContain('<details class="plugins-catalog-advanced" open=""')
  })
  it('renders the three sections in the fixed order with their real counts', () => {
    const html = catalog()
    expect(html.indexOf('DSH 官方插件')).toBeGreaterThan(-1)
    expect(html.indexOf('DSH 官方插件')).toBeLessThan(html.indexOf('DSH-Editor 内置插件'))
    expect(html.indexOf('DSH-Editor 内置插件')).toBeLessThan(html.indexOf('用户插件'))
    expect(countIn(html, 'official')).toBe('2')
    expect(countIn(html, 'builtin')).toBe('1')
    expect(countIn(html, 'user')).toBe('0')
  })

  it('renders every badge as text and exactly one primary control per row', () => {
    const html = catalog()
    expect(html).toContain('实验性')
    expect(html).toContain('预装')
    expect(html).toContain('内置')
    expect(html).toContain('由会话控制')
    expect(html).toContain('data-testid="plugins-catalog-toggle-bundle:@deepseek-ai/dsh-web-search"')
    expect(html).toContain('data-testid="plugins-catalog-config-bundle:dsh-editor-proofread"')
    expect(html).toContain('data-testid="plugins-catalog-detail-bundle:@klarkxy/dsh-terminal"')
    const rows = html.match(/data-testid="plugins-catalog-row-[^"]+"/g) ?? []
    expect(rows).toHaveLength(3)
    for (const row of sectionHtml(html, 'official').match(/data-testid="plugins-catalog-row-[^"]+"[\s\S]*?(?=data-testid="plugins-catalog-row-|$)/g) ?? []) {
      expect(row.match(/plugins-catalog-(?:toggle|config|detail)-/g)).toHaveLength(1)
    }
  })

  it('adds a secondary 配置 beside the switch only for a reachable configuration page', () => {
    const html = catalog({ configKeys: ['bundle:@deepseek-ai/dsh-web-search'] })
    const official = sectionHtml(html, 'official')
    expect(official).toContain('data-testid="plugins-catalog-toggle-bundle:@deepseek-ai/dsh-web-search"')
    expect(official).toContain('data-testid="plugins-catalog-config-bundle:@deepseek-ai/dsh-web-search"')
    expect(official).toContain('plugins-catalog-action"')
    /* The switch stays the rightmost primary control; the detail row is untouched. */
    const row = official.slice(0, official.indexOf('data-testid="plugins-catalog-row-bundle:@klarkxy/dsh-terminal"'))
    expect(row.lastIndexOf('plugins-catalog-config-')).toBeLessThan(row.lastIndexOf('plugins-catalog-toggle-'))
    expect(official).not.toContain('plugins-catalog-config-bundle:@klarkxy/dsh-terminal')
    /* No reachable configuration page means no config affordance at all. */
    expect(catalog()).not.toContain('plugins-catalog-config-bundle:@deepseek-ai/dsh-web-search')
  })

  it('keeps the one-line description with its full text in the row tooltip', () => {
    const html = catalog()
    expect(html).toContain('写作时检索公开资料')
    expect(sectionHtml(html, 'official')).toContain('title="写作时检索公开资料"')
  })

  it('invites the author to discover plugins when the user section is empty', () => {
    expect(sectionHtml(catalog(), 'user')).toContain('还没有安装用户插件。在「发现插件」里找找看。')
  })

  it('filters every section by title, description and package name', () => {
    const byTitle = catalog({ query: '文稿' })
    expect(sectionHtml(byTitle, 'builtin')).toContain('文稿校对')
    expect(sectionHtml(byTitle, 'official')).not.toContain('网络搜索')
    const byPackage = catalog({ query: 'TERMINAL' })
    expect(sectionHtml(byPackage, 'official')).toContain('终端')
    expect(sectionHtml(byPackage, 'builtin')).toContain('没有匹配的插件。')
    expect(sectionHtml(catalog({ query: '命令' }), 'official')).toContain('终端')
  })

  it('reports loading and error instead of claiming an empty catalog', () => {
    expect(catalog({ status: 'loading', sections: [] })).toContain('正在读取插件目录…')
    const failed = catalog({ status: 'error', sections: [], error: 'internal boom', onRetry() {} })
    expect(failed).toContain('data-testid="plugins-catalog-error"')
    expect(failed).toContain('internal boom')
    expect(failed).not.toContain('用户插件')
  })

  it('renders writing presets as a built-in sub-group and locks the required ones', () => {
    const html = catalog({ presets: [
      { id: 'dsh-editor-writing', title: '通用写作', description: '默认写作', enabled: true, locked: true },
      { id: 'dsh-editor-novel', title: '小说工具', description: '长篇创作助手', enabled: false, locked: false },
    ], restartRequired: true })
    const builtin = sectionHtml(html, 'builtin')
    expect(countIn(html, 'builtin')).toBe('3')
    expect(builtin).toContain('写作模式')
    expect(builtin).toContain('data-testid="plugins-catalog-preset-dsh-editor-writing"')
    expect(builtin).toContain('data-testid="plugins-catalog-preset-toggle-dsh-editor-novel"')
    expect(builtin).toContain('仅影响新对话，进行中的对话不变。')
    expect(html).toContain('重启 DSH 后生效。')
    const locked = builtin.slice(builtin.indexOf('data-testid="plugins-catalog-preset-dsh-editor-writing"'))
    expect(locked.slice(0, locked.indexOf('data-testid="plugins-catalog-preset-dsh-editor-novel"'))).toContain('必需')
    expect(sectionHtml(catalog(), 'official')).not.toContain('写作模式')
  })

  it('renders the author brand icon and falls back to the monogram when it is absent or fails', () => {
    const icon = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='
    const withIcon = catalogSectionsOf({ sections: [{ id: 'user', items: [
      { key: 'bundle:@klarkxy/dsh-zhihu', title: '知乎', description: '', icon, badges: ['installed'], action: 'switch' },
      { key: 'bundle:@scope/plain', title: '甲插件', description: '', badges: [], action: 'detail' },
    ] }] })
    expect(withIcon[2]!.items[0]!.icon).toBe(icon)
    expect('icon' in withIcon[2]!.items[1]!).toBe(false)
    const html = sectionHtml(catalog({ sections: withIcon }), 'user')
    expect(html).toContain(`<img class="plugins-catalog-icon-image" src="${icon}" alt=""/>`)
    /* The unified kind icon is the fallback for a card with no icon: never a blank tile. */
    expect(html).toContain('<span class="plugins-catalog-icon" aria-hidden="true"><svg')
    expect(catalogIconSource({ icon, title: '知乎' })).toBe(icon)
    expect(catalogIconSource({ title: '知乎' })).toBe('')
    expect(catalogIconSource({ icon, title: '知乎' }, icon)).toBe('')
    /* Only an inline image data URI is accepted: a remote URL or a script URI
       would either leak the author's browsing or turn the row into script. */
    expect(catalogSectionsOf({ sections: [{ id: 'user', items: [
      { key: 'bundle:remote', title: 'A', icon: 'https://example.test/a.svg' },
      { key: 'bundle:script', title: 'B', icon: 'javascript:alert(1)' },
      { key: 'bundle:ok', title: 'C', icon: 'data:image/svg+xml;utf8,<svg/>' },
    ] }] })[2]!.items.map((card) => card.icon)).toEqual([undefined, undefined, 'data:image/svg+xml;utf8,<svg/>'])
  })

  it('labels an installed bundle and keeps the ghost treatment on every non-switch control', () => {
    expect(catalogBadgeLabel('installed')).toBe('已安装')
    setLocale('en')
    expect(catalogBadgeLabel('installed')).toBe('Installed')
    setLocale('zh')
    const html = catalog({ configKeys: ['bundle:@deepseek-ai/dsh-web-search'] })
    /* 配置 beside a switch and a lone 详情 are one control, so they read alike:
       the switch stays the row's only filled control. */
    const official = sectionHtml(html, 'official')
    expect(official.match(/plugins-catalog-action"/g)).toHaveLength(2)
    expect(official).not.toContain('plugins-catalog-config"')
    expect(official).toMatch(/data-testid="plugins-catalog-config-[^"]+"[^>]*class="[^"]*plugins-catalog-action"/)
    expect(official).toMatch(/data-testid="plugins-catalog-detail-[^"]+"[^>]*class="[^"]*plugins-catalog-action"/)
  })

  it('anchors the user section and highlights only the rows a refresh added', () => {
    const before: PluginCatalogSection[] = [{ id: 'user', items: [
      { key: 'bundle:a', title: 'A', description: '', badges: [], action: 'detail' },
    ] }, ...CATALOG_SECTIONS.slice(0, 2)]
    const after: PluginCatalogSection[] = [{ id: 'user', items: [
      { key: 'bundle:a', title: 'A', description: '', badges: [], action: 'detail' },
      { key: 'bundle:b', title: 'B', description: '', badges: [], action: 'detail' },
    ] }, ...CATALOG_SECTIONS.slice(0, 2)]
    expect(userSectionKeys(after)).toEqual(['bundle:a', 'bundle:b'])
    /* The baseline is the previous set, so an install is exactly the growth. */
    expect(newUserCardKeys(userSectionKeys(before), userSectionKeys(after))).toEqual(['bundle:b'])
    expect(newUserCardKeys(userSectionKeys(after), userSectionKeys(after))).toEqual([])
    expect(newUserCardKeys(userSectionKeys(after), userSectionKeys(before))).toEqual([])
    const row = (highlighted: boolean) => renderToStaticMarkup(createElement(CatalogRow, {
      card: { key: 'bundle:b', title: 'B', description: '', badges: [], action: 'detail' },
      kind: 'user',
      pending: false, configurable: false, highlighted,
      onToggle() {}, onConfigure() {}, onDetail() {},
    }))
    expect(row(true)).toContain('class="plugins-catalog-row is-new"')
    expect(row(false)).toContain('class="plugins-catalog-row"')
  })

  it('normalizes an unknown payload into the three fixed sections', () => {
    const sections = catalogSectionsOf({ sections: [
      { id: 'user', items: [{ key: 'bundle:a', title: 'A', description: '', badges: ['locked'], action: 'nonsense' }] },
      { id: 'unknown', items: [{ key: 'bundle:dropped' }] },
      { id: 'official', items: [{ title: 'no key' }, 'nope'] },
    ] })
    expect(sections.map((section) => section.id)).toEqual(['official', 'builtin', 'user'])
    expect(sections[0]!.items).toEqual([])
    expect(sections[2]!.items).toEqual([{ key: 'bundle:a', title: 'A', description: '', badges: ['locked'], action: 'detail' }])
    expect(catalogSectionsOf(undefined).map((section) => section.items)).toEqual([[], [], []])
  })

  it('appends one configuration card per plugins.item entry to the official section', () => {
    const merged = mergeConfigurationCards(catalogSectionsOf({ sections: [{ id: 'official', items: [
      { key: 'bundle:@deepseek-ai/dsh-web-search', title: '网络搜索', description: '', badges: [], action: 'switch' },
    ] }] }), [
      { id: 'plugins.item:terminal', label: '终端', slot: 'plugins.item', namespace: 'terminal' },
      { id: 'plugins.bundle.config:@klarkxy/dsh-memory', label: '记忆', slot: 'plugins.bundle.config', entryKey: '@klarkxy/dsh-memory' },
      { id: 'plugins.item:terminal', label: '终端', slot: 'plugins.item', namespace: 'terminal' },
    ])
    expect(merged[0]!.items.map((card) => [card.key, card.action])).toEqual([
      ['bundle:@deepseek-ai/dsh-web-search', 'switch'],
      ['entry:plugins.item:terminal', 'config'],
    ])
    expect(merged[0]!.items[1]).toMatchObject({ title: '终端', entryId: 'terminal', badges: [] })
    expect(merged[2]!.items).toEqual([])
  })

  it('gives a configuration card the config control only when its entry is reachable', () => {
    const sections = mergeConfigurationCards(catalogSectionsOf({ sections: [{ id: 'official', items: [] }] }), [
      { id: 'plugins.item:terminal', label: '终端', slot: 'plugins.item', namespace: 'terminal' },
    ])
    const unreachable = mergeSections(sections, [], [])
    expect(unreachable[0]!.items[0]!.action).toBe('detail')
    const reachable = mergeSections(sections, [], [
      { id: 'official:plugins.item:terminal', label: '终端', entry: { id: 'plugins.item:terminal', label: '终端', slot: 'plugins.item', namespace: 'terminal' } },
    ])
    expect(reachable[0]!.items[0]!.action).toBe('config')
    expect(catalog({ sections: reachable })).toContain('data-testid="plugins-catalog-config-entry:plugins.item:terminal"')
  })

  it('marks a switch row configurable through its package name, entry id or configuration key', () => {
    const sections = mergeSections(catalogSectionsOf({ sections: [{ id: 'official', items: [
      { key: 'bundle:@klarkxy/dsh-web-search-manager', title: '网页搜索', description: '', packageName: '@klarkxy/dsh-web-search-manager', badges: [], enabled: true, action: 'switch' },
      { key: 'entry:terminal', title: '终端', description: '', entryId: 'terminal', badges: [], enabled: true, action: 'switch' },
      { key: 'bundle:@scope/plain', title: '普通插件', description: '', packageName: '@scope/plain', badges: [], enabled: true, action: 'switch' },
      { key: 'bundle:@klarkxy/dsh-terminal', title: '终端包', description: '', packageName: '@klarkxy/dsh-terminal', badges: [], action: 'detail' },
    ] }] }), [], [])
    const links = [
      { id: 'official:plugins.bundle.config:@klarkxy/dsh-web-search-manager', label: '网络搜索', entry: { id: 'plugins.bundle.config:@klarkxy/dsh-web-search-manager', label: '网络搜索', slot: 'plugins.bundle.config', entryKey: '@klarkxy/dsh-web-search-manager' } },
      { id: 'official:plugins.item:terminal', label: '终端', entry: { id: 'plugins.item:terminal', label: '终端', slot: 'plugins.item', namespace: 'terminal' } },
      { id: 'official:plugins.bundle.config:@klarkxy/dsh-terminal', label: '终端包', entry: { id: 'plugins.bundle.config:@klarkxy/dsh-terminal', label: '终端包', slot: 'plugins.bundle.config', entryKey: '@klarkxy/dsh-terminal' } },
    ]
    /* Only the two switch rows with a reachable page get the secondary control. */
    expect(secondaryConfigKeys(sections, links)).toEqual([
      'bundle:@klarkxy/dsh-web-search-manager',
      'entry:terminal',
    ])
    expect(secondaryConfigKeys(sections, [])).toEqual([])
    const html = catalog({ sections, configKeys: secondaryConfigKeys(sections, links) })
    expect(html).toContain('data-testid="plugins-catalog-config-bundle:@klarkxy/dsh-web-search-manager"')
    expect(html).toContain('data-testid="plugins-catalog-toggle-bundle:@klarkxy/dsh-web-search-manager"')
    expect(html).not.toContain('plugins-catalog-config-bundle:@scope/plain')
    /* A detail row keeps its single primary control even with a reachable page. */
    expect(html).toContain('data-testid="plugins-catalog-detail-bundle:@klarkxy/dsh-terminal"')
    expect(html).not.toContain('plugins-catalog-config-bundle:@klarkxy/dsh-terminal')
  })

  it('filters a catalog projection without touching its source', () => {
    const source = catalogSectionsOf({ sections: [{ id: 'user', items: [{ key: 'bundle:a', title: 'Alpha', description: 'first', badges: [], action: 'detail' }] }] })
    expect(filterCatalogSections(source, 'alpha')[2]!.items).toHaveLength(1)
    expect(filterCatalogSections(source, 'zzz')[2]!.items).toHaveLength(0)
    expect(source[2]!.items).toHaveLength(1)
  })

  it('issues the bundle, entry and preset requests the Host contract defines', () => {
    expect(catalogToggleRequest({ key: 'bundle:a', title: 'A', description: '', badges: [], packageName: '@scope/a', action: 'switch' }, false))
      .toEqual({ channel: '/api', endpoint: 'pluginManager/setBundleEnabled', payload: { args: { name: '@scope/a', enabled: false } } })
    expect(catalogToggleRequest({ key: 'entry:terminal', title: 'A', description: '', badges: [], entryId: 'terminal', action: 'switch' }, true))
      .toEqual({ channel: '/api', endpoint: 'pluginManager/setPluginEnabled', payload: { args: { id: 'terminal', enabled: true } } })
    /* An entry card may also name its package; the entry stays the toggle target. */
    expect(catalogToggleRequest({ key: 'entry:terminal', title: 'A', description: '', badges: [], packageName: '@scope/a', entryId: 'terminal', action: 'switch' }, true))
      .toEqual({ channel: '/api', endpoint: 'pluginManager/setPluginEnabled', payload: { args: { id: 'terminal', enabled: true } } })
    expect(catalogToggleRequest({ key: 'entry:orphan', title: 'A', description: '', badges: [], action: 'switch' }, true)).toBeNull()
    expect(presetEnabledRequest({ id: 'dsh-editor-novel', title: '小说工具', description: '', enabled: false, locked: false }, true))
      .toEqual({ channel: '/dsh-editor-plugins', endpoint: 'presets.setEnabled', payload: { id: 'dsh-editor-novel', enabled: true } })
  })
})

describe('settings plugins navigation', () => {
  it('keeps the nav and the three fixed entries with zero configuration entries', () => {
    const html = navigation({})
    expect(html).toContain('data-testid="settings-nav"')
    expect(html).toContain('data-testid="settings-nav-plugins-installed"')
    expect(html).toContain('data-testid="settings-nav-plugins-discovery"')
    expect(html).toContain('data-testid="settings-nav-plugins-manager"')
    expect(html).toContain('已安装')
    expect(html).toContain('发现')
    expect(html).toContain('安装与卸载')
    expect(html).toContain('插件配置')
    expect(html).toContain('搜索插件配置')
    expect(html).toContain('data-testid="plugins-catalog-search"')
    expect(html).toContain('placeholder="搜索插件"')
    expect(html).toContain('data-testid="plugins-page-add-plugin"')
    expect(html).toContain('添加插件')
    expect(html).toContain('暂无插件配置。')
  })

  it('keeps the discovery contribution and the official manager seat mounted', () => {
    const html = navigation({}, emptyZhihuSlot)
    expect(html).toContain('data-testid="plugins-discovery"')
    expect(html).toContain('installed-management')
    expect(html).toContain('data-testid="plugins-manager-seat"')
    expect(html).toContain('official-slot')
    expect(html).toContain('data-dsh-plugin-surface')
    const manager = html.slice(html.indexOf('data-testid="plugins-manager-seat"'))
    expect(manager).toContain('official-slot')
    expect(html).toMatch(/hidden=""[^>]*data-testid="plugins-manager-seat"/)
  })

  it('routes the plugins.item configuration entries from the nav', () => {
    const html = navigation({ 'plugins.item': [{ options: { id: 'terminal', label: () => '终端' } }] })
    expect(html).toContain('终端')
    expect(html).toContain('搜索插件配置')
  })
})
