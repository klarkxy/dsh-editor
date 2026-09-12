import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
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

  it('resolves the checked-in basic/smart/full recipes to the expected package, disable, insert and shell-feature sets', () => {
    const recipe = (id) => JSON.parse(readFileSync(resolve(root, 'apps/desktop/resources/compositions', `${id}.json`), 'utf8'))
    const panels = ['dsh-editor-cards', 'dsh-editor-memory-panel', 'dsh-editor-overview-panel']
    const core = ['dsh-manuscript', 'dsh-proofread', 'dsh-editor-workbench']
    const tail = ['dsh-editor-shell', 'dsh-editor-plugins', ...panels]

    const basic = resolveComposition(manifests, recipe('basic'))
    expect(basic).toEqual({
      id: 'basic',
      label: '基础写作',
      features: ['overview-panel', 'memory-panel', 'cards'],
      packages: [...core, ...tail],
      libraries: ['dsh-editor-workspace-kit'],
      disabledEntries: ['manuscript-assist', 'editor-workbench-tools'],
      extraInserts: [],
      shellFeatures: {},
      bundles: [...BASE_BUNDLES, ...core, ...tail],
    })

    const smart = resolveComposition(manifests, recipe('smart'))
    expect(smart).toEqual({
      id: 'smart',
      label: '智能写作',
      features: ['assistant', 'completion', 'overview-panel', 'memory-panel', 'cards'],
      packages: [...core, 'dsh-editor-novel-kernel', ...tail],
      libraries: ['dsh-editor-workspace-kit'],
      disabledEntries: [],
      extraInserts: [],
      shellFeatures: { assistant: 'novelKernel', completion: 'manuscriptAssist' },
      bundles: [...BASE_BUNDLES, ...core, 'dsh-editor-novel-kernel', ...tail],
    })

    const full = resolveComposition(manifests, recipe('full'))
    expect(full).toEqual({
      id: 'full',
      label: '智能写作与资料',
      features: ['assistant', 'completion', 'zhihu', 'zhihu-tools', 'overview-panel', 'memory-panel', 'cards'],
      packages: [...core, 'dsh-editor-novel-kernel', 'dsh-zhihu', ...tail],
      libraries: ['dsh-editor-workspace-kit'],
      disabledEntries: [],
      extraInserts: [{ id: 'zhihu-tools', name: 'dsh-zhihu/tools' }],
      shellFeatures: { assistant: 'novelKernel', completion: 'manuscriptAssist', zhihu: 'zhihu' },
      bundles: [...BASE_BUNDLES, ...core, 'dsh-editor-novel-kernel', 'dsh-zhihu', ...tail],
    })
  })
})