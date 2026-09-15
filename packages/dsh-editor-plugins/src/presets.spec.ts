import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  deployPluginPresets,
  inspectPluginPresets,
  PRESET_OWNER_MARKER,
  readPresetOwner,
  removePluginPresets,
} from './presets.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-plugin-presets-'))
  roots.push(root)
  for (const [rel, body] of Object.entries(files)) {
    const path = join(root, rel)
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, body)
  }
  return root
}

function pluginFiles(presets: unknown, extra: Record<string, string> = {}): Record<string, string> {
  return {
    'package.json': JSON.stringify({ name: 'team-plugin', version: '1.0.0', dshEditor: { presets } }),
    'agent-presets/team-style/preset.yml': 'name: 团队风格\n',
    'agent-presets/team-style/agent.cordis.yml': '[]\n',
    ...extra,
  }
}

describe('plugin preset declaration inspection', () => {
  it('accepts a well-formed declaration and resolves the source directory', async () => {
    const dir = await fixture(pluginFiles([{ id: 'team-style', path: 'agent-presets/team-style' }]))
    const { presets, problems } = await inspectPluginPresets(dir)
    expect(problems).toEqual([])
    expect(presets).toEqual([{ id: 'team-style', path: 'agent-presets/team-style', source: join(dir, 'agent-presets/team-style') }])
  })

  it('treats a missing dshEditor block or presets field as no declarations', async () => {
    const dir = await fixture({ 'package.json': '{"name":"team-plugin"}' })
    expect(await inspectPluginPresets(dir)).toEqual({ presets: [], problems: [] })
  })

  it('rejects invalid, reserved, and duplicate ids', async () => {
    const dir = await fixture(pluginFiles([
      { id: 'bad id', path: 'agent-presets/team-style' },
      { id: 'dsh-editor-writing', path: 'agent-presets/team-style' },
      { id: 'team-style', path: 'agent-presets/team-style' },
      { id: 'team-style', path: 'agent-presets/team-style' },
    ]))
    const { presets, problems } = await inspectPluginPresets(dir)
    expect(presets.map((item) => item.id)).toEqual(['team-style'])
    expect(problems.map((item) => item.code)).toEqual(['preset-id', 'preset-id', 'preset-id'])
    expect(problems[1]!.message).toContain('dsh-editor')
    expect(problems[2]!.message).toContain('重复')
  })

  it('rejects escaping paths and directories without the required files', async () => {
    const dir = await fixture(pluginFiles([
      { id: 'escape', path: '../outside' },
      { id: 'empty', path: 'agent-presets/empty' },
      { id: 'no-path' },
    ], { 'agent-presets/empty/preset.yml': 'name: 空\n' }))
    const { presets, problems } = await inspectPluginPresets(dir)
    expect(presets).toEqual([])
    expect(problems.map((item) => item.code)).toEqual(['preset-path', 'preset-files', 'preset-path'])
  })

  it('rejects a non-array presets field', async () => {
    const dir = await fixture(pluginFiles({ id: 'team-style' }))
    const { problems } = await inspectPluginPresets(dir)
    expect(problems).toEqual([{ code: 'preset-declaration', message: 'dshEditor.presets 必须是数组' }])
  })
})

describe('plugin preset deployment', () => {
  it('deploys declared presets with a plugin owner marker and updates them on redeploy', async () => {
    const dir = await fixture(pluginFiles([{ id: 'team-style', path: 'agent-presets/team-style' }]))
    const home = await mkdtemp(join(tmpdir(), 'dsh-plugin-presets-home-'))
    roots.push(home)
    await deployPluginPresets(home, 'team-plugin', dir)
    const deployed = join(home, '.agent-presets', 'team-style')
    expect(await readFile(join(deployed, 'preset.yml'), 'utf8')).toBe('name: 团队风格\n')
    expect(await readPresetOwner(deployed)).toEqual({ app: 'dsh-editor', schema: 1, plugin: 'team-plugin' })
    await writeFile(join(dir, 'agent-presets/team-style/preset.yml'), 'name: 团队风格 v2\n')
    await deployPluginPresets(home, 'team-plugin', dir)
    expect(await readFile(join(deployed, 'preset.yml'), 'utf8')).toBe('name: 团队风格 v2\n')
    const siblings = await readdir(join(home, '.agent-presets'))
    expect(siblings.some((name) => name.includes('.stage-') || name.includes('.backup-'))).toBe(false)
  })

  it('refuses to overwrite a preset owned by another plugin or an unmarked directory', async () => {
    const dir = await fixture(pluginFiles([{ id: 'team-style', path: 'agent-presets/team-style' }]))
    const home = await mkdtemp(join(tmpdir(), 'dsh-plugin-presets-home-'))
    roots.push(home)
    const occupied = join(home, '.agent-presets', 'team-style')
    await mkdir(occupied, { recursive: true })
    await writeFile(join(occupied, PRESET_OWNER_MARKER), '{"app":"dsh-editor","schema":1,"plugin":"other-plugin"}')
    await expect(deployPluginPresets(home, 'team-plugin', dir)).rejects.toThrow('other-plugin')
    await rm(join(occupied, PRESET_OWNER_MARKER))
    await expect(deployPluginPresets(home, 'team-plugin', dir)).rejects.toThrow('冲突')
  })

  it('removes only the presets owned by the uninstalled plugin', async () => {
    const dir = await fixture(pluginFiles([{ id: 'team-style', path: 'agent-presets/team-style' }]))
    const home = await mkdtemp(join(tmpdir(), 'dsh-plugin-presets-home-'))
    roots.push(home)
    await deployPluginPresets(home, 'team-plugin', dir)
    const appOwned = join(home, '.agent-presets', 'dsh-editor-writing')
    await mkdir(appOwned, { recursive: true })
    await writeFile(join(appOwned, PRESET_OWNER_MARKER), '{"app":"dsh-editor","schema":1}')
    const otherOwned = join(home, '.agent-presets', 'other-preset')
    await mkdir(otherOwned, { recursive: true })
    await writeFile(join(otherOwned, PRESET_OWNER_MARKER), '{"app":"dsh-editor","schema":1,"plugin":"other-plugin"}')
    await removePluginPresets(home, 'team-plugin')
    expect(existsSync(join(home, '.agent-presets', 'team-style'))).toBe(false)
    expect(existsSync(appOwned)).toBe(true)
    expect(existsSync(otherOwned)).toBe(true)
  })
})
