import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { apply, handlePluginsRpc, resolveProfileArtifactDir } from './index.ts'
import { defaultPersistIo } from './persist.ts'
import { RUNTIME_CATALOG_FILE } from './core.ts'
import { PLUGIN_CATALOG_ENDPOINT, type PluginCatalog } from './contracts.ts'
import type { PluginPaths } from './paths.ts'

const signal = () => new AbortController().signal

vi.mock('@deepseek-ai/dsh-app-boot', () => ({
  readProfilePatches: vi.fn(() => [{ insert: [] }]),
  reconcileProfilePatches: vi.fn(async () => []),
}))

async function fixture(): Promise<PluginPaths> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-plugins-'))
  const profileDir = join(home, 'profiles', 'dsh-editor')
  await mkdir(profileDir, { recursive: true })
  await writeFile(join(profileDir, 'package.json'), `${JSON.stringify({ name: 'dsh-editor-profile', dsh: { profile: { bundles: ['dsh-editor-shell'] } } }, null, 2)}\n`)
  return {
    home,
    profile: 'dsh-editor',
    profileDir,
    stateFile: join(home, 'dsh-plugins.json'),
    patchFile: join(home, 'cordis.patch.yml'),
    userPluginsDir: join(home, 'user-plugins'),
  }
}

describe('plugin manager RPC', () => {
  it('searches the GitHub topic marketplace and rejects unsafe queries', async () => {
    const paths = await fixture()
    const unsafe = await handlePluginsRpc('marketplace.search', { query: 'a;b' }, signal(), { paths })
    expect(unsafe).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    const result = await handlePluginsRpc('marketplace.search', { query: 'theme' }, signal(), {
      paths,
      fetch: async (url) => {
        expect(String(url)).toContain('topic%3Adsh-plugin')
        return new Response(JSON.stringify({
          items: [{ full_name: 'acme/dsh-theme', description: '纸', stargazers_count: 3, html_url: 'https://github.com/acme/dsh-theme', topics: ['dsh-plugin'] }],
        }), { status: 200 })
      },
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual({ listings: [expect.objectContaining({ spec: 'github:acme/dsh-theme', stars: 3 })] })
  })

  it('rejects removed installer and inventory endpoints', async () => {
    const paths = await fixture()
    for (const endpoint of ['inventory.list', 'entry.setEnabled', 'marketplace.install', 'marketplace.inspect', 'marketplace.uninstall']) {
      expect(await handlePluginsRpc(endpoint, {}, signal(), { paths })).toMatchObject({
        ok: false, error: { code: 'bad-request', message: '不支持的插件操作' },
      })
    }
  })

  it('serves the read-only three-section catalog and keeps mutations on the official manager', async () => {
    const paths = await fixture()
    await writeFile(join(paths.profileDir, RUNTIME_CATALOG_FILE), JSON.stringify({
      bundles: ['dsh-editor-shell'],
      entries: {
        'ui-shortcuts': { title: '快捷键', description: '搜索、录制和重置。', locked: false, builtin: true, packageName: '@deepseek-ai/dsh-client-ui-shortcuts' },
        'ui-voice-input': { title: '语音输入', description: '本地语音识别。', locked: false, builtin: true, packageName: '@deepseek-ai/dsh-experimental-client-ui-voice-input' },
      },
    }))
    const manager = {
      listBundles: async () => [
        { name: '@deepseek-ai/dsh-experimental-voice-input-bundle', enabled: false, installed: true },
        { name: 'dsh-editor-shell', enabled: true, installed: true, readOnlyReason: 'management-required' },
        { name: '@klarkxy/dsh-web-search-manager', enabled: true, installed: true },
      ],
      listPlugins: async () => [{ entryId: 'ui-shortcuts', patchId: 'ui-shortcuts', enabled: true }],
    }
    const result = await handlePluginsRpc(PLUGIN_CATALOG_ENDPOINT, {}, signal(), { paths, manager })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const value = result.value as PluginCatalog
    expect(value.sections.map((row) => row.id)).toEqual(['official', 'builtin', 'user'])
    const official = value.sections[0]?.items ?? []
    expect(official.map((card) => card.title)).toEqual(['语音输入'])
    expect(official[0]).toMatchObject({ key: 'bundle:@deepseek-ai/dsh-experimental-voice-input-bundle', action: 'switch', enabled: false })
    expect(official[0]?.badges).toContain('experimental')
    const builtin = value.sections[1]?.items ?? []
    expect(builtin.some((card) => card.title === '快捷键')).toBe(false)
    expect(builtin.some((card) => card.title === '网页搜索')).toBe(false)
    // The folded voice entry must not reappear in builtin.
    expect(builtin.some((card) => card.title === '语音输入')).toBe(false)
    expect(value.sections[2]?.items.some((card) => card.packageName === '@klarkxy/dsh-web-search-manager')).toBe(true)
    // catalog.list stays read-only.
    expect(await handlePluginsRpc('catalog.setEnabled', {}, signal(), { paths, manager })).toMatchObject({
      ok: false, error: { code: 'bad-request' },
    })
  })

  it('degrades to the builtin catalog when the official manager is absent', async () => {
    const paths = await fixture()
    const result = await handlePluginsRpc(PLUGIN_CATALOG_ENDPOINT, {}, signal(), { paths })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const value = result.value as PluginCatalog
    expect(value.sections[0]?.items).toEqual([])
    expect(value.sections.flatMap((section) => section.items).some((card) => card.packageName === '@klarkxy/dsh-web-search-manager')).toBe(false)
  })
})

describe('native manager host integration', () => {
  it('attaches the projection lifecycle and core guards, uses public profile reconciliation and restores on dispose', async () => {
    const paths = await fixture()
    const name = '@acme/research'
    const dir = join(paths.profileDir, 'node_modules', name)
    await mkdir(join(dir, 'lib'), { recursive: true })
    await writeFile(join(dir, 'lib', 'tools.js'), 'export const name = "research-tools"\n')
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name, exports: { './tools': './lib/tools.js' }, dshEditor: {
      entries: [{ id: 'research' }], inserts: [{ id: 'research-tools', name: `${name}/tools`, requires: ['research'] }],
    } }))
    await writeFile(join(paths.profileDir, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: [name] } } }))
    let enabled = true
    const original = async (id: string, value: boolean) => { enabled = value;return { changed: true, application: 'applied', target: id, stage: 'enable', enabled: value } }
    const manager = {
      listBundles: async () => [{ name, enabled: true, installed: true, rows: [{ rowId: 'research', moduleName: name, entryId: 'include:research' }] }],
      listPlugins: async () => [{ entryId: 'include:research', patchId: 'research', moduleName: name, enabled }],
      setPluginEnabled: original,
    }
    const disposers: Array<() => void> = []
    const profile = { name: 'dsh-editor', dir: paths.profileDir }
    const root = {}
    const host = {
      root,
      connection: {},
      webServer: { register: vi.fn(() => () => {}) },
      logger: { warn: vi.fn() },
      get: (key: string) => key === 'pluginManager' ? manager : key === 'profileContext' ? profile : key === 'hmr' ? {} : undefined,
      effect: (work: () => () => void) => { disposers.push(work()) },
    }
    const boot = await import('@deepseek-ai/dsh-app-boot')
    vi.mocked(boot.readProfilePatches).mockClear()
    vi.mocked(boot.reconcileProfilePatches).mockClear()
    vi.stubEnv('DSH_HOME', paths.home)
    try {
      apply(host as never)
      expect(manager.setPluginEnabled).not.toBe(original)
      expect(await manager.setPluginEnabled('include:editor-workbench-tools', false)).toMatchObject({ changed: false, error: { code: 'management-required' } })
      expect(await manager.setPluginEnabled('include:research', false)).toMatchObject({ application: 'applied' })
      const file = join(dir, '..', '..', 'dsh-editor-profile-config', 'presets.patch.json')
      expect(JSON.parse(await readFile(file, 'utf8'))[0].insert.some((row: { id: string }) => row.id === 'research-tools')).toBe(false)
      expect(boot.readProfilePatches).toHaveBeenCalledWith('dsh-editor', profile)
      expect(boot.reconcileProfilePatches).toHaveBeenCalledWith(root, [{ insert: [] }], 'dsh-editor')
      expect(host.logger.warn).not.toHaveBeenCalled()
      for (const dispose of disposers.reverse()) dispose()
      expect(manager.setPluginEnabled).toBe(original)
    } finally { vi.unstubAllEnvs() }
  })
})

describe('local distribution discovery', () => {
  async function writeBundle(root: string, name: string, manifest: Record<string, unknown>) {
    const dir = join(root, ...name.split('/'))
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'package.json'), `${JSON.stringify(manifest)}\n`)
  }

  async function localFixture() {
    const paths = await fixture()
    const artifacts = join(paths.profileDir, 'bundled-packages', 'node_modules')
    await writeBundle(artifacts, 'dsh-editor-sample-alpha', { name: 'dsh-editor-sample-alpha', dsh: { bundle: { patch: './cordis.patch.yml' } } })
    await writeBundle(artifacts, 'dsh-editor-sample-beta', { name: 'dsh-editor-sample-beta', dsh: { bundle: { patch: './cordis.patch.yml' } } })
    await writeBundle(artifacts, 'dsh-editor-cards', { name: 'dsh-editor-cards', dsh: { bundle: { patch: './cordis.patch.yml' } } })
    await writeBundle(artifacts, '@klarkxy/dsh-web-search-manager', { name: '@klarkxy/dsh-web-search-manager', dsh: { bundle: { patch: './cordis.patch.yml' } } })
    await writeBundle(artifacts, 'dsh-editor-shell', { name: 'dsh-editor-shell', dsh: { bundle: { patch: './cordis.patch.yml' } } })
    await writeBundle(artifacts, 'dsh-editor-profile-config', { name: 'dsh-editor-profile-config', dsh: { bundle: { patch: './base.patch.yml' } } })
    await writeBundle(artifacts, '@klarkxy/dsh-memory', { name: '@klarkxy/dsh-memory', dsh: { bundle: { patch: './cordis.patch.yml' } } })
    await writeFile(join(paths.profileDir, 'composition.json'), JSON.stringify({
      nativeDependencies: {
        'dsh-editor-sample-alpha': 'file:./bundled-packages/node_modules/dsh-editor-sample-alpha',
        'dsh-editor-sample-beta': 'file:./bundled-packages/node_modules/dsh-editor-sample-beta',
        'dsh-editor-cards': 'file:./bundled-packages/node_modules/dsh-editor-cards',
        '@klarkxy/dsh-web-search-manager': 'file:./bundled-packages/node_modules/@klarkxy/dsh-web-search-manager',
        'dsh-editor-shell': 'file:./bundled-packages/node_modules/dsh-editor-shell',
        'dsh-editor-profile-config': 'link:./profile-config',
        '@klarkxy/dsh-memory': 'file:./bundled-packages/node_modules/@klarkxy/dsh-memory',
      },
    }))
    await writeFile(join(paths.profileDir, 'dsh-editor-catalog.json'), JSON.stringify({
      bundles: ['dsh-editor-sample-alpha', 'dsh-editor-sample-beta', 'dsh-editor-cards', 'dsh-editor-shell'],
      entries: {
        'sample-alpha': { title: '示例资料甲', description: '示例列表与引用', locked: false, packageName: 'dsh-editor-sample-alpha' },
        'sample-beta': { title: '示例资料乙', description: '阅读与撤回示例记录', locked: false, packageName: 'dsh-editor-sample-beta' },
        'editor-cards': { title: '人物卡与世界书', description: '卡片列表与引用', locked: true, packageName: 'dsh-editor-cards' },
        'web-search-manager': { title: '网页搜索', description: '按需检索网页资料', locked: false, packageName: '@klarkxy/dsh-web-search-manager' },
        'editor-shell': { title: '写作界面', description: '三栏稿纸', locked: true, packageName: 'dsh-editor-shell' },
      },
    }))
    return paths
  }

  function listingsOf(result: Awaited<ReturnType<typeof handlePluginsRpc>>) {
    expect(result).toMatchObject({ ok: true })
    return (result as { ok: true; value: { listings: Array<Record<string, unknown>> } }).value.listings
  }

  it('lists optional local artifacts from immutable composition without GitHub', async () => {
    const paths = await localFixture()
    const fetch = async () => { throw new Error('network must not run for empty local query') }
    const listings = listingsOf(await handlePluginsRpc('marketplace.search', { query: '' }, signal(), { paths, fetch }))
    // 推荐在前、本地随附在后；web-search-manager 已有本地随附条目，推荐去重保留本地。
    expect(listings.map((row) => row.packageName)).toEqual(['@klarkxy/dsh-zhihu', 'dsh-editor-sample-alpha', 'dsh-editor-sample-beta', '@klarkxy/dsh-web-search-manager'])
    expect(listings[0]).toMatchObject({ source: 'recommended', spec: 'npm:@klarkxy/dsh-zhihu', url: 'https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-zhihu' })
    expect(listings.filter((row) => row.packageName === '@klarkxy/dsh-web-search-manager')).toHaveLength(1)
    expect(listings[1]).toMatchObject({
      source: 'local',
      title: '示例资料甲',
      packageName: 'dsh-editor-sample-alpha',
      description: '示例列表与引用',
    })
    expect(String(listings[1]?.spec)).toMatch(/^link:/)
    expect(String(listings[1]?.spec).replaceAll('\\', '/')).toContain('/bundled-packages/node_modules/dsh-editor-sample-alpha')
    expect(listings[1]).not.toHaveProperty('enabled')
    expect(listings[1]).not.toHaveProperty('installed')
    expect(listings.some((row) => row.packageName === 'dsh-editor-cards' || row.packageName === 'dsh-editor-shell' || row.packageName === 'dsh-editor-profile-config' || row.packageName === '@klarkxy/dsh-memory')).toBe(false)
  })

  it('matches exact private names and ASCII keywords before unversioned npm listings', async () => {
    const paths = await localFixture()
    const fetch = async () => { throw new Error('network must not run for local name or keyword') }
    expect(listingsOf(await handlePluginsRpc('marketplace.search', { query: 'dsh-editor-sample-alpha' }, signal(), { paths, fetch }))).toEqual([
      expect.objectContaining({ source: 'local', packageName: 'dsh-editor-sample-alpha', title: '示例资料甲' }),
    ])
    expect(listingsOf(await handlePluginsRpc('marketplace.search', { query: 'sample-alpha' }, signal(), { paths, fetch }))).toEqual([
      expect.objectContaining({ source: 'local', packageName: 'dsh-editor-sample-alpha' }),
    ])
    expect(listingsOf(await handlePluginsRpc('marketplace.search', { query: '@klarkxy/dsh-web-search-manager' }, signal(), { paths, fetch }))).toEqual([
      expect.objectContaining({ source: 'local', packageName: '@klarkxy/dsh-web-search-manager', title: '网页搜索' }),
    ])
  })

  it('keeps versioned npm specs on the public npm listing path', async () => {
    const paths = await localFixture()
    const fetch = async () => { throw new Error('network must not run for versioned npm') }
    expect(listingsOf(await handlePluginsRpc('marketplace.search', { query: '@klarkxy/dsh-web-search-manager@1.2.3' }, signal(), { paths, fetch }))).toEqual([
      expect.objectContaining({ source: 'npm', spec: 'npm:@klarkxy/dsh-web-search-manager@1.2.3' }),
    ])
  })

  it('keeps local choices after the profile node_modules copy is gone', async () => {
    const paths = await localFixture()
    const listings = listingsOf(await handlePluginsRpc('marketplace.search', { query: '示例资料甲' }, signal(), {
      paths,
      fetch: async () => { throw new Error('network must not run when a local query matches') },
    }))
    expect(listings).toEqual([expect.objectContaining({ packageName: 'dsh-editor-sample-alpha', title: '示例资料甲', source: 'local' })])
    const byName = listingsOf(await handlePluginsRpc('marketplace.search', { query: 'dsh-editor-sample-beta' }, signal(), { paths }))
    expect(byName).toEqual([expect.objectContaining({ packageName: 'dsh-editor-sample-beta' })])
    const byDescription = listingsOf(await handlePluginsRpc('marketplace.search', { query: '阅读与撤回' }, signal(), { paths }))
    expect(byDescription).toEqual([expect.objectContaining({ packageName: 'dsh-editor-sample-beta' })])
  })

  it('refuses unsafe names, outside paths, identity spoof, and non-bundles', async () => {
    const paths = await fixture()
    const artifacts = join(paths.profileDir, 'bundled-packages', 'node_modules')
    await writeBundle(artifacts, 'dsh-editor-sample-alpha', { name: 'dsh-editor-sample-alpha', dsh: { bundle: { patch: './cordis.patch.yml' } } })
    await writeBundle(artifacts, 'wrong-id', { name: 'other-name', dsh: { bundle: { patch: './cordis.patch.yml' } } })
    await writeBundle(artifacts, 'plain-lib', { name: 'plain-lib' })
    const outside = join(paths.profileDir, '..', 'escape-pkg')
    await writeBundle(join(paths.profileDir, '..'), 'escape-pkg', { name: 'escape-pkg', dsh: { bundle: { patch: './cordis.patch.yml' } } })
    await writeFile(join(paths.profileDir, 'composition.json'), JSON.stringify({
      nativeDependencies: {
        '../evil': 'file:./bundled-packages/node_modules/../evil',
        'wrong-id': 'file:./bundled-packages/node_modules/wrong-id',
        'plain-lib': 'file:./bundled-packages/node_modules/plain-lib',
        'escape-pkg': 'file:../escape-pkg',
        'dsh-editor-sample-alpha': 'file:../../../etc',
      },
    }))
    expect(resolveProfileArtifactDir(paths.profileDir, '../evil')).toBeUndefined()
    const listings = listingsOf(await handlePluginsRpc('marketplace.search', { query: '' }, signal(), {
      paths,
      fetch: async () => { throw new Error('network must not run for empty local query') },
    }))
    expect(listings.map((row) => row.packageName)).toEqual(['@klarkxy/dsh-web-search-manager', '@klarkxy/dsh-zhihu', 'dsh-editor-sample-alpha'])
    expect(listings.some((row) => row.packageName === 'wrong-id' || row.packageName === 'plain-lib' || row.packageName === 'escape-pkg')).toBe(false)
    expect(outside.replaceAll('\\', '/')).toContain('escape-pkg')
  })

  it('keeps GitHub keyword search and network errors when no local match', async () => {
    const paths = await localFixture()
    const result = await handlePluginsRpc('marketplace.search', { query: 'theme' }, signal(), {
      paths,
      fetch: async (url) => {
        expect(String(url)).toContain('topic%3Adsh-plugin')
        return new Response(JSON.stringify({
          items: [{ full_name: 'acme/dsh-theme', description: '纸', stargazers_count: 3, html_url: 'https://github.com/acme/dsh-theme', topics: ['dsh-plugin'] }],
        }), { status: 200 })
      },
    })
    expect(listingsOf(result)).toEqual([expect.objectContaining({ spec: 'github:acme/dsh-theme', stars: 3 })])
    const denied = await handlePluginsRpc('marketplace.search', { query: 'theme' }, signal(), {
      paths,
      fetch: async () => new Response('', { status: 403 }),
    })
    expect(denied).toMatchObject({ ok: false, error: { code: 'network' } })
  })

  it('matches a recommended plugin by keyword without any GitHub request', async () => {
    const paths = await localFixture()
    const listings = listingsOf(await handlePluginsRpc('marketplace.search', { query: '知乎' }, signal(), {
      paths,
      fetch: async () => { throw new Error('network must not run when a recommended plugin matches') },
    }))
    expect(listings).toEqual([expect.objectContaining({
      source: 'recommended', packageName: '@klarkxy/dsh-zhihu', spec: 'npm:@klarkxy/dsh-zhihu',
    })])
  })

  it('drops curated monorepos from GitHub discovery results', async () => {
    const paths = await localFixture()
    const result = await handlePluginsRpc('marketplace.search', { query: 'theme' }, signal(), {
      paths,
      fetch: async () => new Response(JSON.stringify({
        items: [
          { full_name: 'klarkxy/dsh-plugins', description: '集合', stargazers_count: 9, html_url: 'https://github.com/klarkxy/dsh-plugins', topics: ['dsh-plugin'] },
          { full_name: 'deepseek-ai/deepseek-harness', description: '内核', stargazers_count: 8, html_url: 'https://github.com/deepseek-ai/deepseek-harness', topics: ['dsh-plugin'] },
          { full_name: 'acme/dsh-theme', description: '纸', stargazers_count: 3, html_url: 'https://github.com/acme/dsh-theme', topics: ['dsh-plugin'] },
        ],
      }), { status: 200 }),
    })
    expect(listingsOf(result)).toEqual([expect.objectContaining({ spec: 'github:acme/dsh-theme', stars: 3 })])
  })
})
