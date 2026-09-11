import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { catalogFromEditorBlocks } from './core.ts'
import { handlePluginsRpc, inventoryFromLoader } from './index.ts'
import { MANAGED_PATCH_MARK } from './overlay.ts'
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
