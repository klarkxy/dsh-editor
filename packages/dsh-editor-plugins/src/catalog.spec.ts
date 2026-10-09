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

  it('marks the preinstalled public plugin builtin and preinstalled', () => {
    const catalog = buildPluginCatalog({ catalog: defaultCatalog(), bundles: defaultBundles(), plugins: DEFAULT_PLUGINS })
    const card = byTitle(catalog, 'builtin', '网页搜索')[0]
    expect(card?.packageName).toBe('@klarkxy/dsh-web-search-manager')
    expect(card?.badges).toContain('preinstalled')
    expect(card?.badges).toContain('builtin')
    expect(card?.enabled).toBe(true)
    expect(card?.action).toBe('switch')
  })

  it('stamps required and locked core bundles and drops their switch', () => {
    const catalog = buildPluginCatalog({ catalog: defaultCatalog(), bundles: defaultBundles(), plugins: DEFAULT_PLUGINS })
    const shell = byTitle(catalog, 'builtin', '编辑器外壳')[0]
    expect(shell?.badges).toContain('required')
    expect(shell?.badges).toContain('locked')
    expect(shell?.enabled).toBeUndefined()
    expect(shell?.action).toBe('config')
    // A core bundle without a prepared-catalog product name is implementation
    // plumbing and must not masquerade as an author-facing feature card.
    expect(section(catalog, 'builtin').some((card) => card.packageName === 'dsh-editor-plugins')).toBe(false)
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
