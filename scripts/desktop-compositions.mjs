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

export async function desktopComposition(id = process.env.DSH_EDITOR_COMPOSITION || 'desktop') {
  if (!COMPOSITION_IDS.includes(id)) throw new Error(`unsupported desktop composition: ${id}`)
  const aliasLabel = COMPOSITION_ALIASES[id]
  const recipe = JSON.parse(await readFile(resolve(compositionsDir, aliasLabel ? 'desktop.json' : `${id}.json`), 'utf8'))
  if (recipe.id !== (aliasLabel ? 'desktop' : id) || typeof recipe.label !== 'string' || !Array.isArray(recipe.features)) {
    throw new Error(`invalid composition recipe: ${id}`)
  }
  const resolved = resolveComposition(manifests, recipe)
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
  manifest.dsh.profile.bundles = composition.bundles
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  const basePatch = await readFile(resolve(root, 'apps/desktop/resources/profile/cordis.patch.yml'), 'utf8')
  const extraInsertPatch = composition.extraInserts.length
    ? `- insert:\n${composition.extraInserts.map((row) => `    - id: ${row.id}\n      name: ${row.name}\n`).join('')}`
    : ''
  const disabledPatch = composition.disabledEntries.map((id) => `- id: ${id}\n  disabled: true\n`).join('')
  const featureKeys = Object.keys(composition.shellFeatures)
  const featuresPatch = featureKeys.length
    ? `    features:\n${featureKeys.map((feature) => `      ${feature}: ${composition.shellFeatures[feature]}\n`).join('')}`
    : '    features: {}\n'
  const selectionPatch = `${extraInsertPatch}${disabledPatch}- id: editor-shell\n  config:\n${featuresPatch}`
  await writeFile(resolve(destination, 'cordis.patch.yml'), `${basePatch.trimEnd()}\n${selectionPatch}`)
  await writeFile(resolve(destination, 'composition.json'), `${JSON.stringify(composition, null, 2)}\n`)
  const selected = manifests.filter((item) => composition.packages.includes(item.name))
  await writeFile(resolve(destination, 'dsh-editor-catalog.json'), `${JSON.stringify({
    bundles: composition.bundles,
    entries: catalogFromManifests(selected),
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
