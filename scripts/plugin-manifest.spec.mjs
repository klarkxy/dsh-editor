import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  BASE_BUNDLES,
  catalogFromManifests,
  clientPackages,
  corePackageNames,
  desktopCopiedPackageNames,
  desktopPackageNames,
  loadPluginManifests,
  loadWorkspaceLibraries,
  publicPackages,
  resolveComposition,
} from './plugin-manifest.mjs'
import { DEFAULT_OFF_OFFICIAL_ENTRIES, desktopComposition, nativeDependencyBaseline, PROFILE_CONFIG_PACKAGE, applyDistributionManifestFacets } from './desktop-compositions.mjs'
import { packageCopyFilter } from './package-copy.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const optionalPublicPackages = new Set(['current-title', 'mood', 'recap', 'zhihu'].map(name => '@klarkxy/dsh-' + name))
const retiredPackages = ['ai-services', 'model-center', 'memory', 'self-improvement', 'fusion'].map(name => '@klarkxy/dsh-' + name)
/** Official entries the app manages itself, so they are not part of the first-party capability set. */
const officialEntries = new Set(DEFAULT_OFF_OFFICIAL_ENTRIES)

describe('desktop dev prepare', () => {
  it('uses a single runtime writer for Editor plugin switches', () => {
    const profile = JSON.parse(readFileSync(resolve(root, 'apps/desktop/resources/profile/package.json'), 'utf8'))
    expect(profile.dsh.profile.patchReload).toBe('startup')
  })

  it('copies projected app packages into the template and keeps the DSH runtime free of them', () => {
    const prepare = readFileSync(resolve(root, 'scripts/prepare-desktop-dev.mjs'), 'utf8')
    expect(prepare).toContain('projectProfileArtifacts')
    expect(prepare).toContain('removeAppPackagesFromRuntime')
    expect(prepare).not.toContain("await symlink(source, destination, 'junction')")
    const compositions = readFileSync(resolve(root, 'scripts/desktop-compositions.mjs'), 'utf8')
    expect(compositions).toContain('copyNativePackageArtifact')
    expect(compositions).toContain('bundled-packages/node_modules')
    expect(compositions).toContain("'runtime-links', 'node_modules'")
    expect(compositions).toContain('nativeDependencies')
    expect(compositions).toContain('link:./bundled-packages/node_modules/')
    expect(compositions).toContain('link:./profile-config')
    const runtime = readFileSync(resolve(root, 'scripts/prepare-desktop-runtime.mjs'), 'utf8')
    expect(runtime).toContain('projectProfileArtifacts')
    expect(runtime).toContain('removeAppPackagesFromRuntime')
    expect(runtime).toContain("await rename(resolve(dshOutput, 'node_modules'), resolve(dshOutput, 'vendor-dependencies'))")
    expect(runtime).toContain("await rename(resolve(profileOutput, 'node_modules'), resolve(profileOutput, 'vendor-dependencies'))")
    expect(runtime).toContain("await rename(resolve(profileOutput, 'bundled-packages', 'node_modules'), resolve(profileOutput, 'bundled-packages', 'vendor-dependencies'))")
    const afterPack = readFileSync(resolve(root, 'scripts/after-pack-desktop.cjs'), 'utf8')
    expect(afterPack).toContain("profile-template', 'bundled-packages', 'vendor-dependencies'")
    const source = resolve(root, 'node_modules/@klarkxy/dsh-web-search-manager')
    const filter = packageCopyFilter(source, { omitMaps: true })
    expect(filter(source)).toBe(true)
    expect(filter(resolve(source, 'lib/client.js'))).toBe(true)
    expect(filter(resolve(source, 'lib/client.js.map'))).toBe(false)
    expect(filter(resolve(source, 'src/client.tsx'))).toBe(false)
    const dev = readFileSync(resolve(root, 'scripts/dev.mjs'), 'utf8')
    expect(dev).toContain('reusing existing package builds')
    expect(dev).toContain('DSH_DEV_FORCE_BUILD')
    expect(dev).toContain('killLeftoverDevProcesses')
    expect(dev).toContain('waitForFirstCompile')
    expect(dev).toContain('DSH_DESKTOP_USER_DATA_DIR')
    expect(dev).toContain('FIRST_COMPILE_MS')
    expect(dev).toContain('sync-desktop-dev-package.mjs')
    expect(dev).toContain('workspacePackageDir(name)')
  })
})

describe('plugin manifests and composition resolver', () => {
  const manifests = loadPluginManifests(root)

  it('loads the product packages with unique entry ids', () => {
    expect(desktopPackageNames(manifests)).toEqual([
      'dsh-manuscript',
      'dsh-proofread',
      'dsh-editor-workbench',
      'dsh-editor-novel-kernel',
      'dsh-editor-writing-presets',
      'dsh-editor-shell',
      'dsh-editor-plugins',
      'dsh-editor-cards',
      'dsh-editor-memory-panel',
      'dsh-editor-overview-panel',
      'dsh-editor-proofread-panel',
      '@klarkxy/dsh-web-search-manager',
    ])
    expect(publicPackages(manifests)).toEqual(['dsh-manuscript', 'dsh-proofread', '@klarkxy/dsh-web-search-manager'])
    expect(corePackageNames(manifests)).toEqual([
      'dsh-manuscript',
      'dsh-editor-workbench',
      'dsh-editor-shell',
      'dsh-editor-plugins',
    ])
    expect(clientPackages(manifests)).toEqual([
      'dsh-manuscript',
      'dsh-proofread',
      'dsh-editor-shell',
      'dsh-editor-plugins',
      'dsh-editor-cards',
      'dsh-editor-memory-panel',
      'dsh-editor-overview-panel',
      'dsh-editor-proofread-panel',
      '@klarkxy/dsh-web-search-manager',
    ])
    expect(catalogFromManifests(manifests)['zhihu-tools']).toBeUndefined()
    expect(loadWorkspaceLibraries(root).map((item) => item.name)).toEqual(['dsh-editor-seats', 'dsh-editor-workspace-kit'])
    // The resolver preserves the established desktop/library order, then appends new packages.
    expect(desktopCopiedPackageNames(manifests)).toEqual([
      ...desktopPackageNames(manifests).filter((name) => !name.includes('dsh-web-search-')),
      'dsh-editor-seats',
      'dsh-editor-workspace-kit',
      '@klarkxy/dsh-web-search-manager',
    ])
  })

  it('drops dsh-manuscript client autoactivation on the desktop copy while keeping public exports and the source package', () => {
    const sourcePath = resolve(root, 'packages/dsh-manuscript/package.json')
    const original = readFileSync(sourcePath, 'utf8')
    const source = JSON.parse(original)
    expect(source.dsh.client.platform).toBe('web')
    const copied = applyDistributionManifestFacets('dsh-manuscript', JSON.parse(original))
    expect(copied.dsh.client).toBeUndefined()
    expect(copied.dsh.bundle).toEqual(source.dsh.bundle)
    expect(copied.main).toBe(source.main)
    expect(copied.exports['./client']).toEqual(source.exports['./client'])
    expect(copied.exports['./client/editor-core']).toEqual(source.exports['./client/editor-core'])
    expect(copied.files).toEqual(source.files)
    expect(applyDistributionManifestFacets('dsh-editor-shell', { dsh: { client: { platform: 'web' } } }).dsh.client).toEqual({ platform: 'web' })
    expect(readFileSync(sourcePath, 'utf8')).toBe(original)
    expect(clientPackages(manifests)).toContain('dsh-manuscript')
    const compositions = readFileSync(resolve(root, 'scripts/desktop-compositions.mjs'), 'utf8')
    expect(compositions).toContain('applyDistributionManifestFacets(name, projected)')
  })

  it('resolves desktop and the basic/smart/full aliases as one capability set, differing only by id and label', async () => {
    const labels = { desktop: '桌面写作', basic: '基础写作', smart: '智能写作', full: '智能写作与资料' }
    const panels = ['dsh-editor-cards', 'dsh-editor-memory-panel', 'dsh-editor-overview-panel', 'dsh-editor-proofread-panel']
    const core = ['dsh-manuscript', 'dsh-proofread', 'dsh-editor-workbench']
    const tail = ['dsh-editor-shell', 'dsh-editor-plugins', ...panels, '@klarkxy/dsh-web-search-manager']
    const packages = [...core, 'dsh-editor-novel-kernel', 'dsh-editor-writing-presets', ...tail]
    const capability = {
      features: ['assistant', 'completion', 'overview-panel', 'proofread-panel', 'writing-presets', 'web-search'],
      packages,
      libraries: ['dsh-editor-seats', 'dsh-editor-workspace-kit'],
      runtimeDependencies: ['@deepseek-ai/dsh-web-search-exa', '@klarkxy/dsh-plugin-kit', 'react'],
      disabledEntries: ['editor-cards', 'editor-memory-panel'],
      extraInserts: [],
      shellFeatures: { assistant: 'sessions', completion: 'manuscriptAssist', 'web-search': 'webSearchManager' },
      presets: [
        { id: 'dsh-editor-article', packageName: 'dsh-editor-writing-presets', path: 'presets/dsh-editor-article' },
        { id: 'dsh-editor-novel', packageName: 'dsh-editor-novel-kernel', path: 'presets/dsh-editor-novel' },
        { id: 'dsh-editor-technical', packageName: 'dsh-editor-writing-presets', path: 'presets/dsh-editor-technical' },
      ],
      bundles: [...BASE_BUNDLES, ...packages],
    }

    const resolved = await Promise.all(Object.keys(labels).map((id) => desktopComposition(id)))
    for (const item of resolved) {
      expect(item.id in labels).toBe(true)
      expect(item.label).toBe(labels[item.id])
      const { id: _id, label: _label, ...rest } = item
      expect({ ...rest, packages: rest.packages, bundles: rest.bundles, disabledEntries: rest.disabledEntries.filter(id => !officialEntries.has(id)) }).toEqual(capability)
    }
    const stripped = resolved.map(({ id: _id, label: _label, ...rest }) => rest)
    for (let index = 1; index < stripped.length; index += 1) {
      expect(stripped[index]).toEqual(stripped[0])
    }
    expect(capability.features).toContain('proofread-panel')
    expect(capability.features).not.toContain('cards')
    expect(capability.features).not.toContain('memory-panel')
    expect(capability.packages).toContain('dsh-editor-novel-kernel')
    expect(capability.packages).toContain('dsh-editor-writing-presets')
    expect(capability.packages).toContain('dsh-editor-proofread-panel')
    expect(capability.packages).toContain('dsh-editor-cards')
    expect(capability.packages).toContain('dsh-editor-memory-panel')
    expect(capability.disabledEntries).toEqual(['editor-cards', 'editor-memory-panel'])
    expect(capability.extraInserts.map((row) => row.id)).not.toContain('editor-workbench-tools')
    expect(capability.extraInserts.map((row) => row.id)).not.toContain('editor-novel-kernel')
  })

  it('records native root dependencies as composition packages plus profile-config, not libraries or SDK', async () => {
    const composition = await desktopComposition()
    const baseline = nativeDependencyBaseline(composition)
    expect(Object.keys(baseline)).toEqual([...composition.packages, PROFILE_CONFIG_PACKAGE])
    expect(baseline[PROFILE_CONFIG_PACKAGE]).toBe('link:./profile-config')
    for (const name of composition.packages) {
      expect(baseline[name]).toBe(`link:./bundled-packages/node_modules/${name}`)
    }
    for (const name of composition.libraries ?? []) {
      expect(baseline[name]).toBeUndefined()
    }
    expect(Object.values(baseline).some((spec) => String(spec).includes('runtime-links'))).toBe(false)
  })

  it('selects the native voice bundle without forcing its components off, while MCP resources stay disabled', async () => {
    const composition = await desktopComposition()
    expect(composition.bundles).toContain('@deepseek-ai/dsh-experimental-voice-input-bundle')
    expect([...DEFAULT_OFF_OFFICIAL_ENTRIES]).toEqual(['mcp-resources'])
    for (const id of DEFAULT_OFF_OFFICIAL_ENTRIES) expect(composition.disabledEntries).toContain(id)
    for (const id of ['speech-to-text', 'speech-to-text-sensevoice', 'api-speech-to-text', 'ui-voice-input']) {
      expect(composition.disabledEntries).not.toContain(id)
    }
    expect(composition.enabledEntries ?? []).not.toContain('ui-voice-input')
  })

  it('keeps specialized public plugins available for installation outside the distribution', async () => {
    const composition = await desktopComposition()
    for (const name of [...optionalPublicPackages, ...retiredPackages]) {
      expect(composition.packages).not.toContain(name)
      expect(composition.bundles).not.toContain(name)
      expect(manifests.some(item => item.name === name)).toBe(false)
    }
    expect(publicPackages(manifests)).toEqual(['dsh-manuscript', 'dsh-proofread', '@klarkxy/dsh-web-search-manager'])
    expect(composition.features).not.toContain('zhihu')
    expect(composition.features).not.toContain('zhihu-tools')
    expect(composition.extraInserts).toEqual([])
  })

  it('defaults new sessions to dsh-editor-writing and mounts novel-kernel only on novel and legacy presets', () => {
    const profile = resolve(root, 'apps/desktop/resources/profile')
    const patch = readFileSync(resolve(profile, 'cordis.patch.yml'), 'utf8')
    expect(patch).toMatch(/- id: agent-preset-registry\s+config:\s+default: dsh-editor-writing/)
    expect(patch).not.toMatch(/- id: agent-preset-registry\s+config:\s+default: dsh-editor\s*$/m)

    /* 模板只保留 legacy 与核心通用写作；小说/文章/技术由第一方包提供。 */
    const sourceDir = (id) => {
      if (id === 'dsh-editor' || id === 'dsh-editor-writing') return resolve(profile, 'agent-presets', id)
      if (id === 'dsh-editor-novel') return resolve(root, 'packages/dsh-editor-novel-kernel/presets', id)
      return resolve(root, 'packages/dsh-editor-writing-presets/presets', id)
    }
    const kernelPresets = new Set(['dsh-editor', 'dsh-editor-novel'])
    for (const id of ['dsh-editor', 'dsh-editor-article', 'dsh-editor-novel', 'dsh-editor-technical', 'dsh-editor-writing']) {
      const composition = readFileSync(resolve(sourceDir(id), 'agent.cordis.yml'), 'utf8')
      if (kernelPresets.has(id)) expect(composition).toContain('dsh-editor-novel-kernel')
      else expect(composition).not.toContain('dsh-editor-novel-kernel')
    }
  })

  it('documents compositions as aliases and conversation presets as writing modes', () => {
    const docs = [
      'README.md',
      'docs/README.md',
      'docs/architecture.md',
      'docs/product-principles.md',
      'packages/README.md',
      'packages/dsh-editor-shell/README.md',
      'packages/dsh-editor-novel-kernel/README.md',
      'packages/dsh-editor-writing-presets/README.md',
    ].map((path) => readFileSync(resolve(root, path), 'utf8')).join('\n')
    expect(docs).toContain('dsh-editor-writing')
    expect(docs).toContain('dsh-editor-novel')
    expect(docs).toContain('dsh-editor-article')
    expect(docs).toContain('dsh-editor-technical')
    expect(docs).not.toMatch(/新建(?:作品)?预建[^。\n]{0,40}正文\/[^。\n]{0,40}大纲\//)
    expect(docs).not.toMatch(/basic\s*\/\s*smart 只是更小的 feature 集合/)
    expect(docs).not.toMatch(/桌面写作会话走专属 `dsh-editor` agent preset/)
    expect(docs).not.toMatch(/默认[:：].{0,12}dsh-editor(?!-)/)
  })
})
describe('plugin conversation preset manifests', () => {
  function manifestRoot(packages) {
    const root = mkdtempSync(join(tmpdir(), 'dsh-manifest-'))
    for (const [name, pkg] of Object.entries(packages)) {
      const dir = join(root, 'packages', name)
      mkdirSync(join(dir, 'agent-presets', 'team-style'), { recursive: true })
      writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg))
      writeFileSync(join(dir, 'cordis.patch.yml'), `- insert:\n    - id: entry-${name}\n      name: ${name}\n`)
      writeFileSync(join(dir, 'agent-presets', 'team-style', 'preset.yml'), 'name: x\n')
      writeFileSync(join(dir, 'agent-presets', 'team-style', 'agent.cordis.yml'), '[]\n')
    }
    return root
  }
  const basePkg = (name, presets) => ({
    name,
    dsh: { bundle: { patch: './cordis.patch.yml' } },
    dshEditor: {
      role: 'feature',
      visibility: 'public',
      entries: [{ id: `entry-${name}`, title: 't', description: 'd' }],
      ...(presets ? { presets } : {}),
    },
  })

  it('accepts and normalizes declared presets', () => {
    const root = manifestRoot({ 'team-plugin': basePkg('team-plugin', [{ id: 'team-style', path: 'agent-presets/team-style' }]) })
    const manifests = loadPluginManifests(root)
    expect(manifests).toHaveLength(1)
    expect(manifests[0].presets).toEqual([{ id: 'team-style', path: 'agent-presets/team-style' }])
  })

  it('rejects reserved-prefix and unsafe preset ids', () => {
    const reserved = manifestRoot({ 'team-plugin': basePkg('team-plugin', [{ id: 'dsh-editor-clone', path: 'agent-presets/team-style' }]) })
    expect(() => loadPluginManifests(reserved)).toThrow(/must not start with dsh-editor/)
    const unsafe = manifestRoot({ 'team-plugin': basePkg('team-plugin', [{ id: 'bad id', path: 'agent-presets/team-style' }]) })
    expect(() => loadPluginManifests(unsafe)).toThrow(/invalid preset id/)
  })

  it('rejects preset paths that escape the package or lack the required files', () => {
    const escaping = manifestRoot({ 'team-plugin': basePkg('team-plugin', [{ id: 'team-style', path: '../outside' }]) })
    expect(() => loadPluginManifests(escaping)).toThrow(/invalid path/)
    const missing = manifestRoot({ 'team-plugin': basePkg('team-plugin', [{ id: 'team-style', path: 'agent-presets/absent' }]) })
    expect(() => loadPluginManifests(missing)).toThrow(/preset\.yml and agent\.cordis\.yml/)
  })

  it('rejects duplicate preset ids across packages', () => {
    const root = manifestRoot({
      'plugin-one': basePkg('plugin-one', [{ id: 'team-style', path: 'agent-presets/team-style' }]),
      'plugin-two': basePkg('plugin-two', [{ id: 'team-style', path: 'agent-presets/team-style' }]),
    })
    expect(() => loadPluginManifests(root)).toThrow(/duplicate conversation preset id team-style/)
  })

  it('lets first-party desktop packages declare app-prefixed preset ids', () => {
    const pkg = basePkg('first-party', [{ id: 'dsh-editor-clone', path: 'agent-presets/team-style' }])
    pkg.dshEditor.visibility = 'desktop'
    const manifests = loadPluginManifests(manifestRoot({ 'first-party': pkg }))
    expect(manifests).toHaveLength(1)
    expect(manifests[0].presets).toEqual([{ id: 'dsh-editor-clone', path: 'agent-presets/team-style' }])
  })

  it('requires runtime dependencies to be production dependencies and includes them only with their package', () => {
    const pkg = basePkg('runtime-plugin')
    pkg.dshEditor.role = 'core'
    pkg.dshEditor.runtimeDependencies = ['runtime-adapter']
    pkg.dependencies = { 'runtime-adapter': '1.0.0' }
    const manifests = loadPluginManifests(manifestRoot({ 'runtime-plugin': pkg }))
    expect(resolveComposition(manifests, { id: 'x', label: 'x', features: [] }).runtimeDependencies).toEqual(['runtime-adapter'])

    const invalid = basePkg('invalid-runtime-plugin')
    invalid.dshEditor.runtimeDependencies = ['missing-adapter']
    expect(() => loadPluginManifests(manifestRoot({ 'invalid-runtime-plugin': invalid }))).toThrow(/must be declared in dependencies/)
  })

  it('loads scoped workspace dependencies and enables preinstalled entries without requiring Shell services', () => {
    const base = basePkg('@klarkxy/dsh-support')
    base.dshEditor.entries[0].id = 'entry-shared'
    base.dshEditor.role = 'core'
    const feature = basePkg('@klarkxy/dsh-feature')
    feature.dshEditor.entries[0] = { id: 'entry-feature', title: 'Feature', description: 'Optional', feature: 'optional' }
    feature.dependencies = { '@klarkxy/dsh-support': 'workspace:*' }
    const root = manifestRoot({ shared: base, feature })
    const manifests = loadPluginManifests(root)
    const result = resolveComposition(manifests, { id: 'x', label: 'x', features: [], preinstalled: ['@klarkxy/dsh-feature'] })
    expect(result.packages).toEqual(['@klarkxy/dsh-feature', '@klarkxy/dsh-support'])
    expect(result.disabledEntries).toEqual([])
    expect(result.shellFeatures).toEqual({})
    expect(manifests.find(item => item.name === '@klarkxy/dsh-feature').workspaceDeps).toEqual(['@klarkxy/dsh-support'])
    expect(() => resolveComposition(manifests, { id: 'x', label: 'x', features: [], preinstalled: ['missing'] })).toThrow(/preinstalled/)
  })

  it('preserves an explicitly disabled preinstalled feature default', () => {
    const feature = basePkg('@klarkxy/dsh-optional')
    feature.dshEditor.entries[0] = { id: 'entry-feature', title: 'Optional', description: 'Off until enabled', feature: 'optional', defaultEnabled: false }
    const loaded = loadPluginManifests(manifestRoot({ feature }))
    const composition = resolveComposition(loaded, { id: 'x', label: 'x', features: [], preinstalled: ['@klarkxy/dsh-optional'] })
    expect(composition.disabledEntries).toEqual(['entry-feature'])
    expect(composition.shellFeatures).toEqual({})
    const explicitlyEnabled = resolveComposition(loaded, { id: 'x', label: 'x', features: ['optional'] })
    expect(explicitlyEnabled.enabledEntries).toEqual(['entry-feature'])
    expect(explicitlyEnabled.disabledEntries).toEqual([])
    feature.dshEditor.entries[0].defaultEnabled = 'false'
    expect(() => loadPluginManifests(manifestRoot({ feature }))).toThrow(/defaultEnabled/)
  })

  it('selects feature-only packages and flows their presets into resolveComposition', () => {
    const pkg = basePkg('first-party', [{ id: 'dsh-editor-clone', path: 'agent-presets/team-style' }])
    pkg.dshEditor.visibility = 'desktop'
    pkg.dshEditor.features = ['writing-presets']
    const manifests = loadPluginManifests(manifestRoot({ 'first-party': pkg }))
    const resolved = resolveComposition(manifests, { id: 'x', label: 'x', features: ['writing-presets'] })
    expect(resolved.packages).toEqual(['first-party'])
    expect(resolved.presets).toEqual([
      { id: 'dsh-editor-clone', packageName: 'first-party', path: 'agent-presets/team-style' },
    ])
    const dropped = resolveComposition(manifests, { id: 'x', label: 'x', features: [] })
    expect(dropped.packages).toEqual([])
    expect(dropped.presets).toEqual([])
  })
})

 describe('trusted builtin distribution catalogue', () => {
  it('marks local public and private functionality while retaining external ownership', () => {
    const catalogue = catalogFromManifests(loadPluginManifests(root))
    expect(catalogue.manuscript.builtin).toBe(true)
    expect(catalogue['editor-cards']).toMatchObject({ builtin: true, locked: false })
    expect(catalogue['editor-novel-kernel']).toMatchObject({ builtin: true, locked: true, managedBy: 'session' })
    expect(catalogue.proofread).toMatchObject({ builtin: true, locked: true, managedBy: 'feature' })
    expect(catalogue['model-center']).toBeUndefined()
    expect(catalogue['ai-services']).toBeUndefined()
    expect(catalogue.memory).toBeUndefined()
    expect(catalogue['self-improvement']).toBeUndefined()
    expect(catalogue['current-title']).toBeUndefined()
    expect(catalogue.zhihu).toBeUndefined()
    const counterfeit = { name: 'dsh-editor-imitation', dir: join(root, 'node_modules', 'dsh-editor-imitation'), builtin: true, entries: [{ id: 'imitation', title: 'Fake', description: 'Fake', builtin: true }], inserts: [] }
    expect(catalogFromManifests([counterfeit]).imitation.builtin).toBe(false)
  })
})
