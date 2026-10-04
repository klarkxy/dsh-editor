/** Explicit product recipes shared by preparation, development and artifact verification. */
import { readdirSync } from 'node:fs'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BASE_BUNDLES,
  catalogFromManifests,
  desktopCopiedPackageNames,
  loadPluginManifests,
  publicPackages,
  resolveComposition,
} from './plugin-manifest.mjs'
import { configureWebSearchPresets } from './configure-web-search.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const compositionsDir = resolve(root, 'apps/desktop/resources/compositions')
export const COMPOSITION_ALIASES = { basic: '基础写作', smart: '智能写作', full: '智能写作与资料' }
const canonicalIds = readdirSync(compositionsDir)
  .filter((name) => name.endsWith('.json'))
  .map((name) => name.slice(0, -5))
  .filter((id) => !(id in COMPOSITION_ALIASES))
  .sort()
export const COMPOSITION_IDS = [...canonicalIds, ...Object.keys(COMPOSITION_ALIASES)]
const manifests = loadPluginManifests(root)
export { BASE_BUNDLES }
export const DESKTOP_PACKAGE_NAMES = desktopCopiedPackageNames(manifests)
export const PUBLIC_PLUGIN_PACKAGES = publicPackages(manifests)

/** Resolve local workspace or explicitly pinned external package directories. */
export function workspacePackageDir(name) {
  const pkg = [...manifests, ...(manifests.libraries ?? [])].find((item) => item.name === name)
  if (!pkg) throw new Error(`unknown composition package: ${name}`)
  return pkg.dir
}

/**
 * Official plugin entries the app manages itself. `defaultOff` keeps a plugin's
 * surface out of the composer until the author turns it on from 内置插件; the
 * package stays in the distribution either way.
 */
const OFFICIAL_CATALOG_ENTRIES = {
  'ui-shortcuts': { title: '快捷键', description: '使用官方快捷键搜索、录制和重置。', locked: false, builtin: true, packageName: '@deepseek-ai/dsh-client-ui-shortcuts' },
  'ui-sidebar-documentpreview': { title: '资料预览', description: '预览图片、PDF、Office 文档和表格。', locked: false, builtin: true, packageName: '@deepseek-ai/dsh-client-ui-sidebar-documentpreview' },
  'mcp-resources': { title: 'MCP 资源', description: '读取已配置 MCP 服务提供的资源。', locked: false, builtin: true, packageName: '@deepseek-ai/dsh-mcp-resources' },
  ...Object.entries({ 'speech-to-text': '@deepseek-ai/dsh-experimental-speech-to-text', 'speech-to-text-sensevoice': '@deepseek-ai/dsh-experimental-speech-to-text-sensevoice', 'api-speech-to-text': '@deepseek-ai/dsh-experimental-api-speech-to-text', 'ui-voice-input': '@deepseek-ai/dsh-experimental-client-ui-voice-input' }).reduce((rows, [id, packageName]) => ({ ...rows, [id]: {
    title: '语音输入', description: '使用官方本地语音识别，将转写放入对话草稿。首次使用需准备模型。', locked: false, builtin: true, defaultOff: true,
    packageName,
  } }), {}),
}
/** Cordis ids that ship installed but stay disabled until the author opts in. */
export const DEFAULT_OFF_OFFICIAL_ENTRIES = Object.entries(OFFICIAL_CATALOG_ENTRIES)
  .filter(([, entry]) => entry.defaultOff)
  .map(([id]) => id)
const publishedCatalogEntries = Object.fromEntries(Object.entries(OFFICIAL_CATALOG_ENTRIES)
  .map(([id, { defaultOff: _defaultOff, ...entry }]) => [id, entry]))

export async function desktopComposition(id = process.env.DSH_EDITOR_COMPOSITION || 'desktop') {
  if (!COMPOSITION_IDS.includes(id)) throw new Error(`unsupported desktop composition: ${id}`)
  const aliasLabel = COMPOSITION_ALIASES[id]
  const recipe = JSON.parse(await readFile(resolve(compositionsDir, aliasLabel ? 'desktop.json' : `${id}.json`), 'utf8'))
  if (recipe.id !== (aliasLabel ? 'desktop' : id) || typeof recipe.label !== 'string' || !Array.isArray(recipe.features)) {
    throw new Error(`invalid composition recipe: ${id}`)
  }
  const resolved = resolveComposition(manifests, recipe)
  /* Official entries carry no workspace manifest, so their default state is applied here
   * and stays visible in the materialized patch and composition record. */
  resolved.disabledEntries = [...new Set([...resolved.disabledEntries, ...DEFAULT_OFF_OFFICIAL_ENTRIES])]
  if (aliasLabel) {
    resolved.id = id
    resolved.label = aliasLabel
  }
  return resolved
}

export function runtimeDependencySources(composition) {
  const selected = new Set(composition.packages)
  const owners = new Map()
  for (const manifest of manifests) {
    if (!selected.has(manifest.name)) continue
    for (const dependency of manifest.runtimeDependencies) {
      if (!owners.has(dependency)) owners.set(dependency, resolve(manifest.dir, 'package.json'))
    }
  }
  return (composition.runtimeDependencies ?? []).map((name) => {
    const packageManifest = owners.get(name)
    if (!packageManifest) throw new Error(`runtime dependency ${name} has no selected package owner`)
    return { name, packageManifest }
  })
}

export async function configureProfile(destination, composition) {
  const manifestPath = resolve(destination, 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.dsh.profile.bundles = [...composition.bundles, 'dsh-editor-profile-config']
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  const basePatch = await readFile(resolve(root, 'apps/desktop/resources/profile/cordis.patch.yml'), 'utf8')
  const extraInsertPatch = composition.extraInserts.length
    ? `- insert:\n${composition.extraInserts.map((row) => `    - id: ${row.id}\n      name: ${JSON.stringify(row.name)}\n`).join('')}`
    : ''
  const disabledPatch = composition.disabledEntries.map((id) => `- id: ${id}\n  disabled: true\n`).join('')
  const enabledPatch = (composition.enabledEntries ?? []).map((id) => `- id: ${id}\n  disabled: false\n`).join('')
  const featureEntries = {}
  for (const manifest of manifests.filter(item => composition.packages.includes(item.name))) {
    for (const row of [...manifest.entries, ...manifest.inserts]) {
      if (row.feature && row.service === composition.shellFeatures[row.feature]) (featureEntries[row.feature] ??= []).push(row.id)
    }
  }
  const featureEntriesPatch = `    featureEntries: ${JSON.stringify(featureEntries)}\n`
  const featureKeys = Object.keys(composition.shellFeatures)
  const featuresPatch = featureKeys.length
    ? `    features:\n${featureKeys.map((feature) => `      ${feature}: ${composition.shellFeatures[feature]}\n`).join('')}`
    : '    features: {}\n'
  const selectionPatch = `${extraInsertPatch}${disabledPatch}${enabledPatch}- id: editor-shell\n  config:\n${featuresPatch}${featureEntriesPatch}`
  const configBundle = resolve(destination, 'node_modules', 'dsh-editor-profile-config')
  await mkdir(configBundle, { recursive: true })
  await writeFile(resolve(configBundle, 'package.json'), JSON.stringify({ name: 'dsh-editor-profile-config', private: true, version: '1.0.0', dsh: { bundle: { patch: ['./base.patch.yml', './presets.patch.json'] } } }))
  await writeFile(resolve(configBundle, 'base.patch.yml'), `${basePatch.trimEnd()}\n${selectionPatch}`)
  await writeFile(resolve(configBundle, 'presets.patch.json'), '[]\n')
  await writeFile(resolve(destination, 'cordis.patch.yml'), '[]\n')
  await writeFile(resolve(destination, 'composition.json'), `${JSON.stringify(composition, null, 2)}\n`)
  const selected = manifests.filter((item) => composition.packages.includes(item.name))
  await writeFile(resolve(destination, 'dsh-editor-catalog.json'), `${JSON.stringify({
    bundles: composition.bundles,
    entries: {
      ...catalogFromManifests(selected),
      ...publishedCatalogEntries,
    },
  }, null, 2)}\n`)
  // First-party plugin presets ship through the same template channel as the
  // app-owned ones: copy each declared dir next to them and mark it app-owned.
  const presets = composition.presets ?? []
  if (presets.length) {
    const byName = new Map(manifests.map((item) => [item.name, item]))
    const presetRoot = resolve(destination, 'agent-presets')
    await mkdir(presetRoot, { recursive: true })
    for (const preset of presets) {
      const manifest = byName.get(preset.packageName)
      if (!manifest) throw new Error(`composition preset ${preset.id} comes from unknown package ${preset.packageName}`)
      const target = join(presetRoot, preset.id)
      await rm(target, { recursive: true, force: true })
      await cp(resolve(manifest.dir, preset.path), target, { recursive: true })
      await writeFile(join(target, '.dsh-editor-owner.json'), `${JSON.stringify({ app: 'dsh-editor', schema: 1 })}\n`)
    }
  }
  await configureWebSearchPresets(destination, composition)
}
