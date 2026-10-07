import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export type RuntimeCatalogEntry = {
  title: string
  description: string
  locked: boolean
  packageName: string
  feature?: string
  /** Exact prepared-catalog boolean. Scanned package.json cannot set this. */
  builtin?: boolean
  /** Exact prepared `'session'` or `'feature'`. Any other claim is dropped. */
  managedBy?: 'session' | 'feature'
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

export const RUNTIME_CATALOG_FILE = 'dsh-editor-catalog.json'

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
      ...(item.builtin === true || item.builtin === false ? { builtin: item.builtin } : {}),
      ...(item.managedBy === 'session' || item.managedBy === 'feature' ? { managedBy: item.managedBy } : {}),
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
