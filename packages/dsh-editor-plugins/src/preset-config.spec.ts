import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { emptyPluginState } from './overlay.ts'
import { resolvePluginPaths } from './paths.ts'
import { syncPresetDeclarations } from './preset-config.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
const name = '@acme/dsh-research'
const backend = { id: 'research', title: '资料检索', description: '资料服务' }
const tools = { id: 'research-tools', name: `${name}/tools`, title: '资料工具', description: '工具入口', requires: ['research'] }
const manifest = { name, version: '1.0.0', main: './lib/index.js', exports: { '.': './lib/index.js', './tools': './lib/tools.js' }, dsh: { bundle: { patch: './cordis.patch.yml' } }, dshEditor: { entries: [backend], inserts: [tools] } }

async function linkPackage(source: string, destination: string): Promise<void> {
  await mkdir(join(destination, '..'), { recursive: true })
  await symlink(source, destination, process.platform === 'win32' ? 'junction' : 'dir')
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-tools-overlay-'))
  roots.push(root)
  const paths = resolvePluginPaths({ DSH_HOME: root }, [])
  const source = join(paths.userPluginsDir, name)
  await mkdir(join(source, 'lib'), { recursive: true })
  await writeFile(join(source, 'package.json'), JSON.stringify(manifest))
  await writeFile(join(source, 'lib/index.js'), 'export const name = "research"\n')
  await writeFile(join(source, 'lib/tools.js'), 'export const name = "research-tools"\n')
  await writeFile(join(source, 'cordis.patch.yml'), `- insert:\n    - id: research\n      name: ${name}\n`)
  await mkdir(paths.profileDir, { recursive: true })
  await linkPackage(source, join(paths.profileDir, 'node_modules', name))
  await writeFile(join(paths.profileDir, 'package.json'), JSON.stringify({ name: 'profile', dsh: { profile: { bundles: [name] } } }))
  await writeFile(paths.stateFile, JSON.stringify({ ...emptyPluginState(), installed: [{ name, version: '1.0.0', spec: `npm:${name}@1.0.0` }] }))
  const preset = join(root, '.agent-presets', 'author-style')
  await mkdir(preset, { recursive: true })
  await writeFile(join(preset, 'preset.yml'), 'name: 作者风格\n')
  await writeFile(join(preset, 'agent.cordis.yml'), '[]\n')
  const patch = join(paths.profileDir, 'node_modules', 'dsh-editor-profile-config', 'presets.patch.json')
  return { paths, source, patch }
}
async function rows(patch: string): Promise<Array<{ id: string; name: string; config?: unknown }>> {
  return JSON.parse(await readFile(patch, 'utf8'))[0].insert
}

describe('installed own tools in the existing preset overlay', () => {
  it('adds valid own tools from a selected native bundle while retaining author presets', async () => {
    const { paths, patch } = await fixture()
    await syncPresetDeclarations(paths.home, paths.profileDir)
    expect(await rows(patch)).toEqual([expect.objectContaining({ id: 'editor-preset-author-style', name: '@deepseek-ai/dsh-agent-preset' }), { id: 'research-tools', name: `${name}/tools` }])
    const first = await readFile(patch, 'utf8')
    await syncPresetDeclarations(paths.home, paths.profileDir)
    expect(await readFile(patch, 'utf8')).toBe(first)
  })
  it('requires a selected native bundle and the package on disk', async () => {
    const { paths, source, patch } = await fixture()
    await writeFile(paths.stateFile, JSON.stringify(emptyPluginState()))
    await syncPresetDeclarations(paths.home, paths.profileDir)
    expect(await rows(patch)).toContainEqual({ id: 'research-tools', name: `${name}/tools` })
    await writeFile(join(paths.profileDir, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: [] } } }))
    await syncPresetDeclarations(paths.home, paths.profileDir)
    expect(await rows(patch)).toHaveLength(1)
    await writeFile(join(paths.profileDir, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: [name] } } }))
    await rm(join(paths.profileDir, 'node_modules', name), { recursive: true, force: true })
    await syncPresetDeclarations(paths.home, paths.profileDir)
    expect(await rows(patch)).toHaveLength(1)
    await linkPackage(source, join(paths.profileDir, 'node_modules', name))
    await syncPresetDeclarations(paths.home, paths.profileDir)
    expect(await rows(patch)).toContainEqual({ id: 'research-tools', name: `${name}/tools` })
  })
  it('ignores unsafe, foreign, undeclared, duplicate or missing tools', async () => {
    const { paths, source, patch } = await fixture()
    for (const replacement of [{ ...tools, id: 'root' }, { ...tools, name: 'other/tools' }, { ...tools, requires: ['foreign-service'] }, { ...tools, id: 'research' }]) {
      await writeFile(join(source, 'package.json'), JSON.stringify({ ...manifest, dshEditor: { entries: [backend], inserts: [replacement] } }))
      await syncPresetDeclarations(paths.home, paths.profileDir)
      expect(await rows(patch)).toHaveLength(1)
    }
    await writeFile(join(source, 'package.json'), JSON.stringify(manifest))
    await rm(join(source, 'lib/tools.js'))
    await syncPresetDeclarations(paths.home, paths.profileDir)
    expect(await rows(patch)).toHaveLength(1)
  })
  it('keeps selected-bundle tools in the overlay until the native bundle is dropped', async () => {
    const { paths, patch } = await fixture()
    await writeFile(paths.stateFile, JSON.stringify(emptyPluginState()))
    await syncPresetDeclarations(paths.home, paths.profileDir)
    expect(await rows(patch)).toContainEqual({ id: 'research-tools', name: `${name}/tools` })
    await writeFile(join(paths.profileDir, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: [] } } }))
    await syncPresetDeclarations(paths.home, paths.profileDir)
    expect(await rows(patch)).toEqual([expect.objectContaining({ id: 'editor-preset-author-style' })])
  })

  it('emits declared ./tools from native extras in official namespaces and ignores finite host packages', async () => {
    const { paths, source, patch } = await fixture()
    const extras = [
      { name: '@deepseek-ai/dsh-acceptance-extra', id: 'acceptance-extra-tools' },
      { name: 'dsh-editor-extra', id: 'editor-extra-tools' },
    ]
    const host = [
      { name: 'dsh-editor-shell', id: 'shell-tools' },
      { name: 'dsh-editor-cards', id: 'cards-tools' },
      { name: '@klarkxy/dsh-memory', id: 'memory-tools' },
    ]
    const bundles = [name, ...extras.map((item) => item.name), ...host.map((item) => item.name)]
    await writeFile(join(paths.profileDir, 'package.json'), JSON.stringify({ dsh: { profile: { bundles } } }))
    await writeFile(join(paths.profileDir, 'composition.json'), JSON.stringify({
      packages: ['dsh-editor-shell', 'dsh-editor-cards'],
      libraries: [],
    }))
    for (const item of [...extras, ...host]) {
      const dir = join(paths.userPluginsDir, item.name)
      await mkdir(join(dir, 'lib'), { recursive: true })
      await writeFile(join(dir, 'package.json'), JSON.stringify({
        name: item.name,
        main: './lib/index.js',
        exports: { '.': './lib/index.js', './tools': './lib/tools.js' },
        dshEditor: {
          entries: [{ id: `${item.id}-entry` }],
          inserts: [{ id: item.id, name: `${item.name}/tools`, requires: [`${item.id}-entry`] }],
        },
      }))
      await writeFile(join(dir, 'lib/index.js'), 'export const name = "extra"\n')
      await writeFile(join(dir, 'lib/tools.js'), 'export const name = "extra-tools"\n')
      await linkPackage(dir, join(paths.profileDir, 'node_modules', item.name))
    }
    await writeFile(paths.stateFile, JSON.stringify(emptyPluginState()))
    await syncPresetDeclarations(paths.home, paths.profileDir)
    const generated = await rows(patch)
    expect(generated).toContainEqual({ id: 'research-tools', name: `${name}/tools` })
    expect(generated).toContainEqual({ id: 'acceptance-extra-tools', name: '@deepseek-ai/dsh-acceptance-extra/tools' })
    expect(generated).toContainEqual({ id: 'editor-extra-tools', name: 'dsh-editor-extra/tools' })
    expect(generated.some((row) => row.id === 'shell-tools' || row.name === 'dsh-editor-shell/tools')).toBe(false)
    expect(generated.some((row) => row.id === 'cards-tools' || row.name === 'dsh-editor-cards/tools')).toBe(false)
    expect(generated.some((row) => row.id === 'memory-tools' || row.name === '@klarkxy/dsh-memory/tools')).toBe(false)
    await writeFile(join(source, 'package.json'), JSON.stringify({ ...manifest, dshEditor: { entries: [backend], inserts: [{ ...tools, id: 'root' }] } }))
    await syncPresetDeclarations(paths.home, paths.profileDir)
    expect(await rows(patch)).not.toContainEqual({ id: 'research-tools', name: `${name}/tools` })
    expect(await rows(patch)).toContainEqual({ id: 'acceptance-extra-tools', name: '@deepseek-ai/dsh-acceptance-extra/tools' })
  })
})
