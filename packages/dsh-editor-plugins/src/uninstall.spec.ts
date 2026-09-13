import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { installGitHubPlugin, defaultLink } from './install.ts'
import { handlePluginsRpc, persistPluginState, readPluginState } from './index.ts'
import { parseGitHubSpec } from './github.ts'
import { resolvePluginPaths } from './paths.ts'
import { emptyPluginState } from './overlay.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
const signal = () => new AbortController().signal
const packageName = 'sample-plugin'
const builtin = 'dsh-editor-shell'
const catalog = { bundles: [builtin], entries: { 'editor-shell': { title: 'Editor', description: '', locked: true, packageName: builtin } } }
async function installedFixture(prepared: boolean) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-uninstall-'))
  roots.push(home)
  const paths = resolvePluginPaths({ DSH_HOME: home }, [])
  await mkdir(join(paths.profileDir, 'node_modules', builtin), { recursive: true })
  await writeFile(join(paths.profileDir, 'node_modules', builtin, 'keep.txt'), 'builtin stays')
  await writeFile(join(paths.profileDir, 'package.json'), JSON.stringify({ name: 'fixture', private: true, dsh: { profile: { bundles: [builtin] } } }))
  if (prepared) await writeFile(join(paths.profileDir, 'dsh-editor-catalog.json'), JSON.stringify(catalog))
  const installed = await installGitHubPlugin(parseGitHubSpec('acme/sample')!, paths, signal(), {
    fetch: (async () => new Response(new Uint8Array(128))) as typeof fetch,
    extract: async (_archive, destination) => {
      await mkdir(join(destination, 'lib'), { recursive: true })
      await writeFile(join(destination, 'package.json'), JSON.stringify({ name: packageName, version: '1.0.0', main: 'lib/index.js', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
      await writeFile(join(destination, 'lib/index.js'), 'export const name = "sample"')
      await writeFile(join(destination, 'cordis.patch.yml'), '- insert:\n    - id: sample-entry\n      name: sample-plugin\n')
    },
    npmInstall: async () => {},
    link: defaultLink,
  }, catalog)
  await persistPluginState(paths, { ...emptyPluginState(), installed: [installed] })
  return paths
}
function loader(running: boolean) {
  const parent = { remove: async (id: string) => {
    expect(id).toBe('sample-entry')
    const i = rows.findIndex(row => row.options.id === id)
    if (i >= 0) rows.splice(i, 1)
  } }
  const rows = running ? [{ id: 'include:sample-entry', disabled: false, options: { id: 'sample-entry', name: packageName }, fiber: { state: 2 }, parent }] : []
  return { entries: () => rows, update: async () => {}, remove: async () => { throw new Error('Nested entry must be removed through its owning group using its local id') } }
}

describe('installed plugin removal', () => {
  for (const prepared of [true, false]) {
    for (const running of [false, true]) {
      it(`lists and uninstalls registered plugins with prepared=${prepared}, running=${running}`, async () => {
        const paths = await installedFixture(prepared)
        const host = loader(running)
        const options = { paths, loader: host }
        const inventory = await handlePluginsRpc('inventory.list', {}, signal(), options)
        expect(inventory).toMatchObject({ ok: true, value: { community: [expect.objectContaining({ packageName, origin: 'installed', locked: false, ...(running ? {} : { pendingRestart: true }) })] } })
        if (running) {
          const state = await readPluginState(paths)
          state.overrides = { 'sample-entry': false, unrelated: false }
          await persistPluginState(paths, state)
        }
        const result = await handlePluginsRpc('marketplace.uninstall', { name: packageName }, signal(), options)
        expect(result).toEqual({ ok: true, value: { restartRequired: true } })
        const manifest = JSON.parse(await readFile(join(paths.profileDir, 'package.json'), 'utf8'))
        expect(manifest.dsh.profile.bundles).toEqual([builtin])
        expect(manifest.dependencies?.[packageName]).toBeUndefined()
        expect((await readPluginState(paths)).installed).toEqual([])
        if (running) expect((await readPluginState(paths)).overrides).toEqual({ unrelated: false })
        await expect(stat(join(paths.userPluginsDir, packageName))).rejects.toMatchObject({ code: 'ENOENT' })
        await expect(stat(join(paths.profileDir, 'node_modules', packageName))).rejects.toMatchObject({ code: 'ENOENT' })
        expect(await readFile(join(paths.profileDir, 'node_modules', builtin, 'keep.txt'), 'utf8')).toBe('builtin stays')
        expect(host.entries()).toEqual([])
        expect(await handlePluginsRpc('inventory.list', {}, signal(), options)).toMatchObject({ ok: true, value: { community: [] } })
      })
    }
  }
  it('does not list a removed package retained by a boot-time loader snapshot', async () => {
    const paths = await installedFixture(true)
    const host = loader(true)
    host.entries()[0]!.parent.remove = async () => {}
    expect(await handlePluginsRpc('marketplace.uninstall', { name: packageName }, signal(), { paths, loader: host })).toMatchObject({ ok: true })
    expect(host.entries()).toHaveLength(1)
    expect(await handlePluginsRpc('inventory.list', {}, signal(), { paths, loader: host })).toMatchObject({ ok: true, value: { community: [] } })
  })
  it('preserves files and registration when the running plugin cannot dispose', async () => {
    const paths = await installedFixture(true)
    const host = loader(true)
    host.entries()[0]!.parent.remove = async () => { throw new Error('dispose failed') }
    expect(await handlePluginsRpc('marketplace.uninstall', { name: packageName }, signal(), { paths, loader: host })).toMatchObject({ ok: false, error: { details: { cause: 'dispose failed' } } })
    expect((await readPluginState(paths)).installed.map(item => item.name)).toEqual([packageName])
    expect((await stat(join(paths.userPluginsDir, packageName))).isDirectory()).toBe(true)
    expect((await stat(join(paths.profileDir, 'node_modules', packageName))).isDirectory()).toBe(true)
    const manifest = JSON.parse(await readFile(join(paths.profileDir, 'package.json'), 'utf8'))
    expect(manifest.dsh.profile.bundles).toContain(packageName)
  })
  it('keeps real bundled packages protected even if installation records contain one', async () => {
    const paths = await installedFixture(true)
    const state = await readPluginState(paths)
    state.installed.push({ name: builtin, spec: 'github:acme/core', version: '1.0.0' })
    await persistPluginState(paths, state)
    expect(await handlePluginsRpc('marketplace.uninstall', { name: builtin }, signal(), { paths, loader: loader(false) })).toMatchObject({ ok: false, error: { code: 'forbidden' } })
    expect(await readFile(join(paths.profileDir, 'node_modules', builtin, 'keep.txt'), 'utf8')).toBe('builtin stays')
  })
})
