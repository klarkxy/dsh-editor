import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { copyRuntimeTree, treeMeasure, type TreeDigest } from './runtime-tree.js'
import { PROFILE_DEPLOY_ALGORITHM, type ProfileDeployIdentity } from './profile.js'
export { treeDigest } from './runtime-tree.js'
export type { TreeDigest } from './runtime-tree.js'

const CACHE_NAME = 'dsh-editor-runtime'
const CACHE_MARKER = '.dsh-editor-runtime.json'
const CACHE_SCHEMA = 1
const EXPECTED_NODE_VERSION = '24.16.0'
const EXPECTED_DSH_VERSION = '0.1.5-rc.2'
const PLATFORM_ID = `${process.platform}-${process.arch}`
const NODE_EXECUTABLE = process.platform === 'win32' ? 'node.exe' : 'node'

interface RuntimeManifest {
  format: number
  platform: string
  node: TreeDigest & { version: string }
  dsh: TreeDigest & { version: string }
  profile: TreeDigest
}
interface CacheMarker { app?: unknown; schema?: unknown; manifest?: unknown }
export interface CachedRuntime { nodePath: string; cliPath: string; template: string }

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
function runtimePaths(root: string): CachedRuntime {
  return {
    nodePath: join(root, 'node', NODE_EXECUTABLE),
    cliPath: join(root, 'dsh', 'lib', 'bin.js'),
    template: join(root, 'profile-template'),
  }
}

/** Installed / dmg builds already have a stable `resources` tree. Only the
 * portable EXE lives in TEMP and must be copied into DSH_HOME. */
export function shouldMaterializePackagedRuntime(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.PORTABLE_EXECUTABLE_FILE?.trim())
}

export function runtimeFromResources(resources: string): CachedRuntime {
  return runtimePaths(resources)
}

/** Packaged profile identity from the prepared runtime manifest. Does not hash the template. */
export function readProfileDeployIdentity(resources: string, runtime: { nodePath: string; cliPath: string }): ProfileDeployIdentity {
  const manifest = JSON.parse(readFileSync(join(resources, 'runtime-manifest.json'), 'utf8')) as unknown
  assertManifest(manifest)
  return {
    algorithm: PROFILE_DEPLOY_ALGORITHM,
    profileSha256: manifest.profile.sha256,
    dsh: `@deepseek-ai/dsh@${manifest.dsh.version}`,
    nodePath: runtime.nodePath,
    cliPath: runtime.cliPath,
  }
}

export function hasPackagedRuntimeCache(home: string): boolean {
  return existsSync(join(home, 'runtime', CACHE_NAME, CACHE_MARKER))
}

function sameMeasure(actual: { files: number; bytes: number }, expected: TreeDigest): boolean {
  return actual.files === expected.files && actual.bytes === expected.bytes
}

async function copyMatchesManifest(root: string, manifest: RuntimeManifest): Promise<boolean> {
  const [node, dsh, profile] = await Promise.all([
    treeMeasure(join(root, 'node')),
    treeMeasure(join(root, 'dsh')),
    treeMeasure(join(root, 'profile-template')),
  ])
  return sameMeasure(node, manifest.node) && sameMeasure(dsh, manifest.dsh) && sameMeasure(profile, manifest.profile)
}

function cacheReady(root: string): boolean {
  const paths = runtimePaths(root)
  return existsSync(paths.nodePath) && existsSync(paths.cliPath) && existsSync(paths.template)
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
 * Portable executables are extracted to TEMP. Copy that dependency-heavy
 * tree once into DSH_HOME, then run the marked cache. Installed builds skip
 * this and use `runtimeFromResources`. A matching owner marker plus the
 * Node/DSH entry files is enough to reuse a portable cache.
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
  if (existsSync(target) && await owned(target, manifest) && cacheReady(target)) {
    await cleanupStaleRuntimeBackups(cacheParent)
    return runtimePaths(target)
  }

  const nonce = randomUUID()
  const stage = join(cacheParent, `.${CACHE_NAME}.stage-${nonce}`)
  const backup = join(cacheParent, `.${CACHE_NAME}.backup-${nonce}`)
  try {
    await mkdir(stage)
    // A rejected copy does not cancel its siblings. Drain all writers before
    // cleanup, otherwise rm races with them and can hide ENOENT with ENOTEMPTY.
    const copies = await Promise.allSettled([
      copyRuntimeTree(join(resources, 'node'), join(stage, 'node')),
      copyRuntimeTree(join(resources, 'dsh'), join(stage, 'dsh')),
      copyRuntimeTree(join(resources, 'profile-template'), join(stage, 'profile-template')),
    ])
    const failure = copies.find((result) => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
    if (!(await copyMatchesManifest(stage, manifest))) throw new Error('Persistent desktop runtime cache did not match the bundled runtime manifest.')
    await writeFile(join(stage, CACHE_MARKER), `${JSON.stringify({ app: 'dsh-editor', schema: CACHE_SCHEMA, manifest: manifestKey(manifest) })}\n`, 'utf8')
    if (existsSync(target)) await rename(target, backup)
    try { await rename(stage, target) } catch (error) {
      try {
        if (existsSync(backup) && !existsSync(target)) await rename(backup, target)
      } catch (restoreError) {
        console.warn('Could not restore desktop runtime backup:', backup, restoreError)
      }
      throw error
    }
    await cleanupRuntimeBackup(backup)
    return runtimePaths(target)
  } catch (error) {
    try {
      await rm(stage, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    } catch (cleanupError) {
      console.warn('Could not remove desktop runtime staging directory:', stage, cleanupError)
    }
    throw error
  }
}
