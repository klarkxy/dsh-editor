import { createHash, randomUUID } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const CACHE_NAME = 'dsh-editor-runtime'
const CACHE_MARKER = '.dsh-editor-runtime.json'
const CACHE_SCHEMA = 1
const EXPECTED_NODE_VERSION = '24.16.0'
const EXPECTED_DSH_VERSION = '0.1.1-rc.2'
const PLATFORM_ID = `${process.platform}-${process.arch}`
const NODE_EXECUTABLE = process.platform === 'win32' ? 'node.exe' : 'node'

export interface TreeDigest { sha256: string; files: number; bytes: number }
interface RuntimeManifest {
  format: number
  platform: string
  node: TreeDigest & { version: string }
  dsh: TreeDigest & { version: string }
  profile: TreeDigest
}
interface CacheMarker { app?: unknown; schema?: unknown; manifest?: unknown }
export interface CachedRuntime { nodePath: string; cliPath: string; template: string }

export async function treeDigest(root: string): Promise<TreeDigest> {
  const hash = createHash('sha256')
  let files = 0
  let bytes = 0
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) { await visit(path); continue }
      if (!entry.isFile()) continue
      const data = await readFile(path)
      hash.update(relative(root, path).replaceAll('\\', '/'))
      hash.update('\0')
      hash.update(createHash('sha256').update(data).digest('hex'))
      hash.update('\n')
      files += 1
      bytes += data.byteLength
    }
  }
  await visit(root)
  return { sha256: hash.digest('hex'), files, bytes }
}

function sameDigest(actual: TreeDigest, expected: TreeDigest): boolean {
  return actual.sha256 === expected.sha256 && actual.files === expected.files && actual.bytes === expected.bytes
}
function manifestKey(manifest: RuntimeManifest): string { return JSON.stringify(manifest) }
function assertManifest(value: unknown): asserts value is RuntimeManifest {
  const manifest = value as Partial<RuntimeManifest>
  if (manifest?.format !== 1 || manifest.platform !== PLATFORM_ID || manifest.node?.version !== EXPECTED_NODE_VERSION || manifest.dsh?.version !== EXPECTED_DSH_VERSION) {
    throw new Error('Bundled desktop runtime manifest has an unsupported identity.')
  }
  for (const entry of [manifest.node, manifest.dsh, manifest.profile]) {
    if (!entry || typeof entry.sha256 !== 'string' || !Number.isInteger(entry.files) || !Number.isInteger(entry.bytes)) throw new Error('Bundled desktop runtime manifest is invalid.')
  }
}
async function readManifest(resources: string): Promise<RuntimeManifest> {
  const manifest = JSON.parse(await readFile(join(resources, 'runtime-manifest.json'), 'utf8')) as unknown
  assertManifest(manifest)
  return manifest
}
async function owned(path: string, manifest: RuntimeManifest): Promise<boolean> {
  try {
    const marker = JSON.parse(await readFile(join(path, CACHE_MARKER), 'utf8')) as CacheMarker
    return marker.app === 'dsh-editor' && marker.schema === CACHE_SCHEMA && marker.manifest === manifestKey(manifest)
  } catch { return false }
}
async function appOwned(path: string): Promise<boolean> {
  try {
    const marker = JSON.parse(await readFile(join(path, CACHE_MARKER), 'utf8')) as CacheMarker
    return marker.app === 'dsh-editor' && marker.schema === CACHE_SCHEMA
  } catch { return false }
}
async function validate(root: string, manifest: RuntimeManifest): Promise<boolean> {
  try {
    const [node, dsh, profile] = await Promise.all([
      treeDigest(join(root, 'node')),
      treeDigest(join(root, 'dsh')),
      treeDigest(join(root, 'profile-template')),
    ])
    return sameDigest(node, manifest.node) && sameDigest(dsh, manifest.dsh) && sameDigest(profile, manifest.profile)
  } catch { return false }
}
function runtimePaths(root: string): CachedRuntime {
  return {
    nodePath: join(root, 'node', NODE_EXECUTABLE),
    cliPath: join(root, 'dsh', 'lib', 'bin.js'),
    template: join(root, 'profile-template'),
  }
}

async function cleanupRuntimeBackup(backup: string): Promise<void> {
  if (!existsSync(backup)) return
  try {
    // Windows refuses to unlink a running executable. Probe it first so a live
    // old runtime stays intact instead of being partially removed.
    await rm(join(backup, 'node', NODE_EXECUTABLE), { force: true })
    await rm(backup, { recursive: true, force: true })
  } catch { /* A live old runtime releases the backup on a later app start. */ }
}

async function cleanupStaleRuntimeBackups(cacheParent: string): Promise<void> {
  let entries: import('node:fs').Dirent[]
  try { entries = await readdir(cacheParent, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    const backup = join(cacheParent, entry.name)
    if (entry.isDirectory() && entry.name.startsWith(`.${CACHE_NAME}.backup-`) && await appOwned(backup)) await cleanupRuntimeBackup(backup)
  }
}

/**
 * Portable executables are extracted to TEMP. Copy the dependency-heavy DSH
 * tree once into DSH_HOME, then run only the marked, manifest-verified cache.
 */
export async function materializePackagedRuntime(home: string, resources: string): Promise<CachedRuntime> {
  const manifest = await readManifest(resources)
  const cacheParent = join(home, 'runtime')
  const target = join(cacheParent, CACHE_NAME)
  await mkdir(cacheParent, { recursive: true })
  if (existsSync(target) && !(await owned(target, manifest))) {
    let hasAnyMarker = false
    try { hasAnyMarker = existsSync(join(target, CACHE_MARKER)) } catch { /* collision is handled below */ }
    if (!hasAnyMarker) throw new Error(`Refusing to replace unowned desktop runtime cache: ${target}`)
    const marker = JSON.parse(await readFile(join(target, CACHE_MARKER), 'utf8')) as CacheMarker
    if (marker.app !== 'dsh-editor' || marker.schema !== CACHE_SCHEMA) throw new Error(`Refusing to replace unowned desktop runtime cache: ${target}`)
  }
  if (existsSync(target) && await owned(target, manifest) && await validate(target, manifest)) {
    await cleanupStaleRuntimeBackups(cacheParent)
    return runtimePaths(target)
  }

  const nonce = randomUUID()
  const stage = join(cacheParent, `.${CACHE_NAME}.stage-${nonce}`)
  const backup = join(cacheParent, `.${CACHE_NAME}.backup-${nonce}`)
  try {
    await mkdir(stage)
    await Promise.all([
      cp(join(resources, 'node'), join(stage, 'node'), { recursive: true, dereference: true }),
      cp(join(resources, 'dsh'), join(stage, 'dsh'), { recursive: true, dereference: true }),
      cp(join(resources, 'profile-template'), join(stage, 'profile-template'), { recursive: true, dereference: true }),
    ])
    if (!(await validate(stage, manifest))) throw new Error('Persistent desktop runtime cache did not match the bundled runtime manifest.')
    await writeFile(join(stage, CACHE_MARKER), `${JSON.stringify({ app: 'dsh-editor', schema: CACHE_SCHEMA, manifest: manifestKey(manifest) })}\n`, 'utf8')
    if (existsSync(target)) await rename(target, backup)
    try { await rename(stage, target) } catch (error) {
      if (existsSync(backup) && !existsSync(target)) await rename(backup, target)
      throw error
    }
    await cleanupRuntimeBackup(backup)
    return runtimePaths(target)
  } catch (error) {
    if (existsSync(stage)) await rm(stage, { recursive: true, force: true })
    throw error
  }
}
