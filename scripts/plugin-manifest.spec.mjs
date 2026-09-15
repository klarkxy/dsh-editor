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

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

describe('desktop dev prepare', () => {
  it('links workspace packages into the template instead of copying plugin bundles', () => {
    const prepare = readFileSync(resolve(root, 'scripts/prepare-desktop-dev.mjs'), 'utf8')
    expect(prepare).toContain("await symlink(source, destination, 'junction')")
    expect(prepare).toContain("!normalized.endsWith('.map')")
    const dev = readFileSync(resolve(root, 'scripts/dev.mjs'), 'utf8')
    expect(dev).toContain('reusing existing package builds')
    expect(dev).toContain('DSH_DEV_FORCE_BUILD')
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
      'dsh-zhihu',
      'dsh-editor-shell',
      'dsh-editor-plugins',
      'dsh-editor-cards',
      'dsh-editor-memory-panel',
      'dsh-editor-overview-panel',
      'dsh-editor-proofread-panel',
    ])
    expect(publicPackages(manifests)).toEqual(['dsh-manuscript', 'dsh-proofread', 'dsh-zhihu'])
    expect(corePackageNames(manifests)).toEqual([
      'dsh-manuscript',
      'dsh-editor-workbench',
      'dsh-editor-shell',
      'dsh-editor-plugins',
    ])
    expect(clientPackages(manifests)).toEqual([
      'dsh-manuscript',
      'dsh-proofread',
      'dsh-zhihu',
      'dsh-editor-shell',
      'dsh-editor-plugins',
      'dsh-editor-cards',
      'dsh-editor-memory-panel',
      'dsh-editor-overview-panel',
      'dsh-editor-proofread-panel',
    ])
    expect(catalogFromManifests(manifests)['zhihu-tools']).toMatchObject({
      packageName: 'dsh-zhihu',
      feature: 'zhihu-tools',
      locked: false,
    })
    expect(loadWorkspaceLibraries(root).map((item) => item.name)).toEqual(['dsh-editor-workspace-kit'])
    expect(desktopCopiedPackageNames(manifests)).toEqual([
      ...desktopPackageNames(manifests),
      'dsh-editor-workspace-kit',
    ])
  })

  it('resolves basic/smart/full as one desktop capability set, differing only by id and label', () => {
    const recipe = (id) => JSON.parse(readFileSync(resolve(root, 'apps/desktop/resources/compositions', `${id}.json`), 'utf8'))
    const labels = { basic: '基础写作', smart: '智能写作', full: '智能写作与资料' }
    const panels = ['dsh-editor-overview-panel', 'dsh-editor-proofread-panel']
    const core = ['dsh-manuscript', 'dsh-proofread', 'dsh-editor-workbench']
    const tail = ['dsh-editor-shell', 'dsh-editor-plugins', ...panels]
    const packages = [...core, 'dsh-editor-novel-kernel', 'dsh-zhihu', ...tail]
    const capability = {
      features: ['assistant', 'completion', 'zhihu', 'zhihu-tools', 'overview-panel', 'proofread-panel'],
      packages,
      libraries: ['dsh-editor-workspace-kit'],
      disabledEntries: [],
      extraInserts: [{ id: 'zhihu-tools', name: 'dsh-zhihu/tools' }],
      shellFeatures: { assistant: 'sessions', completion: 'manuscriptAssist', zhihu: 'zhihu' },
      bundles: [...BASE_BUNDLES, ...packages],
    }

    const resolved = Object.keys(labels).map((id) => resolveComposition(manifests, recipe(id)))
    for (const item of resolved) {
      expect(item.id in labels).toBe(true)
      expect(item.label).toBe(labels[item.id])
      const { id: _id, label: _label, ...rest } = item
      expect(rest).toEqual(capability)
    }
    const stripped = resolved.map(({ id: _id, label: _label, ...rest }) => rest)
    expect(stripped[0]).toEqual(stripped[1])
    expect(stripped[1]).toEqual(stripped[2])
    expect(capability.features).toContain('proofread-panel')
    expect(capability.features).not.toContain('cards')
    expect(capability.features).not.toContain('memory-panel')
    expect(capability.packages).toContain('dsh-editor-novel-kernel')
    expect(capability.packages).toContain('dsh-editor-proofread-panel')
    expect(capability.packages).not.toContain('dsh-editor-cards')
    expect(capability.packages).not.toContain('dsh-editor-memory-panel')
    expect(capability.extraInserts.map((row) => row.id)).not.toContain('editor-workbench-tools')
    expect(capability.extraInserts.map((row) => row.id)).not.toContain('editor-novel-kernel')
  })

  it('defaults new sessions to dsh-editor-writing and mounts novel-kernel only on novel and legacy presets', () => {
    const profile = resolve(root, 'apps/desktop/resources/profile')
    const patch = readFileSync(resolve(profile, 'cordis.patch.yml'), 'utf8')
    expect(patch).toMatch(/- id: agent-presets\s+config:\s+default: dsh-editor-writing/)
    expect(patch).not.toMatch(/- id: agent-presets\s+config:\s+default: dsh-editor\s*$/m)

    const kernelPresets = new Set(['dsh-editor', 'dsh-editor-novel'])
    for (const id of ['dsh-editor', 'dsh-editor-article', 'dsh-editor-novel', 'dsh-editor-technical', 'dsh-editor-writing']) {
      const composition = readFileSync(resolve(profile, 'agent-presets', id, 'agent.cordis.yml'), 'utf8')
      if (kernelPresets.has(id)) expect(composition).toContain('dsh-editor-novel-kernel')
      else expect(composition).not.toContain('dsh-editor-novel-kernel')
    }
  })

  it('documents compositions as aliases and conversation presets as writing modes', () => {
    const docs = [
      'README.md',
      'docs/README.md',
      'docs/plugin-composition-guide.md',
      'docs/architecture.md',
      'docs/development.md',
      'docs/product-principles.md',
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
})
