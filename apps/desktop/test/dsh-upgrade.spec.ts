import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'
import { afterEach, describe, expect, it } from 'vitest'
import { deployProfile } from '../src/profile.js'
import { syncPresetDeclarations } from '../src/preset-config.js'
import { migrateWritingSettings } from '../src/settings-migration.js'

const homes: string[] = []
afterEach(async () => { for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true }) })
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'dsh-017-'))
  homes.push(home)
  const template = join(home, 'template')
  const bundle = join(template, 'node_modules', 'dsh-editor-profile-config')
  await mkdir(bundle, { recursive: true })
  await writeFile(join(bundle, 'package.json'), JSON.stringify({ name: 'dsh-editor-profile-config', dsh: { bundle: { patch: './base.patch.yml' } } }))
  await writeFile(join(bundle, 'base.patch.yml'), '[]\n')
  await writeFile(join(template, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['dsh-editor-profile-config'] } } }))
  await writeFile(join(template, 'cordis.patch.yml'), '[]\n')
  return { home, template }
}

describe('DSH 0.1.7 data migration', () => {
  it('keeps imported writing routes, later edits and plugin toggles through a forced redeploy', async () => {
    const { home, template } = await fixture()
    const old = 'dsh-editor-writing:\n  authorPreferences: 原来的偏好\n  completionModel:\n    provider: local\n    model: writer\nui-developer:\n  developerMode: true\n'
    await writeFile(join(home, 'settings.yaml'), old)
    await writeFile(join(home, 'dsh-plugins.json'), JSON.stringify({ schema: 1, overrides: { mood: false }, installed: [] }))
    const profile = await deployProfile(home, template)
    const patch = join(profile, 'cordis.patch.yml')
    const imported = parse(await readFile(patch, 'utf8'))
    expect(imported.find((r: { id: string }) => r.id === 'dsh-editor-writing').config.completionModel).toEqual({ provider: 'local', model: 'writer' })
    const edited = '- id: dsh-editor-writing\n  config:\n    authorPreferences: 作者后来选择的偏好\n- id: llm-pi-ai\n  config:\n    providers: []\n'
    await writeFile(patch, edited)
    await rm(join(profile, 'node_modules', 'dsh-editor-profile-config'), { recursive: true })
    await writeFile(join(profile, 'cordis.patch.before-dsh-0.1.7.yml'), 'historical backup')
    await deployProfile(home, template)
    await deployProfile(home, template)
    expect(await readFile(join(profile, 'cordis.patch.before-dsh-0.1.7.yml'), 'utf8')).toBe('historical backup')
    expect(await readFile(patch, 'utf8')).toBe(edited)
    expect(await readFile(join(home, 'settings.yaml.before-dsh-0.1.7'), 'utf8')).toBe(old)
    expect(parse(await readFile(join(home, 'settings.yaml'), 'utf8'))?.['dsh-editor-writing']).toBeUndefined()
    expect(JSON.parse(await readFile(join(home, 'dsh-plugins.json'), 'utf8')).overrides.mood).toBe(false)
  })
  it('keeps an explicit existing override and refuses malformed legacy data without deleting it', async () => {
    const { home, template } = await fixture()
    await writeFile(join(home, 'settings.yaml'), 'dsh-editor-writing: { fontSize: 21 }\n')
    await writeFile(join(template, 'cordis.patch.yml'), '- id: dsh-editor-writing\n  config: {}\n')
    await migrateWritingSettings(home, template)
    expect(parse(await readFile(join(template, 'cordis.patch.yml'), 'utf8'))[0].config).toEqual({})
    expect(parse(await readFile(join(home, 'settings.yaml'), 'utf8'))?.['dsh-editor-writing']).toBeUndefined()
    const other = await fixture()
    const malformed = 'dsh-editor-writing: [broken'
    await writeFile(join(other.home, 'settings.yaml'), malformed)
    await expect(migrateWritingSettings(other.home, other.template)).rejects.toThrow()
    expect(await readFile(join(other.home, 'settings.yaml'), 'utf8')).toBe(malformed)
  })
  it('registers only present preset directories and anchors the native include in each directory', async () => {
    const { home, template } = await fixture()
    const dir = join(home, '.agent-presets', 'custom-writing')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'preset.yml'), 'name: 写作\ndescription: 保留技能\norder: 2\n')
    await writeFile(join(dir, 'agent.cordis.yml'), '- id: skills\n  name: example\n  config:\n    root: !!js "new URL(\'skills/\', baseUrl).href"\n')
    await syncPresetDeclarations(home, template)
    const path = join(template, 'node_modules', 'dsh-editor-profile-config', 'presets.patch.json')
    const [preset] = JSON.parse(await readFile(path, 'utf8'))[0].insert
    expect(preset.config.id).toBe('custom-writing')
    expect(preset.config.plugins[0].name).toBe('example')
    expect(Function('return ' + preset.config.plugins[0].config.root.__jsExpr)()).toBe(new URL('skills/', pathToFileURL(dir + '/')).href)
    await rm(dir, { recursive: true })
    await syncPresetDeclarations(home, template)
    expect(JSON.parse(await readFile(path, 'utf8'))[0].insert).toEqual([])
  })
})
