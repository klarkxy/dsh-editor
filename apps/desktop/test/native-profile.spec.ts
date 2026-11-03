import { lstat, mkdir, mkdtemp, readFile, readlink, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  copyRetargetedProfileTree,
  mergeNativeManifest,
  mergeProfilePatch,
  localFileSpec,
  nativeReuseLayoutReady,
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
      '- id: ui-layout\n  disabled: true\n- id: author-legacy\n  disabled: true\n',
      '- id: ui-plugin-manager\n  disabled: true\n- id: author-legacy\n  disabled: true\n- id: native-acceptance-legacy\n  disabled: true\n',
    )
    expect(merged).not.toMatch(/ui-plugin-manager/)
    expect(merged).toMatch(/native-acceptance-legacy/)
    expect(merged).toMatch(/author-legacy/)
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

  it('keeps new default artifacts, user replacement graphs, and config links', async () => {
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
    expect(existsSync(join(stage, 'bundled-packages', 'node_modules', removed, 'package.json'))).toBe(false)
    expect(await readFile(join(stage, 'profile-config', 'base.patch.yml'), 'utf8')).toBe('fresh-base\n')
    expect((await lstat(join(stage, 'node_modules', PROFILE_CONFIG_PACKAGE))).isSymbolicLink()).toBe(true)
    expect(await realpath(join(stage, 'node_modules', PROFILE_CONFIG_PACKAGE))).toBe(await realpath(join(stage, 'profile-config')))
    await writeFile(join(stage, 'node_modules', PROFILE_CONFIG_PACKAGE, 'presets.patch.json'), '[{"insert":[{"id":"live"}]}]\n')
    expect(await readFile(join(stage, 'profile-config', 'presets.patch.json'), 'utf8')).toBe('[{"insert":[{"id":"live"}]}]\n')
  })

  it('keeps staged links into the current runtime and still copies previous-only links', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-native-runtime-'))
    const oldRuntime = join(root, 'old-runtime', 'node_modules')
    const newRuntime = join(root, 'new-runtime', 'node_modules')
    const previous = join(root, 'previous')
    const stage = join(root, 'stage')
    const kind = process.platform === 'win32' ? 'junction' : 'dir'
    await writePackage(join(oldRuntime, '@deepseek-ai', 'dsh-x'), '@deepseek-ai/dsh-x', '0.1.0')
    await writePackage(join(oldRuntime, '@deepseek-ai', 'dsh-only-old'), '@deepseek-ai/dsh-only-old', '0.1.0')
    await writePackage(join(newRuntime, '@deepseek-ai', 'dsh-x'), '@deepseek-ai/dsh-x', '0.2.0')
    for (const profile of [previous, stage]) {
      await mkdir(join(profile, 'node_modules', '@deepseek-ai'), { recursive: true })
      await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'dsh-editor-profile', dependencies: {}, dsh: { profile: { bundles: [] } } }))
    }
    await symlink(join(oldRuntime, '@deepseek-ai', 'dsh-x'), join(previous, 'node_modules', '@deepseek-ai', 'dsh-x'), kind)
    await symlink(join(oldRuntime, '@deepseek-ai', 'dsh-only-old'), join(previous, 'node_modules', '@deepseek-ai', 'dsh-only-old'), kind)
    await symlink(join(newRuntime, '@deepseek-ai', 'dsh-x'), join(stage, 'node_modules', '@deepseek-ai', 'dsh-x'), kind)
    await preserveNativeProfileState(previous, stage, { runtimeNodeModules: newRuntime })
    expect(JSON.parse(await readFile(join(stage, 'node_modules', '@deepseek-ai', 'dsh-x', 'package.json'), 'utf8')).version).toBe('0.2.0')
    const carried = join(stage, 'node_modules', '@deepseek-ai', 'dsh-only-old')
    expect((await lstat(carried)).isSymbolicLink()).toBe(true)
    expect(JSON.parse(await readFile(join(carried, 'package.json'), 'utf8')).version).toBe('0.1.0')
  })

  it('retains only bundled artifacts still referenced by merged deps, transitively', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-native-retained-'))
    const previous = join(root, 'previous')
    const stage = join(root, 'stage')
    const bundled = join(previous, 'bundled-packages', 'node_modules')
    for (const name of ['retained-a', 'retained-b', 'orphan', 'dsh-proofread']) {
      await writePackage(join(bundled, name), name, '1.0.0')
    }
    await writeFile(join(bundled, 'retained-a', 'package.json'), JSON.stringify({
      name: 'retained-a',
      version: '1.0.0',
      dependencies: { 'retained-b': 'link:../retained-b' },
    }))
    await writeFile(join(previous, 'package.json'), JSON.stringify({
      name: 'dsh-editor-profile',
      dependencies: {
        'retained-a': 'link:./bundled-packages/node_modules/retained-a',
        'dsh-proofread': 'link:./bundled-packages/node_modules/dsh-proofread',
      },
      dsh: { profile: { bundles: [] } },
    }))
    await writeFile(join(previous, 'composition.json'), JSON.stringify({ packages: [], nativeDependencies: {} }))
    await mkdir(stage, { recursive: true })
    await writeFile(join(stage, 'package.json'), JSON.stringify({ name: 'dsh-editor-profile', dependencies: {}, dsh: { profile: { bundles: [] } } }))
    await preserveNativeProfileState(previous, stage)
    const staged = join(stage, 'bundled-packages', 'node_modules')
    expect(existsSync(join(staged, 'retained-a', 'package.json'))).toBe(true)
    expect(existsSync(join(staged, 'retained-b', 'package.json'))).toBe(true)
    expect(existsSync(join(staged, 'orphan'))).toBe(false)
    expect(existsSync(join(staged, 'dsh-proofread'))).toBe(false)
  })

  it('drops top-level links to packages the current runtime no longer ships', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-native-stale-'))
    const oldRuntime = join(root, 'old-runtime', 'node_modules')
    const newRuntime = join(root, 'new-runtime', 'node_modules')
    const previous = join(root, 'previous')
    const stage = join(root, 'stage')
    const kind = process.platform === 'win32' ? 'junction' : 'dir'
    await writePackage(join(oldRuntime, '@deepseek-ai', 'dsh-gone'), '@deepseek-ai/dsh-gone', '0.1.0')
    await writePackage(join(oldRuntime, '@deepseek-ai', 'dsh-kept'), '@deepseek-ai/dsh-kept', '0.1.0')
    await writePackage(join(newRuntime, '@deepseek-ai', 'dsh-kept'), '@deepseek-ai/dsh-kept', '0.2.0')
    await mkdir(join(previous, 'runtime-links', 'node_modules', '@deepseek-ai'), { recursive: true })
    await mkdir(join(previous, 'node_modules', '@deepseek-ai'), { recursive: true })
    for (const pkg of ['dsh-gone', 'dsh-kept']) {
      await symlink(join(oldRuntime, '@deepseek-ai', pkg), join(previous, 'runtime-links', 'node_modules', '@deepseek-ai', pkg), kind)
      await symlink(join(oldRuntime, '@deepseek-ai', pkg), join(previous, 'node_modules', '@deepseek-ai', pkg), kind)
    }
    await mkdir(join(stage, 'node_modules', '@deepseek-ai'), { recursive: true })
    await symlink(join(newRuntime, '@deepseek-ai', 'dsh-kept'), join(stage, 'node_modules', '@deepseek-ai', 'dsh-kept'), kind)
    await writeFile(join(previous, 'package.json'), JSON.stringify({ name: 'dsh-editor-profile', dependencies: {}, dsh: { profile: { bundles: [] } } }))
    await writeFile(join(stage, 'package.json'), JSON.stringify({ name: 'dsh-editor-profile', dependencies: {}, dsh: { profile: { bundles: [] } } }))
    await preserveNativeProfileState(previous, stage, { runtimeNodeModules: newRuntime })
    expect(existsSync(join(stage, 'node_modules', '@deepseek-ai', 'dsh-gone'))).toBe(false)
    expect(JSON.parse(await readFile(join(stage, 'node_modules', '@deepseek-ai', 'dsh-kept', 'package.json'), 'utf8')).version).toBe('0.2.0')
  })
})

describe('native reuse layout', () => {
  it('restages when a top-level node_modules link resolves outside the current runtime', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-native-reuse-'))
    const template = join(root, 'template')
    const profile = join(root, 'profile')
    const runtime = join(root, 'runtime', 'node_modules')
    const oldRuntime = join(root, 'old-runtime', 'node_modules')
    const name = '@deepseek-ai/dsh-runtime-dep'
    const kind = process.platform === 'win32' ? 'junction' : 'dir'
    await mkdir(template, { recursive: true })
    await writeFile(join(template, 'composition.json'), JSON.stringify({ packages: [], nativeDependencies: {} }))
    await mkdir(profile, { recursive: true })
    await writeFile(join(profile, 'composition.json'), JSON.stringify({ packages: [], nativeDependencies: {} }))
    await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'dsh-editor-profile', dependencies: {}, dsh: { profile: { bundles: [] } } }))
    const runtimePackage = join(runtime, '@deepseek-ai', 'dsh-runtime-dep')
    const oldPackage = join(oldRuntime, '@deepseek-ai', 'dsh-runtime-dep')
    await writePackage(runtimePackage, name, '0.2.0')
    await writePackage(oldPackage, name, '0.1.0')
    const runtimeLink = join(profile, 'runtime-links', 'node_modules', '@deepseek-ai', 'dsh-runtime-dep')
    await mkdir(dirname(runtimeLink), { recursive: true })
    await symlink(runtimePackage, runtimeLink, kind)
    const top = join(profile, 'node_modules', '@deepseek-ai', 'dsh-runtime-dep')
    await mkdir(dirname(top), { recursive: true })
    await symlink(runtimePackage, top, kind)
    expect(await nativeReuseLayoutReady(profile, template, runtime)).toBe('ready')
    await rm(top, { recursive: true, force: true })
    await symlink(oldPackage, top, kind)
    expect(await nativeReuseLayoutReady(profile, template, runtime)).toBe('restage')
    await rm(top, { recursive: true, force: true })
    await mkdir(top, { recursive: true })
    expect(await nativeReuseLayoutReady(profile, template, runtime)).toBe('ready')
  })
})

describe('retargeted profile tree copy', () => {
  it('retargets a directory link that points at another in-tree link', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-native-hop-'))
    const source = join(root, 'source')
    const dest = join(root, 'dest')
    const real = join(source, 'real')
    await mkdir(real, { recursive: true })
    await writeFile(join(real, 'payload.txt'), 'link-hop')
    const kind = process.platform === 'win32' ? 'junction' : 'dir'
    await symlink(real, join(source, 'hop1'), kind)
    await mkdir(join(source, 'nested'), { recursive: true })
    await symlink(join(source, 'hop1'), join(source, 'nested', 'hop2'), kind)

    await copyRetargetedProfileTree(source, dest)

    const hop2 = join(dest, 'nested', 'hop2')
    expect((await lstat(hop2)).isSymbolicLink()).toBe(true)
    expect(await readFile(join(hop2, 'payload.txt'), 'utf8')).toBe('link-hop')
    const rawTarget = await readlink(hop2)
    const resolved = isAbsolute(rawTarget) ? rawTarget : resolve(dirname(hop2), rawTarget)
    expect(resolved).toBe(join(dest, 'hop1'))
  })
})

async function writePackage(dir: string, name: string, version: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name, version, dsh: { bundle: { patch: './cordis.patch.yml' } } }))
}
