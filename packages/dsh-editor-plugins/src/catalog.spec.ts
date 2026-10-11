import { describe, expect, it } from 'vitest'
import { buildPluginCatalog, readPluginCatalog } from './catalog.ts'
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
    bundles: ['dsh-editor-shell', 'dsh-editor-cards', '@klarkxy/dsh-web-search-manager'],
    entries: {
      'ui-shortcuts': { title: '快捷键', description: '使用官方快捷键搜索、录制和重置。', locked: false, builtin: true, packageName: '@deepseek-ai/dsh-client-ui-shortcuts' },
      'ui-sidebar-documentpreview': { title: '资料预览', description: '预览图片、PDF、Office 文档和表格。', locked: false, builtin: true, packageName: '@deepseek-ai/dsh-client-ui-sidebar-documentpreview' },
      'mcp-resources': { title: 'MCP 资源', description: '读取已配置 MCP 服务提供的资源。', locked: false, builtin: true, packageName: '@deepseek-ai/dsh-mcp-resources' },
      ...Object.fromEntries(Object.entries(VOICE_ENTRIES).map(([id, packageName]) => [id, {
        title: '语音输入', description: '使用官方本地语音识别，将转写放入对话草稿。首次使用需准备模型。', locked: false, builtin: true, packageName,
      }])),
      'editor-shell': { title: '编辑器外壳', description: '编辑器主界面。', locked: true, builtin: true, packageName: 'dsh-editor-shell' },
      manuscript: { title: '文稿校对', description: '文稿编辑内核。', locked: true, builtin: true, packageName: 'dsh-manuscript' },
      'editor-novel-kernel': { title: '小说内核', description: '小说模式。', locked: true, builtin: true, packageName: 'dsh-editor-novel-kernel', managedBy: 'session' },
      proofread: { title: '校对', description: '校对面板。', locked: true, builtin: true, packageName: 'dsh-proofread', managedBy: 'feature' },
    },
  }
}

function defaultBundles() {
  return [
    ...EXPERIMENTAL_BUNDLES.map((name) => ({ name, enabled: false, installed: true })),
    { name: 'dsh-editor-shell', enabled: true, installed: true, readOnlyReason: 'management-required' },
    { name: 'dsh-editor-cards', enabled: true, installed: true },
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
    expect(section(catalog, 'official').map((card) => card.packageName)).toEqual(EXPERIMENTAL_BUNDLES)
    expect(byTitle(catalog, 'builtin', '网页搜索')).toHaveLength(1)
    expect(byTitle(catalog, 'builtin', '快捷键')).toHaveLength(1)
    expect(byTitle(catalog, 'builtin', '资料预览')).toHaveLength(1)
    expect(byTitle(catalog, 'builtin', 'MCP 资源')).toHaveLength(1)
    expect(section(catalog, 'user')).toEqual([])
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
    // No experimental package ever reaches builtin.
    expect(section(catalog, 'builtin').every((card) => !card.packageName?.startsWith('@deepseek-ai/dsh-experimental-'))).toBe(true)
    const agentTeam = section(catalog, 'official').find((card) => card.packageName === '@deepseek-ai/dsh-experimental-agent-team')
    expect(agentTeam?.title).toBe('@deepseek-ai/dsh-experimental-agent-team')
  })

  it('marks the preinstalled public plugin preinstalled under the builtin section', () => {
    const catalog = buildPluginCatalog({ catalog: defaultCatalog(), bundles: defaultBundles(), plugins: DEFAULT_PLUGINS })
    const card = byTitle(catalog, 'builtin', '网页搜索')[0]
    expect(card?.packageName).toBe('@klarkxy/dsh-web-search-manager')
    expect(card?.badges).toEqual(['preinstalled'])
    expect(card?.enabled).toBe(true)
    expect(card?.action).toBe('switch')
  })

  it('stamps required core bundles, drops the redundant locked badge and keeps their switch off', () => {
    const catalog = buildPluginCatalog({ catalog: defaultCatalog(), bundles: defaultBundles(), plugins: DEFAULT_PLUGINS })
    const shell = byTitle(catalog, 'builtin', '编辑器外壳')[0]
    expect(shell?.badges).toEqual(['required'])
    // 必需 already states the author cannot turn it off.
    expect(shell?.badges).not.toContain('locked')
    expect(shell?.enabled).toBeUndefined()
    expect(shell?.action).toBe('config')
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
    expect(byTitle(catalog, 'builtin', '快捷键')[0]?.badges).toEqual([])
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
        { name: '@deepseek-ai/dsh-experimental-agent-team-profile', enabled: false, installed: true },
        { name: '@deepseek-ai/dsh-experimental-auto-review', enabled: false, installed: true },
        { name: '@deepseek-ai/dsh-experimental-schedule-bundle', enabled: false, installed: true },
        { name: '@deepseek-ai/dsh-experimental-voice-input-bundle', enabled: false, installed: true },
        { name: '@deepseek-ai/dsh-base', enabled: true, installed: true, readOnlyReason: 'management-required' },
        { name: '@deepseek-ai/dsh-sdk-app', enabled: true, installed: true, readOnlyReason: 'management-required' },
        { name: '@klarkxy/dsh-web-search-manager', enabled: true, installed: true },
      ],
      plugins: DEFAULT_PLUGINS,
    })
    expect(section(catalog, 'official').map((card) => card.title)).toEqual(['智能体团队', '自动授权审查', '自动化任务', '语音输入'])
    expect(section(catalog, 'official').every((card) => card.action === 'switch')).toBe(true)
    expect(section(catalog, 'builtin').some((card) => card.packageName === '@deepseek-ai/dsh-base')).toBe(false)
    expect(section(catalog, 'user').map((card) => card.packageName)).toEqual([])
  })

  it('projects catalog managedBy onto session and feature badges', () => {
    const catalog = buildPluginCatalog({ catalog: defaultCatalog(), bundles: defaultBundles(), plugins: DEFAULT_PLUGINS })
    expect(byTitle(catalog, 'builtin', '小说内核')[0]?.badges).toContain('session-managed')
    expect(byTitle(catalog, 'builtin', '校对')[0]?.badges).toContain('feature-managed')
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
          cards: { title: '卡片', description: '', locked: false, builtin: false, packageName: 'dsh-editor-cards' },
        },
      },
      bundles: [{ name: 'dsh-editor-cards', enabled: true, installed: true, meta: { icon: CARDS_ICON } }],
      plugins: [
        { entryId: 'ui-shortcuts', patchId: 'ui-shortcuts', enabled: true },
        { entryId: 'mcp-resources', patchId: 'mcp-resources', enabled: true, meta: { icon: CARDS_ICON } },
      ],
    })
    expect(byTitle(catalog, 'builtin', '卡片')[0]?.icon).toBe(CARDS_ICON)
    expect(byTitle(catalog, 'builtin', 'MCP 资源')[0]?.icon).toBe(CARDS_ICON)
    // No icon field at all, not an empty one, when the row declares none.
    expect('icon' in (byTitle(catalog, 'builtin', '快捷键')[0] ?? {})).toBe(false)
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
    expect(user.map((card) => card.badges)).toEqual([['installed'], ['locked', 'installed']])
    const all = catalog.sections.flatMap((row) => row.items)
    expect(all.filter((card) => card.badges.includes('installed')).length).toBe(user.length)
    expect(all.some((card) => card.badges.includes('preinstalled') && card.badges.includes('installed'))).toBe(false)
    expect(byTitle(catalog, 'builtin', '网页搜索')[0]?.badges).toEqual(['preinstalled'])
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
    expect(byTitle(catalog, 'builtin', '网页搜索')).toHaveLength(1)
    expect(byTitle(catalog, 'builtin', '快捷键')).toHaveLength(1)
    expect(byTitle(catalog, 'builtin', '资料预览')).toHaveLength(1)
    expect(byTitle(catalog, 'builtin', 'MCP 资源')).toHaveLength(1)
    // No live state means no switch, but the distribution copy is still served.
    expect(byTitle(catalog, 'builtin', '快捷键')[0]?.action).toBe('detail')
  })

  it('returns an empty catalog when neither the prepared catalog nor a manager exists', async () => {
    const profileDir = await mkdtemp(join(tmpdir(), 'dsh-catalog-empty-'))
    const catalog = await readPluginCatalog(profileDir)
    expect(section(catalog, 'official')).toEqual([])
    expect(byTitle(catalog, 'builtin', '网页搜索')).toHaveLength(1)
  })

  it('survives a failing official manager and non-array inventory rows', async () => {
    const profileDir = await mkdtemp(join(tmpdir(), 'dsh-catalog-fail-'))
    await writeFile(join(profileDir, RUNTIME_CATALOG_FILE), JSON.stringify(defaultCatalog()))
    const catalog = await readPluginCatalog(profileDir, {
      listBundles: async () => { throw new Error('manager unavailable') },
      listPlugins: async () => { throw new Error('manager unavailable') },
    })
    expect(section(catalog, 'official')).toEqual([])
    expect(byTitle(catalog, 'builtin', '网页搜索')).toHaveLength(1)
    const malformed = buildPluginCatalog({ catalog: defaultCatalog(), bundles: { nope: true }, plugins: 'rows' })
    expect(section(malformed, 'official')).toEqual([])
    expect(section(malformed, 'user')).toEqual([])
  })
})
