import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { emptyPluginState } from './overlay.ts'
import type { PluginPaths } from './paths.ts'
import {
  CORE_WRITING_PRESET_ID,
  deployAppOwnedPreset,
  listWritingPresets,
  readCompositionPresets,
  removeAppOwnedPreset,
} from './writing-presets.ts'

async function fixture(): Promise<PluginPaths> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-writing-presets-'))
  const profileDir = join(home, 'profiles', 'dsh-editor')
  await mkdir(profileDir, { recursive: true })
  return {
    home,
    profile: 'dsh-editor',
    profileDir,
    stateFile: join(home, 'dsh-plugins.json'),
    patchFile: join(home, 'cordis.patch.yml'),
    userPluginsDir: join(home, 'user-plugins'),
  }
}

async function writePresetSource(dir: string, name = '小说创作', description = '面向长篇小说的写作搭档，按正文、大纲、人物卡与世界书分册推进。') {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'preset.yml'), `name: ${name}\ndescription: ${description}\n`)
  await writeFile(join(dir, 'agent.cordis.yml'), '[]\n')
}

async function declareNovel(paths: PluginPaths) {
  await writePresetSource(join(paths.profileDir, 'node_modules', 'dsh-editor-novel-kernel', 'presets', 'dsh-editor-novel'))
  await writeFile(join(paths.profileDir, 'composition.json'), JSON.stringify({
    id: 'desktop',
    presets: [{ id: 'dsh-editor-novel', packageName: 'dsh-editor-novel-kernel', path: 'presets/dsh-editor-novel' }],
  }))
}

describe('composition preset registry', () => {
  it('reads validated presets and fails closed on malformed rows', async () => {
    const paths = await fixture()
    expect(await readCompositionPresets(paths.profileDir)).toEqual([])
    await declareNovel(paths)
    expect(await readCompositionPresets(paths.profileDir)).toEqual([
      { id: 'dsh-editor-novel', packageName: 'dsh-editor-novel-kernel', path: 'presets/dsh-editor-novel' },
    ])
    await writeFile(join(paths.profileDir, 'composition.json'), JSON.stringify({
      presets: [{ id: '../evil', packageName: 'dsh-editor-novel-kernel', path: 'presets/x' }],
    }))
    expect(await readCompositionPresets(paths.profileDir)).toEqual([])
    await writeFile(join(paths.profileDir, 'composition.json'), JSON.stringify({
      presets: [{ id: 'dsh-editor-novel', packageName: 'dsh-editor-novel-kernel', path: '../escape' }],
    }))
    expect(await readCompositionPresets(paths.profileDir)).toEqual([])
  })
})

describe('writing preset inventory', () => {
  it('lists the locked core plus declared presets with toggle state', async () => {
    const paths = await fixture()
    await declareNovel(paths)
    await writePresetSource(join(paths.home, '.agent-presets', CORE_WRITING_PRESET_ID), '通用写作', '默认写作')
    const state = { ...emptyPluginState(), presets: { 'dsh-editor-novel': false } }
    const { presets } = await listWritingPresets(paths, state)
    expect(presets).toEqual([
      { id: 'dsh-editor-writing', title: '通用写作', description: '默认写作', enabled: true, locked: true },
      {
        id: 'dsh-editor-novel',
        title: '小说创作',
        description: '面向长篇小说的写作搭档，按正文、大纲、人物卡与世界书分册推进。',
        enabled: false,
        locked: false,
        packageName: 'dsh-editor-novel-kernel',
      },
    ])
  })
})

describe('app-owned preset deploy and removal', () => {
  it('deploys with an app-owned marker and removes only app-owned dirs', async () => {
    const paths = await fixture()
    const source = join(paths.profileDir, 'node_modules', 'dsh-editor-novel-kernel', 'presets', 'dsh-editor-novel')
    await writePresetSource(source)
    await deployAppOwnedPreset(paths.home, 'dsh-editor-novel', source)
    const target = join(paths.home, '.agent-presets', 'dsh-editor-novel')
    expect(await readFile(join(target, 'preset.yml'), 'utf8')).toContain('name: 小说创作')
    expect(JSON.parse(await readFile(join(target, '.dsh-editor-owner.json'), 'utf8'))).toEqual({ app: 'dsh-editor', schema: 1 })
    expect((await readdir(join(paths.home, '.agent-presets'))).some((name) => name.includes('.stage-') || name.includes('.backup-'))).toBe(false)
    await removeAppOwnedPreset(paths.home, 'dsh-editor-novel')
    expect(existsSync(target)).toBe(false)
    await removeAppOwnedPreset(paths.home, 'dsh-editor-novel')
  })

  it('refuses to touch plugin-owned or unmarked directories', async () => {
    const paths = await fixture()
    const source = join(paths.profileDir, 'pkg', 'presets', 'team-style')
    await writePresetSource(source, '团队风格')
    const target = join(paths.home, '.agent-presets', 'team-style')
    await mkdir(target, { recursive: true })
    await writeFile(join(target, 'preset.yml'), 'name: 旧\n')
    await expect(deployAppOwnedPreset(paths.home, 'team-style', source)).rejects.toThrow(/被占用/)
    await writeFile(join(target, '.dsh-editor-owner.json'), JSON.stringify({ app: 'dsh-editor', schema: 1, plugin: 'community-pack' }))
    await expect(deployAppOwnedPreset(paths.home, 'team-style', source)).rejects.toThrow(/被占用/)
    await expect(removeAppOwnedPreset(paths.home, 'team-style')).rejects.toThrow(/未删除/)
    expect(await readFile(join(target, 'preset.yml'), 'utf8')).toBe('name: 旧\n')
  })

  it('rejects a deploy whose source is incomplete', async () => {
    const paths = await fixture()
    const source = join(paths.profileDir, 'pkg', 'presets', 'empty')
    await mkdir(source, { recursive: true })
    await expect(deployAppOwnedPreset(paths.home, 'dsh-editor-novel', source)).rejects.toThrow(/安装源缺失/)
  })
})
