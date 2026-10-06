import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { handlePluginsRpc, persistPluginState, resolveProfileArtifactDir } from './index.ts'
import { MANAGED_PATCH_MARK, renderOverridePatch } from './overlay.ts'
import type { PluginPaths } from './paths.ts'
import { profileDirFromPluginModule, resolvePluginPaths } from './paths.ts'

const signal = () => new AbortController().signal
const host = { entries: () => [], update: async () => {} }

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
    const unsafe = await handlePluginsRpc('marketplace.search', { query: 'a;b' }, signal(), { loader: host, paths })
    expect(unsafe).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    const result = await handlePluginsRpc('marketplace.search', { query: 'theme' }, signal(), {
      loader: host,
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
      expect(await handlePluginsRpc(endpoint, {}, signal(), { loader: host, paths })).toMatchObject({
        ok: false, error: { code: 'bad-request', message: '不支持的插件操作' },
      })
    }
  })
})

describe('plugin paths', () => {
  it('uses the editor home and the booted profile name', () => {
    const paths = resolvePluginPaths({ DSH_HOME: 'D:/editor-home' }, ['node', 'dsh', '--profile', 'dsh-editor'], 'D:/Users/x')
    expect(paths.home).toBe('D:/editor-home')
    expect(paths.profile).toBe('dsh-editor')
    expect(paths.patchFile.replaceAll('\\', '/')).toBe('D:/editor-home/cordis.patch.yml')
  })

  it('prefers the profile that actually loaded this package', () => {
    const home = join(tmpdir(), 'isolated-home')
    const profileDir = join(home, 'profiles', 'dsh-editor')
    const moduleUrl = pathToFileURL(join(profileDir, 'node_modules', 'dsh-editor-plugins', 'lib', 'index.js')).href
    expect(profileDirFromPluginModule(moduleUrl)).toBe(profileDir)
    const paths = resolvePluginPaths({}, ['node', 'dsh'], join(tmpdir(), 'other-user'), moduleUrl)
    expect(paths.profileDir).toBe(profileDir)
    expect(paths.home).toBe(home)
  })
})

describe('plugin state persist', () => {
  it('strips host-locked overrides when persisting plugin state', async () => {
    const paths = await fixture()
    await persistPluginState(paths, {
      schema: 1,
      overrides: { zhihu: false, 'editor-novel-kernel': true, proofread: true },
      presets: {},
      installed: [],
    })
    expect(JSON.parse(await readFile(paths.stateFile, 'utf8')).overrides).toEqual({ zhihu: false })
    expect(await readFile(paths.patchFile, 'utf8')).toBe(renderOverridePatch({ zhihu: false }))
    expect(await readFile(paths.patchFile, 'utf8')).toContain(MANAGED_PATCH_MARK)
  })
})

describe('first-party writing preset RPC', () => {
  async function presetFixture() {
    const paths = await fixture()
    const source = join(paths.profileDir, 'node_modules', 'dsh-editor-novel-kernel', 'presets', 'dsh-editor-novel')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'preset.yml'), 'name: 小说创作\ndescription: 面向长篇小说的写作搭档，按正文、大纲、人物卡与世界书分册推进。\n')
    await writeFile(join(source, 'agent.cordis.yml'), '[]\n')
    await writeFile(join(paths.profileDir, 'composition.json'), JSON.stringify({
      id: 'desktop',
      presets: [{ id: 'dsh-editor-novel', packageName: 'dsh-editor-novel-kernel', path: 'presets/dsh-editor-novel' }],
    }))
    const deployedCore = join(paths.home, '.agent-presets', 'dsh-editor-writing')
    await mkdir(deployedCore, { recursive: true })
    await writeFile(join(deployedCore, 'agent.cordis.yml'), '[]\n')
    await writeFile(join(deployedCore, 'preset.yml'), 'name: 通用写作\ndescription: 默认写作\n')
    return paths
  }

  it('lists the locked core plus toggleable first-party presets', async () => {
    const paths = await presetFixture()
    const result = await handlePluginsRpc('presets.list', {}, signal(), { loader: host, paths })
    expect(result).toMatchObject({ ok: true })
    const value = (result as { ok: true; value: { presets: Array<Record<string, unknown>> } }).value
    expect(value.presets).toEqual([
      { id: 'dsh-editor-writing', title: '通用写作', description: '默认写作', enabled: true, locked: true },
      {
        id: 'dsh-editor-novel',
        title: '小说创作',
        description: '面向长篇小说的写作搭档，按正文、大纲、人物卡与世界书分册推进。',
        enabled: true,
        locked: false,
        packageName: 'dsh-editor-novel-kernel',
      },
    ])
  })

  it('toggles a first-party preset live: removes and redeploys the roster dir without restart', async () => {
    const paths = await presetFixture()
    const deployed = join(paths.home, '.agent-presets', 'dsh-editor-novel')
    const disabled = await handlePluginsRpc('presets.setEnabled', { id: 'dsh-editor-novel', enabled: false }, signal(), { loader: host, paths, reloadProfile: async () => true })
    expect(disabled).toMatchObject({ ok: true, value: { restartRequired: false } })
    const state = JSON.parse(await readFile(paths.stateFile, 'utf8'))
    expect(state.presets).toEqual({ 'dsh-editor-novel': false })
    const listed = await handlePluginsRpc('presets.list', {}, signal(), { loader: host, paths, reloadProfile: async () => true })
    expect(listed).toMatchObject({ ok: true })
    const rows = (listed as { ok: true; value: { presets: Array<{ id: string; enabled: boolean }> } }).value.presets
    expect(rows.find((row) => row.id === 'dsh-editor-novel')?.enabled).toBe(false)

    const enabled = await handlePluginsRpc('presets.setEnabled', { id: 'dsh-editor-novel', enabled: true }, signal(), { loader: host, paths, reloadProfile: async () => true })
    expect(enabled).toMatchObject({ ok: true, value: { restartRequired: false } })
    expect(JSON.parse(await readFile(join(deployed, '.dsh-editor-owner.json'), 'utf8'))).toEqual({ app: 'dsh-editor', schema: 1 })
    expect(await readFile(join(deployed, 'preset.yml'), 'utf8')).toContain('name: 小说创作')
    const again = await handlePluginsRpc('presets.setEnabled', { id: 'dsh-editor-novel', enabled: false }, signal(), { loader: host, paths, reloadProfile: async () => true })
    expect(again).toMatchObject({ ok: true })
    expect(await readFile(join(paths.home, '.agent-presets', 'dsh-editor-writing', 'preset.yml'), 'utf8')).toContain('通用写作')
    await expect(readFile(join(deployed, 'preset.yml'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses to disable the core writing preset or unknown ids', async () => {
    const paths = await presetFixture()
    const core = await handlePluginsRpc('presets.setEnabled', { id: 'dsh-editor-writing', enabled: false }, signal(), { loader: host, paths })
    expect(core).toMatchObject({ ok: false, error: { code: 'forbidden' } })
    const unknown = await handlePluginsRpc('presets.setEnabled', { id: 'dsh-editor-article', enabled: false }, signal(), { loader: host, paths })
    expect(unknown).toMatchObject({ ok: false, error: { code: 'not-found' } })
    const malformed = await handlePluginsRpc('presets.setEnabled', { id: '' }, signal(), { loader: host, paths })
    expect(malformed).toMatchObject({ ok: false, error: { code: 'bad-request' } })
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
    await writeBundle(artifacts, 'dsh-editor-cards', { name: 'dsh-editor-cards', dsh: { bundle: { patch: './cordis.patch.yml' } } })
    await writeBundle(artifacts, 'dsh-editor-memory-panel', { name: 'dsh-editor-memory-panel', dsh: { bundle: { patch: './cordis.patch.yml' } } })
    await writeBundle(artifacts, '@klarkxy/dsh-web-search-manager', { name: '@klarkxy/dsh-web-search-manager', dsh: { bundle: { patch: './cordis.patch.yml' } } })
    await writeBundle(artifacts, 'dsh-editor-shell', { name: 'dsh-editor-shell', dsh: { bundle: { patch: './cordis.patch.yml' } } })
    await writeBundle(artifacts, 'dsh-editor-profile-config', { name: 'dsh-editor-profile-config', dsh: { bundle: { patch: './base.patch.yml' } } })
    await writeBundle(artifacts, '@klarkxy/dsh-memory', { name: '@klarkxy/dsh-memory', dsh: { bundle: { patch: './cordis.patch.yml' } } })
    await writeFile(join(paths.profileDir, 'composition.json'), JSON.stringify({
      nativeDependencies: {
        'dsh-editor-cards': 'file:./bundled-packages/node_modules/dsh-editor-cards',
        'dsh-editor-memory-panel': 'file:./bundled-packages/node_modules/dsh-editor-memory-panel',
        '@klarkxy/dsh-web-search-manager': 'file:./bundled-packages/node_modules/@klarkxy/dsh-web-search-manager',
        'dsh-editor-shell': 'file:./bundled-packages/node_modules/dsh-editor-shell',
        'dsh-editor-profile-config': 'link:./profile-config',
        '@klarkxy/dsh-memory': 'file:./bundled-packages/node_modules/@klarkxy/dsh-memory',
      },
    }))
    await writeFile(join(paths.profileDir, 'dsh-editor-catalog.json'), JSON.stringify({
      bundles: ['dsh-editor-cards', 'dsh-editor-memory-panel', 'dsh-editor-shell'],
      entries: {
        'editor-cards': { title: '人物卡与世界书', description: '卡片列表与引用', locked: false, packageName: 'dsh-editor-cards' },
        'editor-memory-panel': { title: '写作记忆', description: '阅读与撤回写作记忆', locked: false, packageName: 'dsh-editor-memory-panel' },
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
    const listings = listingsOf(await handlePluginsRpc('marketplace.search', { query: '' }, signal(), { loader: host, paths, fetch }))
    expect(listings.map((row) => row.packageName)).toEqual(['dsh-editor-cards', 'dsh-editor-memory-panel', '@klarkxy/dsh-web-search-manager'])
    expect(listings[0]).toMatchObject({
      source: 'local',
      title: '人物卡与世界书',
      packageName: 'dsh-editor-cards',
      description: '卡片列表与引用',
    })
    expect(String(listings[0]?.spec)).toMatch(/^link:/)
    expect(String(listings[0]?.spec).replaceAll('\\', '/')).toContain('/bundled-packages/node_modules/dsh-editor-cards')
    expect(listings[0]).not.toHaveProperty('enabled')
    expect(listings[0]).not.toHaveProperty('installed')
    expect(listings.some((row) => row.packageName === 'dsh-editor-shell' || row.packageName === 'dsh-editor-profile-config' || row.packageName === '@klarkxy/dsh-memory')).toBe(false)
  })

  it('matches exact private names and ASCII keywords before unversioned npm listings', async () => {
    const paths = await localFixture()
    const fetch = async () => { throw new Error('network must not run for local name or keyword') }
    expect(listingsOf(await handlePluginsRpc('marketplace.search', { query: 'dsh-editor-cards' }, signal(), { loader: host, paths, fetch }))).toEqual([
      expect.objectContaining({ source: 'local', packageName: 'dsh-editor-cards', title: '人物卡与世界书' }),
    ])
    expect(listingsOf(await handlePluginsRpc('marketplace.search', { query: 'cards' }, signal(), { loader: host, paths, fetch }))).toEqual([
      expect.objectContaining({ source: 'local', packageName: 'dsh-editor-cards' }),
    ])
    expect(listingsOf(await handlePluginsRpc('marketplace.search', { query: '@klarkxy/dsh-web-search-manager' }, signal(), { loader: host, paths, fetch }))).toEqual([
      expect.objectContaining({ source: 'local', packageName: '@klarkxy/dsh-web-search-manager', title: '网页搜索' }),
    ])
  })

  it('keeps versioned npm specs on the public npm listing path', async () => {
    const paths = await localFixture()
    const fetch = async () => { throw new Error('network must not run for versioned npm') }
    expect(listingsOf(await handlePluginsRpc('marketplace.search', { query: '@klarkxy/dsh-web-search-manager@1.2.3' }, signal(), { loader: host, paths, fetch }))).toEqual([
      expect.objectContaining({ source: 'npm', spec: 'npm:@klarkxy/dsh-web-search-manager@1.2.3' }),
    ])
  })

  it('keeps local choices after the profile node_modules copy is gone', async () => {
    const paths = await localFixture()
    const listings = listingsOf(await handlePluginsRpc('marketplace.search', { query: '人物卡' }, signal(), {
      loader: host,
      paths,
      fetch: async () => { throw new Error('network must not run when a local query matches') },
    }))
    expect(listings).toEqual([expect.objectContaining({ packageName: 'dsh-editor-cards', title: '人物卡与世界书', source: 'local' })])
    const byName = listingsOf(await handlePluginsRpc('marketplace.search', { query: 'dsh-editor-memory-panel' }, signal(), { loader: host, paths }))
    expect(byName).toEqual([expect.objectContaining({ packageName: 'dsh-editor-memory-panel' })])
    const byDescription = listingsOf(await handlePluginsRpc('marketplace.search', { query: '阅读与撤回' }, signal(), { loader: host, paths }))
    expect(byDescription).toEqual([expect.objectContaining({ packageName: 'dsh-editor-memory-panel' })])
  })

  it('refuses unsafe names, outside paths, identity spoof, and non-bundles', async () => {
    const paths = await fixture()
    const artifacts = join(paths.profileDir, 'bundled-packages', 'node_modules')
    await writeBundle(artifacts, 'dsh-editor-cards', { name: 'dsh-editor-cards', dsh: { bundle: { patch: './cordis.patch.yml' } } })
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
        'dsh-editor-cards': 'file:../../../etc',
      },
    }))
    expect(resolveProfileArtifactDir(paths.profileDir, '../evil')).toBeUndefined()
    const listings = listingsOf(await handlePluginsRpc('marketplace.search', { query: '' }, signal(), {
      loader: host,
      paths,
      fetch: async () => { throw new Error('network must not run for empty local query') },
    }))
    expect(listings.map((row) => row.packageName)).toEqual(['dsh-editor-cards'])
    expect(listings.some((row) => row.packageName === 'wrong-id' || row.packageName === 'plain-lib' || row.packageName === 'escape-pkg')).toBe(false)
    expect(outside.replaceAll('\\', '/')).toContain('escape-pkg')
  })

  it('keeps GitHub keyword search and network errors when no local match', async () => {
    const paths = await localFixture()
    const result = await handlePluginsRpc('marketplace.search', { query: 'theme' }, signal(), {
      loader: host,
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
      loader: host,
      paths,
      fetch: async () => new Response('', { status: 403 }),
    })
    expect(denied).toMatchObject({ ok: false, error: { code: 'network' } })
  })
})
