import { describe, expect, it } from 'vitest'
import { buildPluginCatalog, readPluginCatalog } from './catalog.ts'
import { RECOMMENDED_PLUGINS } from './curation.ts'
import { isAllowedExternalUrl } from '../../../apps/desktop/src/navigation.ts'
import type { PluginCatalog, PluginCatalogCard } from './contracts.ts'
import type { RuntimeCatalog } from './core.ts'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { RUNTIME_CATALOG_FILE } from './core.ts'

const EXPERIMENTAL_BUNDLES = [
  '@deepseek-ai/dsh-experimental-agent-team',
  '@deepseek-ai/dsh-experimental-auto-review',
  '@deepseek-ai/dsh-experimental-schedule-bundle',
  '@deepseek-ai/dsh-experimental-voice-input-bundle',
]

const VOICE_ENTRIES = {
  'speech-to-text': '@deepseek-ai/dsh-experimental-speech-to-text',
  'speech-to-text-sensevoice': '@deepseek-ai/dsh-experimental-speech-to-text-sensevoice',
  'api-speech-to-text': '@deepseek-ai/dsh-experimental-api-speech-to-text',
  'ui-voice-input': '@deepseek-ai/dsh-experimental-client-ui-voice-input',
}

/** Brand icons arrive from the official manager as plain `data:image/` URIs. */
const ZHIHU_ICON = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHJlY3Qgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0IiBmaWxsPSIjMDA4NGZmIi8+PC9zdmc+'
const CARDS_ICON = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iOCIvPjwvc3ZnPg=='

/** Mirrors the prepared catalog written by scripts/desktop-compositions.mjs. */
function defaultCatalog(): RuntimeCatalog {
  return {
    bundles: ['dsh-editor-shell', 'dsh-editor-cards'],
    entries: {
      'ui-shortcuts': { title: '快捷键', description: '使用官方快捷键搜索、录制和重置。', locked: false, builtin: true, packageName: '@deepseek-ai/dsh-client-ui-shortcuts' },
      'ui-sidebar-documentpreview': { title: '资料预览', description: '预览图片、PDF、Office 文档和表格。', locked: false, builtin: true, packageName: '@deepseek-ai/dsh-client-ui-sidebar-documentpreview' },
      'mcp-resources': { title: 'MCP 资源', description: '读取已配置 MCP 服务提供的资源。', locked: false, builtin: true, packageName: '@deepseek-ai/dsh-mcp-resources' },
      ...Object.fromEntries(Object.entries(VOICE_ENTRIES).map(([id, packageName]) => [id, {
        title: '语音输入', description: '使用官方本地语音识别，将转写放入对话草稿。首次使用需准备模型。', locked: false, builtin: true, packageName,
      }])),
      'editor-shell': { title: '编辑器外壳', description: '编辑器主界面。', locked: true, builtin: true, packageName: 'dsh-editor-shell' },
      manuscript: { title: '文稿内核', description: '文稿编辑内核。', locked: true, builtin: true, packageName: 'dsh-manuscript' },
      'manuscript-assist': { title: '补全服务', description: '正文行内补全', locked: false, builtin: true, packageName: 'dsh-manuscript' },
      'editor-cards': { title: '人物卡与世界书', description: '在文件树中定位人物卡与世界书', locked: true, builtin: true, packageName: 'dsh-editor-cards' },
      'editor-novel-kernel': { title: '小说内核', description: '小说模式。', locked: true, builtin: true, packageName: 'dsh-editor-novel-kernel', managedBy: 'session' },
      'writing-tools': { title: '写作工具', description: '写作功能条目。', locked: true, builtin: true, packageName: 'dsh-editor-workbench', managedBy: 'feature' },
    },
  }
}

function defaultBundles() {
  return [
    ...EXPERIMENTAL_BUNDLES.map((name) => ({ name, enabled: false, installed: true })),
    { name: 'dsh-editor-shell', enabled: true, installed: true, readOnlyReason: 'management-required' },
    { name: 'dsh-editor-cards', enabled: true, installed: true, readOnlyReason: 'management-required' },
    { name: '@klarkxy/dsh-web-search-manager', enabled: true, installed: true },
    { name: 'dsh-editor-plugins', enabled: true, installed: true, readOnlyReason: 'management-required' },
  ]
}

const DEFAULT_PLUGINS = [
  { entryId: 'include:editor-shell', patchId: 'editor-shell', enabled: true, readOnlyReason: 'management-required' },
  { entryId: 'ui-shortcuts', patchId: 'ui-shortcuts', enabled: true },
  { entryId: 'ui-sidebar-documentpreview', patchId: 'ui-sidebar-documentpreview', enabled: false },
  { entryId: 'mcp-resources', patchId: 'mcp-resources', enabled: false },
  { entryId: 'manuscript', patchId: 'manuscript', enabled: true, readOnlyReason: 'management-required' },
  { entryId: 'manuscript-assist', patchId: 'manuscript-assist', enabled: true },
  { entryId: 'editor-cards', patchId: 'editor-cards', enabled: true },
]

function section(catalog: PluginCatalog, id: PluginCatalog['sections'][number]['id']): PluginCatalogCard[] {
  return catalog.sections.find((row) => row.id === id)?.items ?? []
}

function byTitle(catalog: PluginCatalog, id: PluginCatalog['sections'][number]['id'], title: string) {
  return section(catalog, id).filter((card) => card.title === title)
}

describe('plugin catalog classification', () => {
  it('splits the default distribution into official, builtin and user without duplicates', () => {
    const catalog = buildPluginCatalog({ catalog: defaultCatalog(), bundles: defaultBundles(), plugins: DEFAULT_PLUGINS })
    expect(catalog.sections.map((row) => row.id)).toEqual(['official', 'builtin', 'user'])
    // Only the whitelisted official bundle surfaces; the rest stay hidden.
    expect(section(catalog, 'official').map((card) => card.packageName)).toEqual(['@deepseek-ai/dsh-experimental-voice-input-bundle'])
    expect(byTitle(catalog, 'builtin', '快捷键')).toHaveLength(0)
    expect(byTitle(catalog, 'builtin', '资料预览')).toHaveLength(1)
    expect(byTitle(catalog, 'builtin', 'MCP 资源')).toHaveLength(1)
    expect(section(catalog, 'user').map((card) => card.packageName)).toEqual(['@klarkxy/dsh-web-search-manager'])
  })

  it('marks every official card experimental, switchable and titled from the prepared catalog', () => {
    const catalog = buildPluginCatalog({ catalog: defaultCatalog(), bundles: defaultBundles(), plugins: DEFAULT_PLUGINS })
    const voice = byTitle(catalog, 'official', '语音输入')
    expect(voice).toHaveLength(1)
    expect(voice[0]?.key).toBe('bundle:@deepseek-ai/dsh-experimental-voice-input-bundle')
    expect(voice[0]?.badges).toContain('experimental')
    expect(voice[0]?.action).toBe('switch')
    expect(voice[0]?.enabled).toBe(false)
    // Voice entries fold into the bundle card and must not reappear in builtin.
    for (const id of Object.keys(VOICE_ENTRIES)) {
      expect(byTitle(catalog, 'builtin', '语音输入')).toHaveLength(0)
      expect(section(catalog, 'builtin').some((card) => card.entryId === id)).toBe(false)
    }
    // No experimental package ever reaches builtin, and hidden official
    // bundles reach no section at all.
    expect(section(catalog, 'builtin').every((card) => !card.packageName?.startsWith('@deepseek-ai/dsh-experimental-'))).toBe(true)
    expect(catalog.sections.flatMap((row) => row.items).some((card) => card.packageName === '@deepseek-ai/dsh-experimental-agent-team')).toBe(false)
  })

  it('routes a no-longer-preinstalled third-party package to user like any install', () => {
    const catalog = buildPluginCatalog({ catalog: defaultCatalog(), bundles: defaultBundles(), plugins: DEFAULT_PLUGINS })
    const card = section(catalog, 'user').find((row) => row.packageName === '@klarkxy/dsh-web-search-manager')
    expect(card?.badges).toEqual(['installed'])
    expect(card?.enabled).toBe(true)
    expect(card?.action).toBe('switch')
    // 无 bundle 行时不残留「预装」卡片。
    const noBundle = buildPluginCatalog({ catalog: defaultCatalog(), bundles: [{ name: 'dsh-editor-cards', enabled: true, installed: true }], plugins: DEFAULT_PLUGINS })
    expect(noBundle.sections.flatMap((row) => row.items).some((row) => row.packageName === '@klarkxy/dsh-web-search-manager')).toBe(false)
  })

  it('hides foundation runtime UI entries unless the author disabled them', () => {
    const catalog = buildPluginCatalog({ catalog: defaultCatalog(), bundles: defaultBundles(), plugins: DEFAULT_PLUGINS })
    // 快捷键 enabled → 隐藏；资料预览 enabled === false → 保留可重开卡片。
    expect(byTitle(catalog, 'builtin', '快捷键')).toHaveLength(0)
    expect(byTitle(catalog, 'builtin', '资料预览')).toHaveLength(1)
    expect(byTitle(catalog, 'builtin', '资料预览')[0]?.enabled).toBe(false)
    // 没有 live 行（状态未知）同样隐藏。
    const noRow = buildPluginCatalog({ catalog: defaultCatalog(), bundles: defaultBundles(), plugins: DEFAULT_PLUGINS.filter((row) => row.entryId !== 'ui-shortcuts' && row.entryId !== 'ui-sidebar-documentpreview') })
    expect(byTitle(noRow, 'builtin', '快捷键')).toHaveLength(0)
    expect(byTitle(noRow, 'builtin', '资料预览')).toHaveLength(0)
  })

  it('stamps required core bundles, drops the redundant locked badge and keeps their switch off', () => {
    const catalog = buildPluginCatalog({ catalog: defaultCatalog(), bundles: defaultBundles(), plugins: DEFAULT_PLUGINS })
    const shell = byTitle(catalog, 'builtin', '编辑器外壳')[0]
    expect(shell?.badges).toEqual(['required'])
    // 必需 already states the author cannot turn it off.
    expect(shell?.badges).not.toContain('locked')
    expect(shell?.enabled).toBeUndefined()
    expect(shell?.action).toBe('config')
    for (const title of ['补全服务', '人物卡与世界书']) {
      const item = byTitle(catalog, 'builtin', title)[0]
      expect(item?.badges).toEqual(['required'])
      expect(item?.enabled).toBeUndefined()
      expect(item?.action).not.toBe('switch')
    }
    // A core bundle without a prepared-catalog product name is implementation
    // plumbing and must not masquerade as an author-facing feature card.
    expect(section(catalog, 'builtin').some((card) => card.packageName === 'dsh-editor-plugins')).toBe(false)
  })

  it('leaves no card with the section-carrying builtin badge and keeps locked only when locked without required', () => {
    const catalog = buildPluginCatalog({
      catalog: {
        bundles: ['@acme/managed'],
        entries: {
          ...defaultCatalog().entries,
          'locked-entry': { title: '受管插件', description: '被锁定的可选插件。', locked: true, builtin: true, packageName: '@acme/locked-entry' },
          'managed-bundle': { title: '受管组件', description: '被官方管理的组件。', locked: false, builtin: false, packageName: '@acme/managed' },
        },
      },
      bundles: [{ name: '@acme/managed', enabled: true, installed: true, readOnlyReason: 'management-required' }],
      plugins: [],
    })
    expect(catalog.sections.flatMap((row) => row.items).some((card) => card.badges.includes('builtin'))).toBe(false)
    // Optional builtin entries are neither required nor locked, so they read as plain cards.
    expect(byTitle(catalog, 'builtin', '资料预览')).toHaveLength(0)
    expect(byTitle(catalog, 'builtin', '编辑器外壳')[0]?.badges).toEqual(['required'])
    // Locked but not required keeps locked on its own, on an entry card and a bundle card.
    expect(byTitle(catalog, 'builtin', '受管插件')[0]?.badges).toEqual(['locked'])
    expect(byTitle(catalog, 'builtin', '受管插件')[0]?.enabled).toBeUndefined()
    expect(byTitle(catalog, 'builtin', '受管组件')[0]?.badges).toEqual(['locked'])
  })

  it('titles upstream experimental bundles and keeps runtime plumbing out of the list', () => {
    const catalog = buildPluginCatalog({
      catalog: defaultCatalog(),
      bundles: [
        { name: '@deepseek-ai/dsh-experimental-auto-review', enabled: true, installed: true },
        { name: '@deepseek-ai/dsh-experimental-schedule-bundle', enabled: true, installed: true },
        { name: '@deepseek-ai/dsh-experimental-voice-input-bundle', enabled: false, installed: true },
        { name: '@deepseek-ai/dsh-base', enabled: true, installed: true, readOnlyReason: 'management-required' },
        { name: '@deepseek-ai/dsh-sdk-app', enabled: true, installed: true, readOnlyReason: 'management-required' },
        { name: '@klarkxy/dsh-web-search-manager', enabled: true, installed: true },
      ],
      plugins: DEFAULT_PLUGINS,
    })
    // Hidden official bundles the author already enabled still show so they can be switched off.
    expect(section(catalog, 'official').map((card) => card.title)).toEqual(['自动授权审查', '自动化任务', '语音输入'])
    expect(section(catalog, 'official').every((card) => card.action === 'switch')).toBe(true)
    expect(section(catalog, 'builtin').some((card) => card.packageName === '@deepseek-ai/dsh-base')).toBe(false)
    expect(section(catalog, 'user').map((card) => card.packageName)).toEqual(['@klarkxy/dsh-web-search-manager'])
  })

  it('keeps an author-installed removable official bundle listed after it is switched off', () => {
    const catalog = buildPluginCatalog({
      catalog: defaultCatalog(),
      bundles: [
        // Author-installed official package: switching it off must not remove
        // the uninstall entry along with the row.
        { name: '@deepseek-ai/dsh-subagent-claude-code', official: true, enabled: false, installed: true, removable: true },
        // Merely declared (not installed) non-whitelist rows stay hidden.
        { name: '@deepseek-ai/dsh-subagent-codex', official: true, enabled: false, installed: false, removable: false },
        { name: '@deepseek-ai/dsh-experimental-voice-input-bundle', enabled: true, installed: true },
      ],
      plugins: DEFAULT_PLUGINS,
    })
    expect(section(catalog, 'official').map((card) => card.packageName)).toEqual([
      '@deepseek-ai/dsh-subagent-claude-code',
      '@deepseek-ai/dsh-experimental-voice-input-bundle',
    ])
    expect(section(catalog, 'builtin').some((card) => card.packageName === '@deepseek-ai/dsh-subagent-codex')).toBe(false)
    expect(section(catalog, 'user').some((card) => card.packageName === '@deepseek-ai/dsh-subagent-codex')).toBe(false)
  })

  it('points every recommended homepage at a host allowed by the desktop external-link whitelist', () => {
    for (const plugin of RECOMMENDED_PLUGINS) {
      expect(isAllowedExternalUrl(plugin.homepage), plugin.packageName).toBe(true)
    }
  })

  it('projects catalog managedBy onto session and feature badges', () => {
    const catalog = buildPluginCatalog({ catalog: defaultCatalog(), bundles: defaultBundles(), plugins: DEFAULT_PLUGINS })
    expect(byTitle(catalog, 'builtin', '小说内核')[0]?.badges).toContain('session-managed')
    expect(byTitle(catalog, 'builtin', '写作工具')[0]?.badges).toContain('feature-managed')
  })

  it('titles author-installed bundles from the inventory meta before the package name', () => {
    const catalog = buildPluginCatalog({
      catalog: { bundles: [], entries: {} },
      bundles: [
        { name: '@acme/plugin', enabled: true, installed: true, meta: { title: { en: 'Author feature', zh: '作者功能' }, description: '来自 meta 的说明。' } },
        { name: '@acme/plain', enabled: true, installed: true },
      ],
      plugins: [],
    })
    const user = section(catalog, 'user')
    expect(user.map((card) => card.title)).toEqual(['作者功能', '@acme/plain'])
    expect(user[0]?.description).toBe('来自 meta 的说明。')
  })

  it('passes a bundle brand icon through verbatim while title and description stay locale maps', () => {
    const catalog = buildPluginCatalog({
      catalog: { bundles: [], entries: {} },
      bundles: [{
        name: '@klarkxy/dsh-zhihu',
        enabled: true,
        installed: true,
        meta: {
          title: { en: 'Zhihu', zh: '知乎' },
          description: { en: 'Read Zhihu threads.', zh: '读取知乎话题与回答。' },
          icon: ZHIHU_ICON,
        },
      }],
      plugins: [],
    })
    const card = section(catalog, 'user')[0]
    expect(card?.title).toBe('知乎')
    expect(card?.description).toBe('读取知乎话题与回答。')
    expect(card?.icon).toBe(ZHIHU_ICON)
  })

  it('drops an icon that is not a data:image/ string instead of passing it through', () => {
    const pngIcon = 'data:image/png;base64,iVBORw0KGgo='
    const catalog = buildPluginCatalog({
      catalog: { bundles: [], entries: {} },
      bundles: [
        { name: '@acme/locale-map-icon', enabled: true, installed: true, meta: { icon: { en: 'Icon', zh: '图标' } } },
        { name: '@acme/remote-icon', enabled: true, installed: true, meta: { icon: 'https://example.com/icon.svg' } },
        { name: '@acme/script-icon', enabled: true, installed: true, meta: { icon: 'javascript:alert(1)' } },
        { name: '@acme/number-icon', enabled: true, installed: true, meta: { icon: 42 } },
        { name: '@acme/empty-icon', enabled: true, installed: true, meta: { icon: '' } },
        { name: '@acme/png-icon', enabled: true, installed: true, meta: { icon: pngIcon } },
      ],
      plugins: [],
    })
    expect(section(catalog, 'user').map((card) => card.icon)).toEqual([undefined, undefined, undefined, undefined, undefined, pngIcon])
  })

  it('carries the icon on builtin bundle cards and on entry cards only when the live row supplies one', () => {
    const catalog = buildPluginCatalog({
      catalog: {
        bundles: ['dsh-editor-cards'],
        entries: {
          'ui-shortcuts': { title: '快捷键', description: '', locked: false, builtin: true, packageName: '@deepseek-ai/dsh-client-ui-shortcuts' },
          'mcp-resources': { title: 'MCP 资源', description: '', locked: false, builtin: true, packageName: '@deepseek-ai/dsh-mcp-resources' },
          'ui-widget': { title: '部件', description: '', locked: false, builtin: true, packageName: '@deepseek-ai/dsh-ui-widget' },
          cards: { title: '卡片', description: '', locked: false, builtin: false, packageName: 'dsh-editor-cards' },
        },
      },
      bundles: [{ name: 'dsh-editor-cards', enabled: true, installed: true, meta: { icon: CARDS_ICON } }],
      plugins: [
        { entryId: 'ui-shortcuts', patchId: 'ui-shortcuts', enabled: true },
        { entryId: 'ui-widget', patchId: 'ui-widget', enabled: true },
        { entryId: 'mcp-resources', patchId: 'mcp-resources', enabled: true, meta: { icon: CARDS_ICON } },
      ],
    })
    expect(byTitle(catalog, 'builtin', '卡片')[0]?.icon).toBe(CARDS_ICON)
    expect(byTitle(catalog, 'builtin', 'MCP 资源')[0]?.icon).toBe(CARDS_ICON)
    // No icon field at all, not an empty one, when the row declares none.
    expect(byTitle(catalog, 'builtin', '快捷键')).toHaveLength(0)
    expect('icon' in (byTitle(catalog, 'builtin', '部件')[0] ?? {})).toBe(false)
  })

  it('marks every author-installed card installed without mixing it with preinstalled', () => {
    const catalog = buildPluginCatalog({
      catalog: defaultCatalog(),
      bundles: [
        ...defaultBundles(),
        { name: '@klarkxy/dsh-zhihu', enabled: true, installed: true, meta: { title: { en: 'Zhihu', zh: '知乎' } } },
        { name: '@acme/locked-plugin', enabled: true, installed: true, readOnlyReason: 'management-required' },
      ],
      plugins: DEFAULT_PLUGINS,
    })
    const user = section(catalog, 'user')
    expect(user.map((card) => card.badges)).toEqual([['installed'], ['installed'], ['locked', 'installed']])
    const all = catalog.sections.flatMap((row) => row.items)
    expect(all.filter((card) => card.badges.includes('installed')).length).toBe(user.length)
    expect(all.some((card) => card.badges.includes('preinstalled') && card.badges.includes('installed'))).toBe(false)
    expect(section(catalog, 'user').find((row) => row.packageName === '@klarkxy/dsh-web-search-manager')?.badges).toEqual(['installed'])
  })

  it('routes author-installed bundles to user and keeps retired packages out of every section', () => {
    const catalog = buildPluginCatalog({
      catalog: defaultCatalog(),
      bundles: [
        ...defaultBundles(),
        { name: '@klarkxy/dsh-zhihu', enabled: true, installed: true },
        { name: '@klarkxy/dsh-current-title', enabled: false, installed: true },
        { name: '@klarkxy/dsh-memory', enabled: true, installed: true },
        { name: '@acme/author-plugin', enabled: true, installed: true },
      ],
      plugins: DEFAULT_PLUGINS,
    })
    expect(section(catalog, 'user').map((card) => card.packageName)).toEqual([
      '@klarkxy/dsh-web-search-manager',
      '@klarkxy/dsh-zhihu',
      '@klarkxy/dsh-current-title',
      '@acme/author-plugin',
    ])
    expect(byTitle(catalog, 'user', '@klarkxy/dsh-zhihu')[0]?.action).toBe('switch')
    const all = catalog.sections.flatMap((row) => row.items)
    expect(all.some((card) => card.packageName === '@klarkxy/dsh-memory')).toBe(false)
  })

  it('degrades to the distribution-owned builtin catalog without an official manager', async () => {
    const profileDir = await mkdtemp(join(tmpdir(), 'dsh-catalog-'))
    await writeFile(join(profileDir, RUNTIME_CATALOG_FILE), JSON.stringify(defaultCatalog()))
    const catalog = await readPluginCatalog(profileDir)
    expect(section(catalog, 'official')).toEqual([])
    expect(section(catalog, 'user')).toEqual([])
    // 运行时基础组件（快捷键/资料预览）与不再预装的网页搜索都不进列表。
    expect(byTitle(catalog, 'builtin', '网页搜索')).toHaveLength(0)
    expect(byTitle(catalog, 'builtin', '快捷键')).toHaveLength(0)
    expect(byTitle(catalog, 'builtin', '资料预览')).toHaveLength(0)
    expect(byTitle(catalog, 'builtin', 'MCP 资源')).toHaveLength(1)
  })

  it('returns an empty catalog when neither the prepared catalog nor a manager exists', async () => {
    const profileDir = await mkdtemp(join(tmpdir(), 'dsh-catalog-empty-'))
    const catalog = await readPluginCatalog(profileDir)
    expect(section(catalog, 'official')).toEqual([])
    expect(byTitle(catalog, 'builtin', '网页搜索')).toHaveLength(0)
  })

  it('survives a failing official manager and non-array inventory rows', async () => {
    const profileDir = await mkdtemp(join(tmpdir(), 'dsh-catalog-fail-'))
    await writeFile(join(profileDir, RUNTIME_CATALOG_FILE), JSON.stringify(defaultCatalog()))
    const catalog = await readPluginCatalog(profileDir, {
      listBundles: async () => { throw new Error('manager unavailable') },
      listPlugins: async () => { throw new Error('manager unavailable') },
    })
    expect(section(catalog, 'official')).toEqual([])
    expect(byTitle(catalog, 'builtin', '网页搜索')).toHaveLength(0)
    const malformed = buildPluginCatalog({ catalog: defaultCatalog(), bundles: { nope: true }, plugins: 'rows' })
    expect(section(malformed, 'official')).toEqual([])
    expect(section(malformed, 'user')).toEqual([])
  })
})

describe('official bundles not installed by the distribution', () => {
  it('lists a whitelisted official not-installed bundle as an install switch card', () => {
    const bundles = [...defaultBundles().filter((row) => row.name !== '@deepseek-ai/dsh-experimental-voice-input-bundle'), {
      name: '@deepseek-ai/dsh-experimental-voice-input-bundle', official: true, installed: false, enabled: false,
      availability: 'installation', installTarget: { spec: '@deepseek-ai/dsh-experimental-voice-input-bundle@1.2.0', version: '1.2.0' },
    }]
    const catalog = buildPluginCatalog({ catalog: defaultCatalog(), bundles, plugins: DEFAULT_PLUGINS })
    const card = section(catalog, 'official').find((item) => item.packageName === '@deepseek-ai/dsh-experimental-voice-input-bundle')
    expect(card).toMatchObject({
      key: 'bundle:@deepseek-ai/dsh-experimental-voice-input-bundle', installed: false,
      installSpec: '@deepseek-ai/dsh-experimental-voice-input-bundle@1.2.0', enabled: false, action: 'switch',
    })
    expect(card?.badges).toContain('experimental')
  })

  it('hides a non-whitelisted official not-installed bundle from every section', () => {
    const bundles = [...defaultBundles(), {
      name: '@deepseek-ai/dsh-automation', official: true, installed: false, enabled: false,
      availability: 'installation', installTarget: { spec: '@deepseek-ai/dsh-automation@1.2.0', version: '1.2.0' },
    }]
    const catalog = buildPluginCatalog({ catalog: defaultCatalog(), bundles, plugins: DEFAULT_PLUGINS })
    const all = catalog.sections.flatMap((row) => row.items)
    expect(all.some((card) => card.packageName === '@deepseek-ai/dsh-automation')).toBe(false)
    expect(section(catalog, 'official').map((card) => card.packageName)).toEqual(['@deepseek-ai/dsh-experimental-voice-input-bundle'])
  })

  it('keeps an installation-supplied bundle without a target as a normal card', () => {
    /* installed:false only means "not a profile dependency"; without an
       installTarget the row is a normal switch card, like the voice bundle. */
    const bundles = [...defaultBundles(),
      { name: '@deepseek-ai/dsh-voice-supplied', official: true, installed: false, enabled: true, availability: 'installation' },
      { name: '@scope/not-installed', official: false, installed: false, enabled: false,
        installTarget: { spec: '@scope/not-installed@1.0.0', version: '1.0.0' } },
    ]
    const catalog = buildPluginCatalog({ catalog: defaultCatalog(), bundles, plugins: DEFAULT_PLUGINS })
    const voice = section(catalog, 'official').find((card) => card.packageName === '@deepseek-ai/dsh-voice-supplied')
    expect(voice).toMatchObject({ enabled: true, action: 'switch' })
    expect(voice?.installed).toBeUndefined()
    /* Non-official on-demand rows (installTarget only) stay out of user. */
    expect(catalog.sections.flatMap((row) => row.items).some((card) => card.packageName === '@scope/not-installed')).toBe(false)
  })

  it('treats an enabled official row with an installTarget as a normal card', () => {
    const bundles = [...defaultBundles(), {
      name: '@deepseek-ai/dsh-automation', official: true, installed: false, enabled: true,
      availability: 'installation', installTarget: { spec: '@deepseek-ai/dsh-automation@1.2.0', version: '1.2.0' },
    }]
    const catalog = buildPluginCatalog({ catalog: defaultCatalog(), bundles, plugins: DEFAULT_PLUGINS })
    const card = section(catalog, 'official').find((item) => item.packageName === '@deepseek-ai/dsh-automation')
    expect(card).toMatchObject({ enabled: true, action: 'switch' })
    expect(card?.installed).toBeUndefined()
    expect(card?.installSpec).toBeUndefined()
  })

  it('keeps experimental bundle projection unchanged when installed', () => {
    const catalog = buildPluginCatalog({ catalog: defaultCatalog(), bundles: defaultBundles(), plugins: DEFAULT_PLUGINS })
    const voice = section(catalog, 'official').find((card) => card.packageName === '@deepseek-ai/dsh-experimental-voice-input-bundle')
    expect(voice?.installed).toBeUndefined()
    expect(voice?.installSpec).toBeUndefined()
    expect(voice?.badges).toContain('experimental')
  })
})
