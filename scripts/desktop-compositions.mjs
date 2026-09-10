/** Explicit product recipes shared by preparation, development and artifact verification. */
import { readdirSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BASE_BUNDLES,
  desktopCopiedPackageNames,
  loadPluginManifests,
  publicPackages,
  resolveComposition,
} from './plugin-manifest.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const compositionsDir = resolve(root, 'apps/desktop/resources/compositions')
const RECIPE_ORDER = ['basic', 'smart', 'full']
const listedRecipes = readdirSync(compositionsDir)
  .filter((name) => name.endsWith('.json'))
  .map((name) => name.slice(0, -5))
export const COMPOSITION_IDS = [
  ...RECIPE_ORDER.filter((id) => listedRecipes.includes(id)),
  ...listedRecipes.filter((id) => !RECIPE_ORDER.includes(id)).sort(),
]
const manifests = loadPluginManifests(root)
export { BASE_BUNDLES }
export const DESKTOP_PACKAGE_NAMES = desktopCopiedPackageNames(manifests)
export const PUBLIC_PLUGIN_PACKAGES = publicPackages(manifests)

export async function desktopComposition(id = process.env.DSH_EDITOR_COMPOSITION || 'full') {
  if (!COMPOSITION_IDS.includes(id)) throw new Error(`unsupported desktop composition: ${id}`)
  const recipe = JSON.parse(await readFile(resolve(compositionsDir, `${id}.json`), 'utf8'))
  if (recipe.id !== id || typeof recipe.label !== 'string' || !Array.isArray(recipe.features)) {
    throw new Error(`invalid composition recipe: ${id}`)
  }
  return resolveComposition(manifests, recipe)
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
}
