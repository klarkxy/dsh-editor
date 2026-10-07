import { REQUIRED_CORE_BUNDLES, RETIRED_PLUGIN_PACKAGES } from '../../../apps/desktop/src/distribution-contract.ts'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'
import { isSafeEntryId, isSafePackageName } from './core.ts'

function exportTarget(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const row = value as Record<string, unknown>
  for (const key of ['default', 'import', 'require', 'node']) {
    if (typeof row[key] === 'string' && row[key].trim()) return row[key]
  }
  return undefined
}

function toolsExportExists(pkgDir: string, manifest: Record<string, unknown>): boolean {
  const exportsMap = manifest.exports && typeof manifest.exports === 'object' && !Array.isArray(manifest.exports)
    ? manifest.exports as Record<string, unknown>
    : {}
  const target = exportTarget(exportsMap['./tools'])
  if (!target) return false
  const cleaned = target.replace(/^\.\//, '').replaceAll('\\', '/')
  if (!cleaned || cleaned.includes('..') || cleaned.includes('://')) return false
  return existsSync(join(pkgDir, ...cleaned.split('/')))
}

function declaredToolInserts(pkgDir: string, name: string, manifest: Record<string, unknown>): Array<{ id: string; name: string }> {
  const dshEditor = manifest.dshEditor && typeof manifest.dshEditor === 'object' && !Array.isArray(manifest.dshEditor)
    ? manifest.dshEditor as Record<string, unknown>
    : {}
  const declarations = dshEditor.inserts
  if (!Array.isArray(declarations) || !toolsExportExists(pkgDir, manifest)) return []
  const declaredEntries = Array.isArray(dshEditor.entries)
    ? dshEditor.entries.flatMap((row) => row && typeof row === 'object' && typeof (row as { id?: unknown }).id === 'string' ? [(row as { id: string }).id] : [])
    : []
  const inserts: Array<{ id: string; name: string }> = []
  for (const declaration of declarations) {
    const row = declaration && typeof declaration === 'object' && !Array.isArray(declaration) ? declaration as Record<string, unknown> : {}
    if (typeof row.id !== 'string' || !isSafeEntryId(row.id) || row.id === 'root' || row.id.startsWith('editor-preset-')) continue
    if (declaredEntries.includes(row.id)) continue
    if (row.name !== `${name}/tools`) continue
    if (row.requires !== undefined && (!Array.isArray(row.requires) || row.requires.some((id) => typeof id !== 'string' || !declaredEntries.includes(id)))) continue
    inserts.push({ id: row.id, name: row.name })
  }
  return inserts
}

async function selectedToolInserts(profileDir: string): Promise<Array<{ id: string; name: string }>> {
  let bundles: string[] = []
  try {
    const profile = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')) as { dsh?: { profile?: { bundles?: unknown } } }
    bundles = Array.isArray(profile.dsh?.profile?.bundles) ? profile.dsh.profile.bundles.filter((name): name is string => typeof name === 'string') : []
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
    return []
  }
  let shipped: string[] = []
  try {
    const composition = JSON.parse(await readFile(join(profileDir, 'composition.json'), 'utf8')) as { packages?: unknown; libraries?: unknown }
    shipped = [
      ...(Array.isArray(composition.packages) ? composition.packages : []),
      ...(Array.isArray(composition.libraries) ? composition.libraries : []),
    ].filter((name): name is string => typeof name === 'string')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
  }
  const skip = new Set([...shipped, ...REQUIRED_CORE_BUNDLES, ...RETIRED_PLUGIN_PACKAGES])
  const rows: Array<{ id: string; name: string }> = []
  for (const name of [...new Set(bundles)].sort()) {
    if (!isSafePackageName(name) || skip.has(name)) continue
    const pkgDir = join(profileDir, 'node_modules', name)
    let manifest: Record<string, unknown>
    try {
      manifest = JSON.parse(await readFile(join(pkgDir, 'package.json'), 'utf8')) as Record<string, unknown>
    } catch {
      continue
    }
    if (manifest.name !== name) continue
    rows.push(...declaredToolInserts(pkgDir, name, manifest))
  }
  return rows
}

/** Existing preset directories are distribution artifacts; the native registry owns live definitions. */
export async function syncPresetDeclarations(home: string, profileDir: string): Promise<void> {
  const root = join(home, '.agent-presets')
  let entries: import('node:fs').Dirent[]
  try { entries = await readdir(root, { withFileTypes: true }) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    entries = []
  }
  const rows: Array<{ id: string; name: string; config?: unknown }> = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const dir = join(root, entry.name)
    let text: string
    try { text = await readFile(join(dir, 'preset.yml'), 'utf8') } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    const meta = parse(text) as { name?: string; description?: string; order?: number } | null
    const baseUrl = pathToFileURL(dir + '/').href
    const plugins = parse(await readFile(join(dir, 'agent.cordis.yml'), 'utf8'), { customTags: [{
      tag: 'tag:yaml.org,2002:js',
      resolve: (expression: string) => ({ __jsExpr: `((baseUrl) => (${expression}))(${JSON.stringify(baseUrl)})` }),
    }] }) as unknown
    if (!Array.isArray(plugins)) throw new Error(`Invalid preset composition: ${entry.name}`)
    const anchor = (rows: unknown[]): void => {
      for (const item of rows) {
        if (!item || typeof item !== 'object') throw new Error(`Invalid preset row: ${entry.name}`)
        const row = item as { name?: unknown; group?: boolean; config?: unknown }
        if (typeof row.name !== 'string') throw new Error(`Missing preset plugin name: ${entry.name}`)
        if (isAbsolute(row.name) || row.name.startsWith('./') || row.name.startsWith('../')) row.name = pathToFileURL(resolve(dir, row.name)).href
        if (row.group && Array.isArray(row.config)) anchor(row.config)
      }
    }
    anchor(plugins)
    rows.push({ id: `editor-preset-${entry.name}`, name: '@deepseek-ai/dsh-agent-preset', config: {
      id: entry.name, ...(meta?.name ? { name: meta.name } : {}),
      ...(meta?.description ? { description: meta.description } : {}),
      ...(typeof meta?.order === 'number' ? { order: meta.order } : {}),
      plugins,
    } })
  }
  rows.push(...await selectedToolInserts(profileDir))
  const bundle = join(profileDir, 'node_modules', 'dsh-editor-profile-config')
  await mkdir(bundle, { recursive: true })
  const file = join(bundle, 'presets.patch.json')
  const content = JSON.stringify([{ insert: rows }], null, 2) + '\n'
  try { if (await readFile(file, 'utf8') === content) return } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, content)
  await rename(temporary, file)
}
