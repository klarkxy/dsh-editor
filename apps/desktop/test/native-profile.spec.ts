import { lstat, mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  mergeNativeManifest,
  mergeProfilePatch,
  localFileSpec,
  preserveNativeProfileState,
  selectedPresetOwners,
  PROFILE_CONFIG_PACKAGE,
  PROFILE_CONFIG_SPEC,
  REQUIRED_CORE_BUNDLES,
  type ProfileManifest,
} from '../src/native-profile.js'
import { PINNED_PNPM_CLI_FLAGS, PINNED_PNPM_VERSION, assertPinnedPnpm, resolveBundledPackageManager, resolveDesktopPnpmPackage } from '../src/package-manager.js'

const optional = 'dsh-editor-cards'
const replacement = 'dsh-acceptance-replacement'
const removed = '@klarkxy/dsh-web-search-manager'
const shipped = 'dsh-acceptance-shipped-new'
const baselineSpec = (name: string) => `link:./bundled-packages/node_modules/${name}`

describe('native profile merge', () => {
  it('keeps extra file specs, previous selection, and new shipped defaults', () => {
    const merged = mergeNativeManifest({
      dependencies: { 'dsh-editor-shell': 'file:./shell', 'dsh-acceptance-shipped-new': 'file:./shipped' },
      dsh: { profile: { bundles: ['dsh-editor-shell', 'dsh-acceptance-shipped-new'] } },
    }, {
      dependencies: { 'dsh-editor-shell': 'file:./shell', 'dsh-acceptance-added': 'file:../../user-plugins/added', leftover: '*' },
      dsh: { profile: { bundles: ['dsh-editor-shell'] } },
    }, {
      templatePackages: ['dsh-editor-shell', 'dsh-acceptance-shipped-new'],
      previousPackages: ['dsh-editor-shell'],
    })
    expect(merged.dependencies?.['dsh-acceptance-added']).toBe('file:../../user-plugins/added')
    expect(merged.dependencies).not.toHaveProperty('leftover')
    expect(merged.dsh?.profile?.bundles).toEqual(expect.arrayContaining(['dsh-editor-shell', 'dsh-acceptance-shipped-new']))
    expect(merged.dsh?.profile?.bundles).not.toContain('dsh-acceptance-added')
  })

  it('upgrades matching baseline specs, preserves overrides, removals, disabled selection, and restored core', () => {
    expect(REQUIRED_CORE_BUNDLES.has(PROFILE_CONFIG_PACKAGE)).toBe(true)
    const previousBaseline = {
      'dsh-editor-shell': baselineSpec('dsh-editor-shell'),
      [PROFILE_CONFIG_PACKAGE]: PROFILE_CONFIG_SPEC,
      [optional]: baselineSpec(optional),
      [removed]: baselineSpec(removed),
      leftover: baselineSpec('leftover'),
    }
    const templateBaseline = {
      'dsh-editor-shell': baselineSpec('dsh-editor-shell'),
      [PROFILE_CONFIG_PACKAGE]: PROFILE_CONFIG_SPEC,
      [optional]: baselineSpec(optional),
      [shipped]: baselineSpec(shipped),
    }
    const merged = mergeNativeManifest({
      dependencies: templateBaseline,
      dsh: { profile: { bundles: ['dsh-editor-shell', PROFILE_CONFIG_PACKAGE, optional, shipped] } },
    }, {
      dependencies: {
        'dsh-editor-shell': baselineSpec('dsh-editor-shell'),
        [PROFILE_CONFIG_PACKAGE]: 'link:./stale-config',
        [optional]: `file:./${replacement}`,
        community: 'file:../../user-plugins/community',
      },
      dsh: { profile: { bundles: ['dsh-editor-shell', PROFILE_CONFIG_PACKAGE, optional] } },
    }, { templateBaseline, previousBaseline })
    expect(merged.dependencies?.['dsh-editor-shell']).toBe(baselineSpec('dsh-editor-shell'))
    expect(merged.dependencies?.[PROFILE_CONFIG_PACKAGE]).toBe(PROFILE_CONFIG_SPEC)
    expect(merged.dependencies?.[optional]).toBe(`file:./${replacement}`)
    expect(merged.dependencies?.[shipped]).toBe(baselineSpec(shipped))
    expect(merged.dependencies?.community).toBe('file:../../user-plugins/community')
    expect(merged.dependencies).not.toHaveProperty(removed)
    expect(merged.dependencies).not.toHaveProperty('leftover')
    expect(merged.dsh?.profile?.bundles).toEqual(expect.arrayContaining([
      'dsh-editor-shell', PROFILE_CONFIG_PACKAGE, optional, shipped,
    ]))
    expect(merged.dsh?.profile?.bundles).not.toContain(removed)
  })

  it('does not recreate a removed optional that still ships in the new baseline', () => {
    const previousBaseline = { [optional]: baselineSpec(optional), 'dsh-editor-shell': baselineSpec('dsh-editor-shell') }
    const templateBaseline = { ...previousBaseline, [shipped]: baselineSpec(shipped) }
    const merged = mergeNativeManifest({
      dependencies: templateBaseline,
      dsh: { profile: { bundles: ['dsh-editor-shell', optional, shipped] } },
    }, {
      dependencies: { 'dsh-editor-shell': baselineSpec('dsh-editor-shell') },
      dsh: { profile: { bundles: ['dsh-editor-shell'] } },
    }, { templateBaseline, previousBaseline })
    expect(merged.dependencies).not.toHaveProperty(optional)
    expect(merged.dsh?.profile?.bundles).not.toContain(optional)
    expect(merged.dependencies?.[shipped]).toBe(baselineSpec(shipped))
  })

  it('keeps official template selection on first deploy, seeds a prior omitted optional without selecting it, and retains native fields', () => {
    const voice = '@deepseek-ai/dsh-experimental-voice-input-bundle'
    const template = {
      name: 'dsh-editor-profile',
      type: 'module',
      dependencies: {
        'dsh-editor-shell': baselineSpec('dsh-editor-shell'),
        [optional]: baselineSpec(optional),
        [shipped]: baselineSpec(shipped),
      },
      dsh: { profile: { bundles: ['dsh-editor-shell', optional, shipped, voice], patchReload: 'startup' } },
    }
    const fresh = mergeNativeManifest(template as ProfileManifest, undefined)
    expect(fresh.dsh?.profile?.bundles).toEqual(expect.arrayContaining(['dsh-editor-shell', optional, shipped, voice]))
    expect(fresh).toMatchObject({ name: 'dsh-editor-profile', type: 'module' })
    expect(fresh.dsh?.profile).toMatchObject({ patchReload: 'startup' })

    const previous = {
      name: 'old-profile',
      authorKey: 'keep',
      dependencies: {},
      dsh: { session: 'keep', profile: { bundles: ['dsh-editor-shell'], nestedFlag: true } },
    }
    const legacy = mergeNativeManifest(template as ProfileManifest, previous as ProfileManifest, {
      previousPackages: ['dsh-editor-shell', optional],
    })
    expect(legacy.dependencies?.[optional]).toBe(baselineSpec(optional))
    expect(legacy.dependencies?.[shipped]).toBe(baselineSpec(shipped))
    expect(legacy.dsh?.profile?.bundles).toContain('dsh-editor-shell')
    expect(legacy.dsh?.profile?.bundles).toContain(shipped)
    expect(legacy.dsh?.profile?.bundles).not.toContain(optional)
    expect(legacy.dsh?.profile?.bundles).not.toContain(voice)
    expect(legacy).toMatchObject({ name: 'dsh-editor-profile', type: 'module', authorKey: 'keep' })
    expect(legacy.dsh).toMatchObject({ session: 'keep', profile: { nestedFlag: true, patchReload: 'startup' } })
  })

  it('selects native extras in official namespaces and ignores finite host packages', () => {
    const owners = selectedPresetOwners([
      'dsh-editor-shell',
      'dsh-editor-cards',
      'dsh-editor-extra',
      '@deepseek-ai/dsh-acceptance-extra',
      '@deepseek-ai/dsh-base',
      '@klarkxy/dsh-memory',
      'community-theme',
      '../evil',
    ], ['dsh-editor-shell', 'dsh-editor-cards'])
    expect([...owners].sort()).toEqual([
      '@deepseek-ai/dsh-acceptance-extra',
      'community-theme',
      'dsh-editor-extra',
    ])
    expect(owners.has('dsh-editor-shell')).toBe(false)
    expect(owners.has('dsh-editor-cards')).toBe(false)
    expect(owners.has('@deepseek-ai/dsh-base')).toBe(false)
    expect(owners.has('@klarkxy/dsh-memory')).toBe(false)
    expect(REQUIRED_CORE_BUNDLES.has('dsh-editor-shell')).toBe(true)
  })

  it('does not keep a previously disabled ui-plugin-manager row', () => {
    const merged = mergeProfilePatch(
      '- id: ui-layout\n  disabled: true\n- id: proofread\n  disabled: true\n',
      '- id: ui-plugin-manager\n  disabled: true\n- id: proofread\n  disabled: true\n- id: native-acceptance-legacy\n  disabled: true\n',
    )
    expect(merged).not.toMatch(/ui-plugin-manager/)
    expect(merged).toMatch(/native-acceptance-legacy/)
    expect(merged).toMatch(/proofread/)
  })

  it('keeps executable tags, anchors and author comments from the previous patch', () => {
    const previous = '# author config and shared anchor\n- id: fixture\n  config: &shared\n    evaluator: !!js |\n      ({ fixture: true })\n- id: reference\n  config: *shared\n'
    const merged = mergeProfilePatch('[]\n', previous)
    expect(merged).toContain('!!js')
    expect(merged).toContain('&shared')
    expect(merged).toContain('*shared')
    expect(merged).toContain('# author config and shared anchor')
  })

  it('writes a relative file spec instead of a star', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-native-spec-'))
    const profile = join(root, 'profiles', 'dsh-editor')
    const plugin = join(root, 'user-plugins', 'legacy')
    await mkdir(profile, { recursive: true })
    await mkdir(plugin, { recursive: true })
    expect(localFileSpec(profile, plugin)).toBe('file:../../user-plugins/legacy')
    expect(localFileSpec(profile, plugin)).not.toBe('*')
  })
})

describe('pinned desktop pnpm', () => {
  it('resolves the workspace alias to pnpm 11.7.0', () => {
    const root = resolveDesktopPnpmPackage()
    assertPinnedPnpm(root)
    expect(PINNED_PNPM_VERSION).toBe('11.7.0')
  })

  it('places the documented --pm-on-fail flag after the pinned entry', () => {
    const manager = resolveBundledPackageManager(process.execPath)
    expect(PINNED_PNPM_CLI_FLAGS).toEqual(['--pm-on-fail=ignore'])
    expect(manager.args.at(-1)).toBe('--pm-on-fail=ignore')
    expect(manager.args.some((argument) => argument.includes('pnpm'))).toBe(true)
    const entry = manager.args.findIndex((argument) => argument.includes('pnpm'))
    expect(manager.args.slice(entry + 1)).toEqual(['--pm-on-fail=ignore'])
  })
})

describe('preserved native module links', () => {
  it('retargets internal virtual-store junctions onto the staged graph', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-native-links-'))
    const previous = join(root, 'previous')
    const stage = join(root, 'stage')
    const name = 'dsh-acceptance-script-dependency'
    const store = join(previous, 'node_modules', '.pnpm', `${name}@0.1.0`, 'node_modules', name)
    await mkdir(store, { recursive: true })
    await writeFile(join(store, 'built.flag'), 'explicit-approval')
    await writeFile(join(previous, 'package.json'), JSON.stringify({ name: 'dsh-editor-profile', dependencies: { [name]: 'file:./dep' }, dsh: { profile: { bundles: [] } } }))
    await mkdir(join(previous, 'node_modules'), { recursive: true })
    await symlink(store, join(previous, 'node_modules', name), process.platform === 'win32' ? 'junction' : 'dir')
    await mkdir(join(stage, 'node_modules'), { recursive: true })
    await writeFile(join(stage, 'package.json'), JSON.stringify({ name: 'dsh-editor-profile', dependencies: {}, dsh: { profile: { bundles: [] } } }))
    await preserveNativeProfileState(previous, stage)
    await writeFile(join(store, 'built.flag'), 'stale-previous')
    expect(await readFile(join(stage, 'node_modules', name, 'built.flag'), 'utf8')).toBe('explicit-approval')
    expect(existsSync(join(stage, 'node_modules', '.pnpm', `${name}@0.1.0`, 'node_modules', name, 'built.flag'))).toBe(true)
  })

  it('keeps new default artifacts, user replacement graphs, retained artifacts, and config links', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-native-overlay-'))
    const previous = join(root, 'previous')
    const stage = join(root, 'stage')
    const previousBaseline = {
      'dsh-editor-shell': baselineSpec('dsh-editor-shell'),
      [PROFILE_CONFIG_PACKAGE]: PROFILE_CONFIG_SPEC,
      [optional]: baselineSpec(optional),
      [removed]: baselineSpec(removed),
    }
    const templateBaseline = {
      'dsh-editor-shell': baselineSpec('dsh-editor-shell'),
      [PROFILE_CONFIG_PACKAGE]: PROFILE_CONFIG_SPEC,
      [optional]: baselineSpec(optional),
    }
    await writePackage(join(previous, 'bundled-packages', 'node_modules', 'dsh-editor-shell'), 'dsh-editor-shell', '0.1.0')
    await writePackage(join(previous, 'bundled-packages', 'node_modules', optional), optional, '0.1.0')
    await writePackage(join(previous, 'bundled-packages', 'node_modules', removed), removed, '0.1.0')
    await writePackage(join(previous, 'node_modules', 'dsh-editor-shell'), 'dsh-editor-shell', '0.1.0')
    await writePackage(join(previous, 'node_modules', optional), optional, '9.9.9')
    await writePackage(join(previous, 'node_modules', removed), removed, '0.1.0')
    await mkdir(join(previous, 'profile-config'), { recursive: true })
    await writeFile(join(previous, 'profile-config', 'package.json'), JSON.stringify({ name: PROFILE_CONFIG_PACKAGE, dsh: { bundle: { patch: './base.patch.yml' } } }))
    await writeFile(join(previous, 'profile-config', 'base.patch.yml'), 'old-base\n')
    await writeFile(join(previous, 'package.json'), JSON.stringify({
      dependencies: {
        'dsh-editor-shell': baselineSpec('dsh-editor-shell'),
        [PROFILE_CONFIG_PACKAGE]: PROFILE_CONFIG_SPEC,
        [optional]: 'file:./replacement-cards',
      },
      dsh: { profile: { bundles: ['dsh-editor-shell', PROFILE_CONFIG_PACKAGE, optional] } },
    }))
    await writeFile(join(previous, 'composition.json'), JSON.stringify({ packages: ['dsh-editor-shell', optional, removed], nativeDependencies: previousBaseline }))
    await writePackage(join(stage, 'bundled-packages', 'node_modules', 'dsh-editor-shell'), 'dsh-editor-shell', '2.0.0')
    await writePackage(join(stage, 'bundled-packages', 'node_modules', optional), optional, '2.0.0')
    await writePackage(join(stage, 'node_modules', 'dsh-editor-shell'), 'dsh-editor-shell', '2.0.0')
    await writePackage(join(stage, 'node_modules', optional), optional, '2.0.0')
    await writePackage(join(stage, 'node_modules', removed), removed, '2.0.0')
    await mkdir(join(stage, 'profile-config'), { recursive: true })
    await writeFile(join(stage, 'profile-config', 'package.json'), JSON.stringify({ name: PROFILE_CONFIG_PACKAGE, dsh: { bundle: { patch: ['./base.patch.yml', './presets.patch.json'] } } }))
    await writeFile(join(stage, 'profile-config', 'base.patch.yml'), 'fresh-base\n')
    await writeFile(join(stage, 'profile-config', 'presets.patch.json'), '[]\n')
    await writeFile(join(stage, 'package.json'), JSON.stringify({
      dependencies: templateBaseline,
      dsh: { profile: { bundles: ['dsh-editor-shell', PROFILE_CONFIG_PACKAGE, optional] } },
    }))
    await writeFile(join(stage, 'composition.json'), JSON.stringify({ packages: ['dsh-editor-shell', optional], nativeDependencies: templateBaseline }))
    await preserveNativeProfileState(previous, stage)
    expect(JSON.parse(await readFile(join(stage, 'bundled-packages', 'node_modules', 'dsh-editor-shell', 'package.json'), 'utf8')).version).toBe('2.0.0')
    expect(JSON.parse(await readFile(join(stage, 'node_modules', 'dsh-editor-shell', 'package.json'), 'utf8')).version).toBe('2.0.0')
    expect(JSON.parse(await readFile(join(stage, 'node_modules', optional, 'package.json'), 'utf8')).version).toBe('9.9.9')
    expect(existsSync(join(stage, 'node_modules', removed))).toBe(false)
    expect(existsSync(join(stage, 'bundled-packages', 'node_modules', removed, 'package.json'))).toBe(true)
    expect(await readFile(join(stage, 'profile-config', 'base.patch.yml'), 'utf8')).toBe('fresh-base\n')
    expect((await lstat(join(stage, 'node_modules', PROFILE_CONFIG_PACKAGE))).isSymbolicLink()).toBe(true)
    expect(await realpath(join(stage, 'node_modules', PROFILE_CONFIG_PACKAGE))).toBe(await realpath(join(stage, 'profile-config')))
    await writeFile(join(stage, 'node_modules', PROFILE_CONFIG_PACKAGE, 'presets.patch.json'), '[{"insert":[{"id":"live"}]}]\n')
    expect(await readFile(join(stage, 'profile-config', 'presets.patch.json'), 'utf8')).toBe('[{"insert":[{"id":"live"}]}]\n')
  })
})

async function writePackage(dir: string, name: string, version: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name, version, dsh: { bundle: { patch: './cordis.patch.yml' } } }))
}
