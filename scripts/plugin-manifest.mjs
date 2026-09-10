/** Declarative dshEditor manifests and composition resolution. */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const BASE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']

/** Historical desktop bundle order; unknown packages append alphabetically. */
const STABLE_PACKAGE_ORDER = [
  'dsh-manuscript',
  'dsh-proofread',
  'dsh-editor-workbench',
  'dsh-editor-novel-kernel',
  'dsh-zhihu',
  'dsh-editor-shell',
  'dsh-editor-plugins',
]

const ROLES = new Set(['core', 'feature'])
const VISIBILITIES = new Set(['desktop', 'public'])

function fail(message) {
  throw new Error(message)
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function parsePatchInsertIds(text) {
  const ids = []
  let inInsert = false
  for (const raw of String(text).replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.replace(/(^|\s)#.*$/, '$1')
    if (!line.trim()) continue
    if (/^-\s*insert:\s*$/.test(line)) {
      inInsert = true
      continue
    }
    if (/^-\s/.test(line) && !/^\s/.test(line) && !/^-\s*insert:/.test(line)) {
      inInsert = false
      continue
    }
    if (!inInsert) continue
    const id = line.match(/^\s+-\s+id:\s+["']?([A-Za-z0-9._-]+)["']?\s*$/)
    if (id) ids.push(id[1])
  }
  return ids
}

function sortPackageNames(names) {
  return [...names].sort((left, right) => {
    const leftIndex = STABLE_PACKAGE_ORDER.indexOf(left)
    const rightIndex = STABLE_PACKAGE_ORDER.indexOf(right)
    if (leftIndex === -1 && rightIndex === -1) return left.localeCompare(right)
    if (leftIndex === -1) return 1
    if (rightIndex === -1) return -1
    return leftIndex - rightIndex
  })
}

function asEntries(value, label) {
  if (value === undefined) return []
  if (!Array.isArray(value)) fail(`${label} must be an array`)
  return value
}

function normalizeEntry(row, label) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) fail(`${label} must be an object`)
  if (typeof row.id !== 'string' || !row.id.trim()) fail(`${label} is missing id`)
  if (typeof row.title !== 'string' || !row.title.trim()) fail(`${label} (${row.id}) is missing title`)
  if (typeof row.description !== 'string' || !row.description.trim()) fail(`${label} (${row.id}) is missing description`)
  if (row.feature !== undefined && (typeof row.feature !== 'string' || !row.feature.trim())) {
    fail(`${label} (${row.id}) has an invalid feature`)
  }
  if (row.service !== undefined && (typeof row.service !== 'string' || !row.service.trim())) {
    fail(`${label} (${row.id}) has an invalid service`)
  }
  if (row.locked !== undefined && typeof row.locked !== 'boolean') fail(`${label} (${row.id}) has an invalid locked flag`)
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    ...(row.locked ? { locked: true } : {}),
    ...(row.feature ? { feature: row.feature } : {}),
    ...(row.service ? { service: row.service } : {}),
  }
}

function normalizeInsert(row, label) {
  const entry = normalizeEntry(row, label)
  if (typeof row.name !== 'string' || !row.name.trim()) fail(`${label} (${entry.id}) is missing name`)
  if (row.requires !== undefined && (!Array.isArray(row.requires) || row.requires.some((item) => typeof item !== 'string' || !item.trim()))) {
    fail(`${label} (${entry.id}) has invalid requires`)
  }
  if (!entry.feature) fail(`${label} (${entry.id}) must declare a feature`)
  return {
    ...entry,
    name: row.name,
    ...(row.requires?.length ? { requires: [...row.requires] } : {}),
  }
}

export function loadPluginManifests(root = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
  const packagesDir = resolve(root, 'packages')
  let entries
  try {
    entries = readdirSync(packagesDir, { withFileTypes: true })
  } catch (error) {
    fail(`cannot read packages directory ${packagesDir}: ${error instanceof Error ? error.message : String(error)}`)
  }
  const manifests = []
  const libraryCandidates = []
  for (const entry of entries.filter((item) => item.isDirectory()).sort((left, right) => left.name.localeCompare(right.name))) {
    const dir = join(packagesDir, entry.name)
    const manifestPath = join(dir, 'package.json')
    let pkg
    try {
      pkg = readJson(manifestPath)
    } catch {
      continue
    }
    const patchRel = typeof pkg.dsh?.bundle?.patch === 'string' ? pkg.dsh.bundle.patch.trim() : ''
    const block = pkg.dshEditor
    if (!patchRel && !block) {
      if (typeof pkg.name === 'string' && pkg.name.startsWith('dsh-')) {
        libraryCandidates.push({
          name: pkg.name,
          dir,
          workspaceDeps: Object.keys(pkg.dependencies ?? {}).filter((name) => typeof name === 'string' && name.startsWith('dsh-')),
        })
      }
      continue
    }
    if (!patchRel) fail(`${pkg.name ?? entry.name}: dshEditor requires dsh.bundle.patch`)
    if (!block || typeof block !== 'object' || Array.isArray(block)) {
      fail(`${pkg.name ?? entry.name}: packages with dsh.bundle.patch must declare a dshEditor block`)
    }
    if (typeof pkg.name !== 'string' || !pkg.name.trim()) fail(`${entry.name}: package.json is missing name`)
    if (!ROLES.has(block.role)) fail(`${pkg.name}: dshEditor.role must be core or feature`)
    if (!VISIBILITIES.has(block.visibility)) fail(`${pkg.name}: dshEditor.visibility must be desktop or public`)
    const packageEntries = asEntries(block.entries, `${pkg.name} dshEditor.entries`).map((row, index) => (
      normalizeEntry(row, `${pkg.name} dshEditor.entries[${index}]`)
    ))
    const inserts = asEntries(block.inserts, `${pkg.name} dshEditor.inserts`).map((row, index) => (
      normalizeInsert(row, `${pkg.name} dshEditor.inserts[${index}]`)
    ))
    const patchPath = join(dir, patchRel)
    let patchIds
    try {
      patchIds = parsePatchInsertIds(readFileSync(patchPath, 'utf8'))
    } catch (error) {
      fail(`${pkg.name}: cannot read ${patchRel}: ${error instanceof Error ? error.message : String(error)}`)
    }
    const entryIds = packageEntries.map((row) => row.id)
    const missingFromPatch = entryIds.filter((id) => !patchIds.includes(id))
    const extraInPatch = patchIds.filter((id) => !entryIds.includes(id))
    if (missingFromPatch.length || extraInPatch.length) {
      fail(`${pkg.name}: dshEditor.entries must match insert ids in ${patchRel} (missing ${missingFromPatch.join(', ') || '—'}; extra ${extraInPatch.join(', ') || '—'})`)
    }
    const workspaceDeps = Object.keys(pkg.dependencies ?? {}).filter((name) => typeof name === 'string' && name.startsWith('dsh-'))
    manifests.push({
      name: pkg.name,
      dir,
      role: block.role,
      visibility: block.visibility,
      wrapClient: Boolean(block.wrapClient) || Boolean(pkg.dsh?.client),
      entries: packageEntries,
      inserts,
      workspaceDeps,
    })
  }

  const knownNames = new Set([
    ...manifests.map((item) => item.name),
    ...libraryCandidates.map((item) => item.name),
  ])
  const seen = new Map()
  const features = new Set()
  for (const manifest of manifests) {
    for (const row of [...manifest.entries, ...manifest.inserts]) {
      const owner = seen.get(row.id)
      if (owner) fail(`duplicate plugin id ${row.id} in ${owner} and ${manifest.name}`)
      seen.set(row.id, manifest.name)
      if (row.feature) features.add(row.feature)
    }
  }
  for (const manifest of manifests) {
    for (const insert of manifest.inserts) {
      for (const required of insert.requires ?? []) {
        if (!features.has(required)) fail(`${manifest.name}: insert ${insert.id} requires unknown feature ${required}`)
      }
    }
    manifest.workspaceDeps = manifest.workspaceDeps.filter((name) => knownNames.has(name))
  }
  for (const library of libraryCandidates) {
    library.workspaceDeps = library.workspaceDeps.filter((name) => knownNames.has(name))
  }
  const reachableLibraries = reachableWorkspaceLibraries(manifests, libraryCandidates)
  manifests.libraries = reachableLibraries
  return manifests
}

function reachableWorkspaceLibraries(manifests, libraryCandidates) {
  const libraryByName = new Map(libraryCandidates.map((item) => [item.name, item]))
  const selected = new Set()
  const visit = (name) => {
    if (selected.has(name) || !libraryByName.has(name)) return
    selected.add(name)
    for (const dep of libraryByName.get(name).workspaceDeps) visit(dep)
  }
  for (const manifest of manifests) {
    for (const dep of manifest.workspaceDeps) visit(dep)
  }
  return sortPackageNames([...selected]).map((name) => libraryByName.get(name))
}

/** Library-only workspace packages (no Cordis entry / dshEditor) reachable from bundle manifests. */
export function loadWorkspaceLibraries(root = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
  return loadPluginManifests(root).libraries ?? []
}

function rowsOf(manifest) {
  return [...manifest.entries, ...manifest.inserts]
}

function serviceByFeature(manifests) {
  const services = new Map()
  for (const manifest of manifests) {
    for (const row of rowsOf(manifest)) {
      if (!row.feature || !row.service) continue
      const previous = services.get(row.feature)
      if (previous && previous !== row.service) {
        fail(`feature ${row.feature} maps to both ${previous} and ${row.service}`)
      }
      services.set(row.feature, row.service)
    }
  }
  return services
}

function knownFeatures(manifests) {
  const features = new Set()
  for (const manifest of manifests) {
    for (const row of rowsOf(manifest)) {
      if (row.feature) features.add(row.feature)
    }
  }
  return features
}

export function compositionInstallNames(composition) {
  return sortPackageNames([
    ...composition.packages,
    ...(composition.libraries ?? []),
  ])
}

export function resolveComposition(manifests, recipe, libraries = manifests.libraries ?? []) {
  if (!recipe || typeof recipe !== 'object') fail('composition recipe must be an object')
  if (typeof recipe.id !== 'string' || !recipe.id.trim()) fail('composition recipe is missing id')
  if (typeof recipe.label !== 'string' || !recipe.label.trim()) fail(`${recipe.id}: recipe is missing label`)
  if (!Array.isArray(recipe.features) || recipe.features.some((item) => typeof item !== 'string' || !item.trim())) {
    fail(`${recipe.id}: recipe.features must be an array of strings`)
  }
  if (new Set(recipe.features).size !== recipe.features.length) fail(`${recipe.id}: duplicate features`)
  const declared = knownFeatures(manifests)
  for (const feature of recipe.features) {
    if (!declared.has(feature)) fail(`${recipe.id}: unknown feature ${feature}`)
  }
  const selectedFeatures = new Set(recipe.features)
  const byName = new Map(manifests.map((manifest) => [manifest.name, manifest]))
  const selected = new Set()
  for (const manifest of manifests) {
    if (manifest.role === 'core') selected.add(manifest.name)
    if (rowsOf(manifest).some((row) => row.feature && selectedFeatures.has(row.feature))) selected.add(manifest.name)
  }
  let growing = true
  while (growing) {
    growing = false
    for (const name of [...selected]) {
      for (const dep of byName.get(name)?.workspaceDeps ?? []) {
        if (byName.has(dep) && !selected.has(dep)) {
          selected.add(dep)
          growing = true
        }
      }
    }
  }
  const packages = sortPackageNames([...selected].filter((name) => byName.has(name)))
  const libraryByName = new Map((libraries ?? []).map((item) => [item.name, item]))
  const selectedLibraries = new Set()
  let libraryGrowing = true
  while (libraryGrowing) {
    libraryGrowing = false
    for (const name of [...selected, ...selectedLibraries]) {
      const deps = byName.get(name)?.workspaceDeps ?? libraryByName.get(name)?.workspaceDeps ?? []
      for (const dep of deps) {
        if (libraryByName.has(dep) && !selectedLibraries.has(dep)) {
          selectedLibraries.add(dep)
          libraryGrowing = true
        }
      }
    }
  }
  const resolvedLibraries = sortPackageNames([...selectedLibraries])
  const disabledEntries = []
  const extraInserts = []
  for (const name of packages) {
    const manifest = byName.get(name)
    for (const entry of manifest.entries) {
      if (entry.feature && !selectedFeatures.has(entry.feature)) disabledEntries.push(entry.id)
    }
    for (const insert of manifest.inserts) {
      if (!insert.feature || !selectedFeatures.has(insert.feature)) continue
      const missing = (insert.requires ?? []).filter((feature) => !selectedFeatures.has(feature))
      if (missing.length) fail(`${recipe.id}: insert ${insert.id} requires unselected features ${missing.join(', ')}`)
      extraInserts.push({ id: insert.id, name: insert.name })
    }
  }
  const services = serviceByFeature(manifests)
  const shellFeatures = {}
  for (const feature of recipe.features) {
    const service = services.get(feature)
    if (service) shellFeatures[feature] = service
  }
  return {
    id: recipe.id,
    label: recipe.label,
    features: [...recipe.features],
    packages,
    libraries: resolvedLibraries,
    disabledEntries,
    extraInserts,
    shellFeatures,
    bundles: [...BASE_BUNDLES, ...packages],
  }
}

export function publicPackages(manifests) {
  return sortPackageNames(manifests.filter((item) => item.visibility === 'public').map((item) => item.name))
}

export function desktopPackageNames(manifests) {
  return sortPackageNames(manifests.map((item) => item.name))
}

export function desktopCopiedPackageNames(manifests, libraries = manifests.libraries ?? []) {
  return sortPackageNames([
    ...manifests.map((item) => item.name),
    ...libraries.map((item) => item.name),
  ])
}

export function corePackageNames(manifests) {
  return sortPackageNames(manifests.filter((item) => item.role === 'core').map((item) => item.name))
}

export function clientPackages(manifests) {
  return sortPackageNames(manifests.filter((item) => item.wrapClient).map((item) => item.name))
}

export function protectedPackageNames(manifests) {
  return desktopPackageNames(manifests)
}

export function catalogFromManifests(manifests) {
  const catalog = {}
  for (const manifest of manifests) {
    for (const row of rowsOf(manifest)) {
      catalog[row.id] = {
        title: row.title,
        description: row.description,
        locked: Boolean(row.locked),
        packageName: manifest.name,
        ...(row.feature ? { feature: row.feature } : {}),
      }
    }
  }
  return catalog
}
