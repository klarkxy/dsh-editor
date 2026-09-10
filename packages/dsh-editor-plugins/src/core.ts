import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PluginGroup } from './contracts.ts'

export type DshEditorEntry = {
  id: string
  title: string
  description: string
  locked?: boolean
  feature?: string
  service?: string
  name?: string
  requires?: string[]
}

export type DshEditorBlock = {
  role?: string
  visibility?: string
  wrapClient?: boolean
  entries?: DshEditorEntry[]
  inserts?: DshEditorEntry[]
}

export type CatalogEntry = {
  title: string
  description: string
  group: PluginGroup
}

export type RuntimeCatalogEntry = {
  title: string
  description: string
  locked: boolean
  packageName: string
  feature?: string
}

export type RuntimeCatalog = {
  entries: Record<string, RuntimeCatalogEntry>
  bundles: string[]
}

const ENTRY_ID_PATTERN = /^[A-Za-z0-9._-]+$/
const PACKAGE_NAME_PATTERN = /^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/

export function isSafeEntryId(value: string): boolean {
  return ENTRY_ID_PATTERN.test(value) && value.length <= 80
}

export function isSafePackageName(value: string): boolean {
  return PACKAGE_NAME_PATTERN.test(value) && value.length <= 120 && !value.includes('..')
}

export function packageNameOf(moduleName: string): string {
  const trimmed = moduleName.trim()
  if (trimmed.startsWith('@')) {
    const parts = trimmed.split('/')
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : trimmed
  }
  return trimmed.split('/')[0] ?? trimmed
}

export function emptyRuntimeCatalog(bundles: readonly string[] = []): RuntimeCatalog {
  return { entries: {}, bundles: [...bundles] }
}

export function catalogFromEditorBlocks(
  packages: ReadonlyArray<{ name: string; dshEditor: DshEditorBlock }>,
  bundles: readonly string[],
): RuntimeCatalog {
  const entries: Record<string, RuntimeCatalogEntry> = {}
  for (const pkg of packages) {
    for (const row of [...(pkg.dshEditor.entries ?? []), ...(pkg.dshEditor.inserts ?? [])]) {
      if (!row.id) continue
      entries[row.id] = {
        title: row.title || pkg.name,
        description: row.description || row.id,
        locked: Boolean(row.locked),
        packageName: pkg.name,
        ...(row.feature ? { feature: row.feature } : {}),
      }
    }
  }
  return { entries, bundles: [...bundles] }
}

export function isProtectedPackage(name: string, bundles: readonly string[] = []): boolean {
  return name.startsWith('@deepseek-ai/') || bundles.includes(name)
}

export const RUNTIME_CATALOG_FILE = 'dsh-editor-catalog.json'

/** Cordis insert fibers are `include:<id>`; catalog keys stay the patch id. */
export function catalogLookupId(entryId: string): string {
  const colon = entryId.indexOf(':')
  return colon === -1 ? entryId : entryId.slice(colon + 1)
}

export function catalogRow(entryId: string, catalog: RuntimeCatalog): RuntimeCatalogEntry | undefined {
  return catalog.entries[entryId] ?? catalog.entries[catalogLookupId(entryId)]
}

export function isProtectedEntry(entryId: string, moduleName: string, catalog: RuntimeCatalog): boolean {
  const row = catalogRow(entryId, catalog)
  if (row) return row.locked
  return isProtectedPackage(packageNameOf(moduleName), catalog.bundles)
}

export function classifyEntry(entryId: string, moduleName: string, catalog: RuntimeCatalog): PluginGroup | 'hidden' {
  if (moduleName.startsWith('@deepseek-ai/') || moduleName.includes(':')) return 'hidden'
  const row = catalogRow(entryId, catalog)
  if (row) return row.locked ? 'core' : 'optional'
  if (isProtectedPackage(packageNameOf(moduleName), catalog.bundles)) return 'hidden'
  return 'community'
}

export function catalogFor(entryId: string, moduleName: string, catalog: RuntimeCatalog): CatalogEntry {
  const row = catalogRow(entryId, catalog)
  if (row) return { title: row.title, description: row.description, group: row.locked ? 'core' : 'optional' }
  const short = packageNameOf(moduleName)
  const group = classifyEntry(entryId, moduleName, catalog)
  return { title: short, description: moduleName, group: group === 'community' ? 'community' : 'core' }
}

export async function readProfileBundles(profileDir: string): Promise<string[]> {
  try {
    const manifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')) as {
      dsh?: { profile?: { bundles?: string[] } }
    }
    return [...(manifest.dsh?.profile?.bundles ?? [])]
  } catch {
    return []
  }
}

async function readPackageJson(profileDir: string, packageName: string): Promise<{ name?: string; dshEditor?: DshEditorBlock } | undefined> {
  try {
    return JSON.parse(await readFile(join(profileDir, 'node_modules', packageName, 'package.json'), 'utf8')) as {
      name?: string
      dshEditor?: DshEditorBlock
    }
  } catch {
    try {
      const require = createRequire(join(profileDir, 'package.json'))
      return JSON.parse(await readFile(require.resolve(`${packageName}/package.json`), 'utf8')) as {
        name?: string
        dshEditor?: DshEditorBlock
      }
    } catch {
      return undefined
    }
  }
}

function asRuntimeCatalog(value: unknown): RuntimeCatalog | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as { bundles?: unknown; entries?: unknown }
  if (!record.entries || typeof record.entries !== 'object' || Array.isArray(record.entries)) return undefined
  const entries: Record<string, RuntimeCatalogEntry> = {}
  for (const [id, row] of Object.entries(record.entries as Record<string, unknown>)) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue
    const item = row as Record<string, unknown>
    if (typeof item.title !== 'string' || typeof item.description !== 'string' || typeof item.packageName !== 'string') continue
    entries[id] = {
      title: item.title,
      description: item.description,
      locked: item.locked === true,
      packageName: item.packageName,
      ...(typeof item.feature === 'string' ? { feature: item.feature } : {}),
    }
  }
  return {
    entries,
    bundles: Array.isArray(record.bundles) ? record.bundles.filter((name): name is string => typeof name === 'string') : [],
  }
}

export async function readPreparedCatalog(profileDir: string): Promise<RuntimeCatalog | undefined> {
  try {
    return asRuntimeCatalog(JSON.parse(await readFile(join(profileDir, RUNTIME_CATALOG_FILE), 'utf8')))
  } catch {
    return undefined
  }
}

export async function loadRuntimeCatalog(profileDir: string, packageNames: Iterable<string>): Promise<RuntimeCatalog> {
  const prepared = await readPreparedCatalog(profileDir)
  const bundles = prepared?.bundles.length ? prepared.bundles : await readProfileBundles(profileDir)
  const known = new Set(Object.values(prepared?.entries ?? {}).map((row) => row.packageName))
  const names = new Set<string>([...bundles, ...packageNames])
  const packages: Array<{ name: string; dshEditor: DshEditorBlock }> = []
  for (const name of names) {
    if (name.startsWith('@deepseek-ai/') || known.has(name)) continue
    const manifest = await readPackageJson(profileDir, name)
    if (manifest?.dshEditor) packages.push({ name: manifest.name ?? name, dshEditor: manifest.dshEditor })
  }
  const scanned = catalogFromEditorBlocks(packages, bundles)
  if (!prepared) return scanned
  return { bundles, entries: { ...prepared.entries, ...scanned.entries } }
}
