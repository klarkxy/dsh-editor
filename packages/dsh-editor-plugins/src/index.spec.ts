import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { catalogFromEditorBlocks } from './core.ts'
import { handlePluginsRpc, inventoryFromLoader } from './index.ts'
import { MANAGED_PATCH_MARK, renderOverridePatch } from './overlay.ts'
import type { PluginPaths } from './paths.ts'
import { profileDirFromPluginModule, resolvePluginPaths } from './paths.ts'

const catalog = catalogFromEditorBlocks([
  {
    name: 'dsh-editor-shell',
    dshEditor: {
      entries: [{ id: 'editor-shell', title: '写作界面', description: '三栏稿纸与设置', locked: true }],
    },
  },
  {
    name: 'dsh-zhihu',
    dshEditor: {
      entries: [{ id: 'zhihu', title: '知乎资料', description: '知乎搜索、知识库与用量' }],
    },
  },
], ['dsh-editor-shell', 'dsh-zhihu'])

const signal = () => new AbortController().signal

function loader(entries: Array<{ id: string; name: string; disabled?: boolean; group?: boolean }>) {
  const rows = entries.map((entry) => ({
    id: entry.id,
    disabled: Boolean(entry.disabled),
    options: { name: entry.name, group: entry.group ?? false },
    fiber: entry.disabled ? undefined : { state: 2 },
  }))
  return {
    entries: () => rows,
    async update(id: string, options: { disabled?: boolean | null }) {
      const match = rows.find((row) => row.id === id)
      if (match) match.disabled = Boolean(options.disabled)
    },
  }
}

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
  it('lists core and optional plugins and hides harness internals', () => {
    const inventory = inventoryFromLoader(loader([
      { id: 'include:editor-shell', name: 'dsh-editor-shell' },
      { id: 'include:zhihu', name: 'dsh-zhihu' },
      { id: 'ui-sidebar', name: '@deepseek-ai/dsh-client-ui-sidebar' },
      { id: 'group-a', name: 'ignored', group: true },
    ]), { schema: 1, overrides: {}, installed: [] }, catalog)
    expect(inventory.core.map((card) => card.entryId)).toEqual(['include:editor-shell'])
    expect(inventory.optional.map((card) => card.entryId)).toEqual(['include:zhihu'])
    expect(inventory.community).toEqual([])
    expect(inventory.core[0]?.locked).toBe(true)
    expect(inventory.optional[0]?.locked).toBe(false)
  })

  it('refuses to disable a core plugin and persists optional toggles', async () => {
    const paths = await fixture()
    const host = loader([
      { id: 'editor-shell', name: 'dsh-editor-shell' },
      { id: 'zhihu', name: 'dsh-zhihu' },
    ])
    const blocked = await handlePluginsRpc('entry.setEnabled', { entryId: 'editor-shell', enabled: false }, signal(), { loader: host, paths, catalog })
    expect(blocked).toMatchObject({ ok: false, error: { code: 'forbidden' } })
    const toggled = await handlePluginsRpc('entry.setEnabled', { entryId: 'zhihu', enabled: false }, signal(), { loader: host, paths, catalog })
    expect(toggled).toMatchObject({ ok: true, value: { restartRequired: false } })
    const patch = await readFile(paths.patchFile, 'utf8')
    expect(patch).toContain(MANAGED_PATCH_MARK)
    expect(patch).toContain('id: zhihu')
    expect(patch).toContain('disabled: true')
    expect([...host.entries()].find((entry) => entry.id === 'zhihu')?.disabled).toBe(true)
  })

  it('searches the GitHub topic marketplace and rejects unsafe queries', async () => {
    const paths = await fixture()
    const host = loader([])
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

  it('does not uninstall bundled packages', async () => {
    const paths = await fixture()
    const blocked = await handlePluginsRpc('marketplace.uninstall', { name: 'dsh-editor-shell' }, signal(), { loader: loader([]), paths, catalog })
    expect(blocked).toMatchObject({ ok: false, error: { code: 'forbidden' } })
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

it('toggles real include IDs and persists the unprefixed profile patch ID', async () => {
  const paths = await fixture()
  const host = loader([{id: 'include:zhihu', name: 'dsh-zhihu'}, {id: 'include:editor-shell', name: 'dsh-editor-shell'}])
  expect(await handlePluginsRpc('entry.setEnabled', {entryId: 'include:editor-shell', enabled: false}, signal(), {loader: host, paths, catalog})).toMatchObject({ok: false, error: {code: 'forbidden'}})
  expect(await handlePluginsRpc('entry.setEnabled', {entryId: 'include:zhihu', enabled: false}, signal(), {loader: host, paths, catalog})).toMatchObject({ok: true, value: {restartRequired: false}})
  expect([...host.entries()][0].disabled).toBe(true)
  expect(await readFile(paths.patchFile, 'utf8')).toContain('- id: zhihu\n  disabled: true')
  expect(JSON.parse(await readFile(paths.stateFile, 'utf8')).overrides).toEqual({zhihu: false})
})
it('reports restart required if the live loader rejects a saved toggle', async () => {
  const paths = await fixture()
  const host = loader([{id: 'include:zhihu', name: 'dsh-zhihu'}])
  host.update = async () => { throw new Error('busy') }
  expect(await handlePluginsRpc('entry.setEnabled', {entryId: 'include:zhihu', enabled: false}, signal(), {loader: host, paths, catalog})).toMatchObject({ok: true, value: {restartRequired: true}})
  expect([...host.entries()][0].disabled).toBe(false)
  expect(JSON.parse(await readFile(paths.stateFile, 'utf8')).overrides).toEqual({zhihu: false})
})

const zhihuCatalog = catalogFromEditorBlocks([
  {
    name: 'dsh-editor-shell',
    dshEditor: { entries: [{ id: 'editor-shell', title: '写作界面', description: '三栏稿纸与设置', locked: true }] },
  },
  {
    name: 'dsh-zhihu',
    dshEditor: {
      entries: [{ id: 'zhihu', title: '知乎资料', description: '知乎搜索' }],
      inserts: [{ id: 'zhihu-tools', title: '知乎工具', description: '检索' }],
    },
  },
], ['dsh-editor-shell', 'dsh-zhihu'])

describe('grouped plugin enable', () => {
  it('validates the whole group before persisting any override', async () => {
    const paths = await fixture()
    const host = loader([
      { id: 'include:zhihu', name: 'dsh-zhihu' },
      { id: 'include:editor-shell', name: 'dsh-editor-shell' },
    ])
    const blocked = await handlePluginsRpc('entries.setEnabled', {
      entryIds: ['include:zhihu', 'include:editor-shell'],
      enabled: false,
    }, signal(), { loader: host, paths, catalog: zhihuCatalog })
    expect(blocked).toMatchObject({ ok: false, error: { code: 'forbidden' } })
    await expect(readFile(paths.stateFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect([...host.entries()].every((entry) => !entry.disabled)).toBe(true)
  })

  it('refuses a missing entry without writing overrides', async () => {
    const paths = await fixture()
    const host = loader([{ id: 'include:zhihu', name: 'dsh-zhihu' }])
    const missing = await handlePluginsRpc('entries.setEnabled', {
      entryIds: ['include:zhihu', 'include:zhihu-tools'],
      enabled: false,
    }, signal(), { loader: host, paths, catalog: zhihuCatalog })
    expect(missing).toMatchObject({ ok: false, error: { code: 'not-found' } })
    await expect(readFile(paths.stateFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('persists both Zhihu entries in one override write and confirms inventory', async () => {
    const paths = await fixture()
    const host = loader([
      { id: 'include:zhihu', name: 'dsh-zhihu' },
      { id: 'include:zhihu-tools', name: 'dsh-zhihu/tools' },
    ])
    const toggled = await handlePluginsRpc('entries.setEnabled', {
      entryIds: ['include:zhihu', 'include:zhihu-tools'],
      enabled: false,
    }, signal(), { loader: host, paths, catalog: zhihuCatalog })
    expect(toggled).toMatchObject({ ok: true, value: { restartRequired: false } })
    expect(JSON.parse(await readFile(paths.stateFile, 'utf8')).overrides).toEqual({ zhihu: false, 'zhihu-tools': false })
    const patch = await readFile(paths.patchFile, 'utf8')
    expect(patch).toContain(MANAGED_PATCH_MARK)
    expect(patch).toContain('id: zhihu\n  disabled: true')
    expect(patch).toContain('id: zhihu-tools\n  disabled: true')
    const listed = await handlePluginsRpc('inventory.list', {}, signal(), { loader: host, paths, catalog: zhihuCatalog })
    expect(listed.ok).toBe(true)
    if (listed.ok) {
      const cards = (listed.value as { optional: Array<{ entryId: string; enabled: boolean }> }).optional
      expect(cards.filter((card) => card.entryId.startsWith('include:zhihu')).every((card) => card.enabled === false)).toBe(true)
    }
  })

  it('blocks an unmanaged custom patch with no state or runtime mutation', async () => {
    const paths = await fixture()
    const custom = '- id: custom\n  config: {}\n'
    await writeFile(paths.patchFile, custom)
    const host = loader([{ id: 'include:zhihu', name: 'dsh-zhihu' }])
    const result = await handlePluginsRpc('entries.setEnabled', {
      entryIds: ['include:zhihu'],
      enabled: false,
    }, signal(), { loader: host, paths, catalog: zhihuCatalog })
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } })
    expect(await readFile(paths.patchFile, 'utf8')).toBe(custom)
    await expect(readFile(paths.stateFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect([...host.entries()][0].disabled).toBe(false)
  })

  it('returns an author-facing persist error and does not apply the loader', async () => {
    const paths = await fixture()
    const host = loader([
      { id: 'include:zhihu', name: 'dsh-zhihu' },
      { id: 'include:zhihu-tools', name: 'dsh-zhihu/tools' },
    ])
    const result = await handlePluginsRpc('entries.setEnabled', {
      entryIds: ['include:zhihu', 'include:zhihu-tools'],
      enabled: false,
    }, signal(), {
      loader: host,
      paths,
      catalog: zhihuCatalog,
      io: {
        readFile,
        writeFile,
        rm,
        rename: async (from, to) => {
          throw Object.assign(new Error(`EPERM: operation not permitted, rename '${from}' -> '${to}'`), { code: 'EPERM' })
        },
      },
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'internal', message: '未能保存插件开关，请重试。' } })
    if (!result.ok) expect(String(result.error.details.cause)).toContain('EPERM')
    expect([...host.entries()].every((entry) => !entry.disabled)).toBe(true)
  })

  it('retries a transient rename failure and then confirms inventory', async () => {
    const paths = await fixture()
    const host = loader([
      { id: 'include:zhihu', name: 'dsh-zhihu' },
      { id: 'include:zhihu-tools', name: 'dsh-zhihu/tools' },
    ])
    const { rename } = await import('node:fs/promises')
    let failures = 0
    const result = await handlePluginsRpc('entries.setEnabled', {
      entryIds: ['include:zhihu', 'include:zhihu-tools'],
      enabled: false,
    }, signal(), {
      loader: host,
      paths,
      catalog: zhihuCatalog,
      io: {
        readFile,
        writeFile,
        rm: async (path, opts) => rm(path, opts),
        rename: async (from, to) => {
          failures += 1
          if (failures === 1) throw Object.assign(new Error('EPERM'), { code: 'EPERM' })
          return rename(from, to)
        },
      },
    })
    expect(result).toMatchObject({ ok: true, value: { restartRequired: false } })
    expect(JSON.parse(await readFile(paths.stateFile, 'utf8')).overrides).toEqual({ zhihu: false, 'zhihu-tools': false })
  })

  it('restores JSON when the patch rename fails permanently', async () => {
    const paths = await fixture()
    const oldState = { schema: 1, overrides: { zhihu: true, 'zhihu-tools': true }, installed: [] }
    const stateText = `${JSON.stringify(oldState, null, 2)}\n`
    const patchText = renderOverridePatch(oldState.overrides)
    await writeFile(paths.stateFile, stateText)
    await writeFile(paths.patchFile, patchText)
    const host = loader([
      { id: 'include:zhihu', name: 'dsh-zhihu' },
      { id: 'include:zhihu-tools', name: 'dsh-zhihu/tools' },
    ])
    const { rename } = await import('node:fs/promises')
    const result = await handlePluginsRpc('entries.setEnabled', {
      entryIds: ['include:zhihu', 'include:zhihu-tools'],
      enabled: false,
    }, signal(), {
      loader: host,
      paths,
      catalog: zhihuCatalog,
      io: {
        readFile,
        writeFile,
        rm,
        rename: async (from, to) => {
          if (String(to) === paths.patchFile) throw Object.assign(new Error('synthetic persistent Windows lock'), { code: 'EPERM' })
          return rename(from, to)
        },
      },
    })
    expect(result.ok).toBe(false)
    expect(await readFile(paths.stateFile, 'utf8')).toBe(stateText)
    expect(await readFile(paths.patchFile, 'utf8')).toBe(patchText)
    expect([...host.entries()].every((entry) => !entry.disabled)).toBe(true)
  })

  it('removes a just-written state when a missing patch cannot be created', async () => {
    const paths = await fixture()
    const host = loader([{ id: 'include:zhihu', name: 'dsh-zhihu' }])
    const { rename } = await import('node:fs/promises')
    const result = await handlePluginsRpc('entry.setEnabled', { entryId: 'include:zhihu', enabled: false }, signal(), {
      loader: host,
      paths,
      catalog: zhihuCatalog,
      io: {
        readFile,
        writeFile,
        rm,
        rename: async (from, to) => {
          if (String(to) === paths.patchFile) throw Object.assign(new Error('synthetic persistent Windows lock'), { code: 'EPERM' })
          return rename(from, to)
        },
      },
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'internal', details: { recovery: 'restored' } } })
    await expect(readFile(paths.stateFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(paths.patchFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect([...host.entries()][0].disabled).toBe(false)
  })

  it('reports failed cleanup truthfully after a missing-state rollback failure', async () => {
    const paths = await fixture()
    const host = loader([{ id: 'include:zhihu', name: 'dsh-zhihu' }])
    const { rename } = await import('node:fs/promises')
    const result = await handlePluginsRpc('entry.setEnabled', { entryId: 'include:zhihu', enabled: false }, signal(), {
      loader: host,
      paths,
      catalog: zhihuCatalog,
      io: {
        readFile,
        writeFile,
        rm: async (path, options) => {
          if (String(path) === paths.stateFile) throw new Error('synthetic cleanup failure')
          return rm(path, options)
        },
        rename: async (from, to) => {
          if (String(to) === paths.patchFile) throw Object.assign(new Error('synthetic persistent Windows lock'), { code: 'EPERM' })
          return rename(from, to)
        },
      },
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'internal', details: { recovery: 'failed', recoveryCause: 'synthetic cleanup failure' } } })
    expect(JSON.parse(await readFile(paths.stateFile, 'utf8')).overrides).toEqual({ zhihu: false })
    await expect(readFile(paths.patchFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect([...host.entries()][0].disabled).toBe(false)
  })

  it('does not treat an unreadable patch as missing', async () => {
    const paths = await fixture()
    const oldState = { schema: 1, overrides: { zhihu: true }, installed: [] }
    const stateText = `${JSON.stringify(oldState, null, 2)}\n`
    const patchText = '- id: custom-author-rule\n  config:\n    preserve: true\n'
    await writeFile(paths.stateFile, stateText)
    await writeFile(paths.patchFile, patchText)
    const host = loader([{ id: 'include:zhihu', name: 'dsh-zhihu' }])
    const result = await handlePluginsRpc('entries.setEnabled', {
      entryIds: ['include:zhihu'],
      enabled: false,
    }, signal(), {
      loader: host,
      paths,
      catalog: zhihuCatalog,
      io: {
        readFile: async (path, ...args) => {
          if (String(path) === paths.patchFile) throw Object.assign(new Error('synthetic unreadable patch'), { code: 'EACCES' })
          return readFile(path, ...args)
        },
        writeFile,
        rm,
        rename,
      },
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } })
    expect(await readFile(paths.stateFile, 'utf8')).toBe(stateText)
    expect(await readFile(paths.patchFile, 'utf8')).toBe(patchText)
    expect([...host.entries()][0].disabled).toBe(false)
  })

  it('preserves a managed patch that has appended user YAML', async () => {
    const paths = await fixture()
    const oldState = { schema: 1, overrides: { zhihu: true }, installed: [] }
    const stateText = `${JSON.stringify(oldState, null, 2)}\n`
    const patchText = `${renderOverridePatch(oldState.overrides)}- id: custom-author-rule\n  config:\n    preserve: true\n`
    await writeFile(paths.stateFile, stateText)
    await writeFile(paths.patchFile, patchText)
    const host = loader([{ id: 'include:zhihu', name: 'dsh-zhihu' }])
    const result = await handlePluginsRpc('entries.setEnabled', {
      entryIds: ['include:zhihu'],
      enabled: false,
    }, signal(), { loader: host, paths, catalog: zhihuCatalog })
    expect(result.ok).toBe(false)
    expect(await readFile(paths.stateFile, 'utf8')).toBe(stateText)
    expect(await readFile(paths.patchFile, 'utf8')).toBe(patchText)
    expect([...host.entries()][0].disabled).toBe(false)
  })
  it('blocks marketplace install before a fetch when the patch is unreadable', async () => {
    const paths = await fixture()
    let fetched = false
    const result = await handlePluginsRpc('marketplace.install', { spec: 'github:acme/plugin' }, signal(), {
      loader: loader([]),
      paths,
      fetch: async () => {
        fetched = true
        throw new Error('fetch must not run')
      },
      io: {
        readFile: async (path, ...args) => {
          if (String(path) === paths.patchFile) throw Object.assign(new Error('synthetic unreadable patch'), { code: 'EACCES' })
          return readFile(path, ...args)
        },
        writeFile,
        rm,
        rename,
      },
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden', details: { reason: 'unreadable-patch' } } })
    expect(fetched).toBe(false)
    await expect(readFile(paths.stateFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('blocks marketplace uninstall before package removal or loader unload for a custom patch', async () => {
    const paths = await fixture()
    const state = { schema: 1, overrides: {}, installed: [{ name: 'acme-plugin', version: '1.0.0', spec: 'github:acme/plugin' }] }
    const stateText = `${JSON.stringify(state, null, 2)}\n`
    const patchText = '- id: author-rule\n  config: {}\n'
    await writeFile(paths.stateFile, stateText)
    await writeFile(paths.patchFile, patchText)
    const profilePath = join(paths.profileDir, 'package.json')
    const profileText = await readFile(profilePath, 'utf8')
    const userMarker = join(paths.userPluginsDir, 'acme-plugin', 'keep.txt')
    const linkMarker = join(paths.profileDir, 'node_modules', 'acme-plugin', 'keep.txt')
    await mkdir(join(paths.userPluginsDir, 'acme-plugin'), { recursive: true })
    await mkdir(join(paths.profileDir, 'node_modules', 'acme-plugin'), { recursive: true })
    await writeFile(userMarker, 'user package')
    await writeFile(linkMarker, 'profile link')
    let removed = 0
    const host = { ...loader([{ id: 'include:acme', name: 'acme-plugin' }]), async remove() { removed += 1 } }
    const result = await handlePluginsRpc('marketplace.uninstall', { name: 'acme-plugin' }, signal(), { loader: host, paths, catalog: zhihuCatalog })
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden', details: { reason: 'unmanaged-patch' } } })
    expect(removed).toBe(0)
    expect(await readFile(paths.stateFile, 'utf8')).toBe(stateText)
    expect(await readFile(paths.patchFile, 'utf8')).toBe(patchText)
    expect(await readFile(profilePath, 'utf8')).toBe(profileText)
    expect(await readFile(userMarker, 'utf8')).toBe('user package')
    expect(await readFile(linkMarker, 'utf8')).toBe('profile link')
  })
})
