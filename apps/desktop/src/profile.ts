import { syncPresetDeclarations } from './preset-config.js'
import { migrateWritingSettings } from './settings-migration.js'
import { copyFile, cp, lstat, mkdir, readdir, readFile, readlink, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { restoreUserPlugins, sanitizeHostLockedPluginOverrides } from './user-plugins.js'
import { linkPointsTo, sameFileTree } from './file-tree.js'
import { existsSync } from 'node:fs'
import { isAbsolute, join, resolve as resolvePath } from 'node:path'
import { randomUUID } from 'node:crypto'

export const PROFILE_NAME = 'dsh-editor'
export const PROFILE_MARKER = '.dsh-editor-owner.json'
/** Bump when skip-path invariants change so old stamps restage. */
export const PROFILE_DEPLOY_ALGORITHM = 2

export interface ProfileDeployIdentity {
  algorithm: number
  profileSha256: string
  dsh: string
  nodePath: string
  cliPath: string
}

export interface ProfileDeployResult {
  path: string
  reused: boolean
}

const PEER_PACKAGES = ['dsh-tools', 'dsh-llm'] as const

export class ProfileCollisionError extends Error {
  constructor(profilePath: string) {
    super(`Refusing to replace ${profilePath}: it is not marked as owned by DSH Editor.`)
    this.name = 'ProfileCollisionError'
  }
}

export function resolveDshHome(env: NodeJS.ProcessEnv, homeDirectory: string): string {
  return env.DSH_HOME?.trim() || join(homeDirectory, '.dsh-editor')
}

async function readOwnerMarker(profilePath: string): Promise<{ app?: unknown; schema?: unknown; configVersion?: unknown; deploy?: unknown } | undefined> {
  try {
    return JSON.parse(await readFile(join(profilePath, PROFILE_MARKER), 'utf8')) as { app?: unknown; schema?: unknown; deploy?: unknown }
  } catch {
    return undefined
  }
}

async function isOwnedProfile(profilePath: string): Promise<boolean> {
  const marker = await readOwnerMarker(profilePath)
  return marker?.app === 'dsh-editor' && marker.schema === 1
}

function deployStamp(identity: ProfileDeployIdentity): ProfileDeployIdentity {
  return {
    algorithm: identity.algorithm,
    profileSha256: identity.profileSha256,
    dsh: identity.dsh,
    nodePath: identity.nodePath,
    cliPath: identity.cliPath,
  }
}

async function writeOwnerMarker(profilePath: string, deploy?: ProfileDeployIdentity): Promise<void> {
  const marker = deploy
    ? { app: 'dsh-editor', schema: 1, configVersion: 2, deploy: deployStamp(deploy) }
    : { app: 'dsh-editor', schema: 1, configVersion: 2 }
  await writeFile(join(profilePath, PROFILE_MARKER), `${JSON.stringify(marker)}\n`, 'utf8')
}

async function stampMatches(profilePath: string, deploy: ProfileDeployIdentity): Promise<boolean> {
  const marker = await readOwnerMarker(profilePath)
  if (marker?.app !== 'dsh-editor' || marker.schema !== 1) return false
  return JSON.stringify(marker.deploy) === JSON.stringify(deployStamp(deploy))
}

async function readTemplateBundles(template: string): Promise<string[]> {
  try {
    const manifest = JSON.parse(await readFile(join(template, 'package.json'), 'utf8')) as { dsh?: { profile?: { bundles?: unknown } } }
    return Array.isArray(manifest.dsh?.profile?.bundles)
      ? manifest.dsh.profile.bundles.filter((name): name is string => typeof name === 'string' && name !== '')
      : []
  } catch {
    return []
  }
}

async function assertRequiredCompositionPackages(template: string): Promise<void> {
  let composition: { packages?: unknown; libraries?: unknown }
  try {
    composition = JSON.parse(await readFile(join(template, 'composition.json'), 'utf8')) as typeof composition
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  if (!Array.isArray(composition.packages) || composition.packages.length === 0) return
  const packages = composition.packages as unknown[]
  const libraries = Array.isArray(composition.libraries) ? composition.libraries as unknown[] : []
  for (const name of [...packages, ...libraries, 'dsh-editor-profile-config']) {
    if (typeof name !== 'string' || !/^(?:@[^/]+\/)?[A-Za-z0-9._-]+$/.test(name)) {
      throw new Error(`Invalid required profile package: ${String(name)}`)
    }
    let manifest: { name?: unknown; dsh?: { bundle?: unknown } }
    try {
      manifest = JSON.parse(await readFile(join(template, 'node_modules', name, 'package.json'), 'utf8')) as typeof manifest
    } catch {
      throw new Error(`Required profile package is missing or unreadable: ${name}`)
    }
    if (manifest.name !== name || ((packages.includes(name) || name === 'dsh-editor-profile-config') && !manifest.dsh?.bundle)) {
      throw new Error(`Required profile package is invalid: ${name}`)
    }
  }
}
async function requiredTemplateFilesPresent(template: string, profilePath: string): Promise<boolean> {
  let entries: import('node:fs').Dirent[]
  try { entries = await readdir(template, { withFileTypes: true }) } catch { return false }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'agent-presets' || entry.name.startsWith('.')) continue
    if (!entry.isFile()) continue
    if (!existsSync(join(profilePath, entry.name))) return false
  }
  return existsSync(join(profilePath, 'package.json'))
}

async function bundledEntriesPresent(template: string, profilePath: string): Promise<boolean> {
  for (const name of await readTemplateBundles(template)) {
    const source = join(template, 'node_modules', name)
    if (!existsSync(source)) continue
    const destination = join(profilePath, 'node_modules', name)
    if (!existsSync(destination)) return false
  }
  return true
}

async function peerLinksValid(profilePath: string, runtimeNodeModules: string): Promise<boolean> {
  for (const peer of PEER_PACKAGES) {
    const target = join(runtimeNodeModules, '@deepseek-ai', peer)
    if (!existsSync(target)) return false
    if (!await linkPointsTo(join(profilePath, 'node_modules', '@deepseek-ai', peer), target)) return false
  }
  return true
}

async function canReuseProfile(
  profilePath: string,
  template: string,
  runtimeNodeModules: string | undefined,
  deploy: ProfileDeployIdentity,
): Promise<boolean> {
  if (!await stampMatches(profilePath, deploy)) return false
  if (!await requiredTemplateFilesPresent(template, profilePath)) return false
  if (!await bundledEntriesPresent(template, profilePath)) return false
  if (runtimeNodeModules && !await peerLinksValid(profilePath, runtimeNodeModules)) return false
  return true
}

async function ensureDirectory(path: string): Promise<void> {
  if (!existsSync(path)) return
  if (!(await stat(path)).isDirectory()) throw new ProfileCollisionError(path)
}

async function renameDirectory(source: string, target: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(source, target)
      return
    } catch (error) {
      const transientWindowsRename = process.platform === 'win32'
        && (error as NodeJS.ErrnoException).code === 'EPERM'
        && attempt < 4
      if (!transientWindowsRename) throw error
      await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)))
    }
  }
}

/** Copy a profile template, recreating Windows junctions instead of following or file-symlinking them. */
async function copyTemplateTree(source: string, target: string): Promise<void> {
  await mkdir(target, { recursive: true })
  const entries = await readdir(source, { withFileTypes: true })
  for (const entry of entries) {
    const from = join(source, entry.name)
    const to = join(target, entry.name)
    const link = entry.isSymbolicLink() || (await lstat(from)).isSymbolicLink()
    if (link) {
      const real = await readlink(from)
      await symlink(isAbsolute(real) ? real : resolvePath(source, real), to, 'junction')
      continue
    }
    if (entry.isDirectory()) {
      await copyTemplateTree(from, to)
      continue
    }
    await copyFile(from, to)
  }
}

async function stageProfileTree(template: string, stage: string, runtimeNodeModules?: string): Promise<void> {
  await copyTemplateTree(template, stage)
  if (!runtimeNodeModules) return
  const peerParent = join(stage, 'node_modules', '@deepseek-ai')
  await mkdir(peerParent, { recursive: true })
  for (const peer of PEER_PACKAGES) {
    const source = join(runtimeNodeModules, '@deepseek-ai', peer)
    if (!existsSync(source)) throw new Error(`Bundled DSH dependency is missing: ${source}`)
    await symlink(source, join(peerParent, peer), 'junction')
  }
}

async function replaceOwnedProfile(profiles: string, target: string, template: string, runtimeNodeModules?: string): Promise<void> {
  const nonce = randomUUID()
  const stage = join(profiles, `.${PROFILE_NAME}.stage-${nonce}`)
  const backup = join(profiles, `.${PROFILE_NAME}.backup-${nonce}`)
  try {
    await stageProfileTree(template, stage, runtimeNodeModules)
    // Since DSH 0.1.7 this file is user data, separate from the generated bundle.
    const previousMarker = await readOwnerMarker(target)
    const hasUserConfig = previousMarker?.configVersion === 2 || existsSync(join(target, '.editor-writing-migrated'))
      || existsSync(join(target, 'node_modules', 'dsh-editor-profile-config', 'package.json'))
    if (hasUserConfig) {
      for (const file of ['cordis.patch.yml', '.editor-writing-migrated']) {
        try { await copyFile(join(target, file), join(stage, file)) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      }
    } else if (existsSync(join(target, 'cordis.patch.yml'))) {
      await copyFile(join(target, 'cordis.patch.yml'), join(stage, 'cordis.patch.before-dsh-0.1.7.yml'))
    }
    try { await copyFile(join(target, 'cordis.patch.before-dsh-0.1.7.yml'), join(stage, 'cordis.patch.before-dsh-0.1.7.yml')) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    await writeOwnerMarker(stage)
    if (existsSync(target)) await renameDirectory(target, backup)
    try { await renameDirectory(stage, target) } catch (error) {
      if (existsSync(backup) && !existsSync(target)) await renameDirectory(backup, target)
      throw error
    }
    if (existsSync(backup)) await rm(backup, { recursive: true, force: true })
  } catch (error) {
    if (existsSync(stage)) await rm(stage, { recursive: true, force: true })
    throw error
  }
}

/** Deploy the owned profile. Same identity skips the tree copy; sanitize and preset/plugin sync still run. */
export async function deployOwnedProfile(
  home: string,
  template: string,
  runtimeNodeModules?: string,
  deploy?: ProfileDeployIdentity,
): Promise<ProfileDeployResult> {
  if (runtimeNodeModules) await assertRequiredCompositionPackages(template)
  await sanitizeHostLockedPluginOverrides(home)
  const profiles = join(home, 'profiles')
  const target = join(profiles, PROFILE_NAME)
  await mkdir(profiles, { recursive: true })
  await ensureDirectory(target)
  if (existsSync(target) && !(await isOwnedProfile(target))) throw new ProfileCollisionError(target)
  const reused = Boolean(deploy && existsSync(target) && await canReuseProfile(target, template, runtimeNodeModules, deploy))
  if (!reused) await replaceOwnedProfile(profiles, target, template, runtimeNodeModules)
  const bundled = await readTemplateBundles(template)
  try {
    await deployAgentPresets(home, template)
    await restoreUserPlugins(home, target, bundled)
    await syncPresetDeclarations(home, target)
    await migrateWritingSettings(home, target)
    if (deploy) await writeOwnerMarker(target, deploy)
  } catch (error) {
    if (existsSync(target) && await isOwnedProfile(target)) await writeOwnerMarker(target)
    throw error
  }
  return { path: target, reused }
}

/** Deploy only the marked profile, staging beside it so DSH home data survives. */
export async function deployProfile(home: string, template: string, runtimeNodeModules?: string, deploy?: ProfileDeployIdentity): Promise<string> {
  return (await deployOwnedProfile(home, template, runtimeNodeModules, deploy)).path
}

/**
 * First-party toggleable presets declared by the composition. App-owned presets
 * absent from this list (the legacy `dsh-editor` and the locked
 * `dsh-editor-writing` fallback) always deploy.
 */
async function readToggleablePresetIds(template: string): Promise<Set<string>> {
  try {
    const composition = JSON.parse(await readFile(join(template, 'composition.json'), 'utf8')) as { presets?: unknown }
    const ids = new Set<string>()
    if (Array.isArray(composition.presets)) {
      for (const row of composition.presets) {
        const id = (row as { id?: unknown } | null)?.id
        if (typeof id === 'string' && /^[A-Za-z0-9._-]+$/.test(id)) ids.add(id)
      }
    }
    return ids
  } catch {
    return new Set()
  }
}

/** Author toggles from `<home>/dsh-plugins.json`; a missing file means everything enabled. */
async function readDisabledPresetIds(home: string, toggleable: ReadonlySet<string>): Promise<Set<string>> {
  const disabled = new Set<string>()
  if (toggleable.size === 0) return disabled
  try {
    const state = JSON.parse(await readFile(join(home, 'dsh-plugins.json'), 'utf8')) as { schema?: unknown; presets?: unknown }
    if (state.schema !== 1 || !state.presets || typeof state.presets !== 'object' || Array.isArray(state.presets)) return disabled
    for (const [id, enabled] of Object.entries(state.presets as Record<string, unknown>)) {
      if (enabled === false && toggleable.has(id)) disabled.add(id)
    }
  } catch { /* no state yet */ }
  return disabled
}

/**
 * Deploy the app-owned agent presets from the template into the harness-home
 * user preset root. Same ownership and staging rules as the profile itself:
 * only directories carrying the editor marker are ever replaced. The roster
 * skips dot-directories, so in-flight stage/backup siblings are invisible.
 * The template copy inside the deployed profile keeps an inert duplicate of
 * this directory; the live copy is the one under `.agent-presets`.
 * Toggleable first-party presets the author disabled are skipped, and a
 * previously deployed app-owned copy is removed so the roster drops it.
 */
async function deployAgentPresets(home: string, template: string): Promise<void> {
  let entries: import('node:fs').Dirent[]
  try { entries = await readdir(join(template, 'agent-presets'), { withFileTypes: true }) } catch { return }
  const toggleable = await readToggleablePresetIds(template)
  const disabled = await readDisabledPresetIds(home, toggleable)
  const presets = join(home, '.agent-presets')
  await mkdir(presets, { recursive: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const source = join(template, 'agent-presets', entry.name)
    const target = join(presets, entry.name)
    if (disabled.has(entry.name)) {
      const owner = await readPresetOwnerMarker(target)
      if (owner) await rm(target, { recursive: true, force: true })
      continue
    }
    await ensureDirectory(target)
    if (existsSync(target) && !(await isOwnedProfile(target))) throw new ProfileCollisionError(target)
    if (existsSync(target) && await sameFileTree(source, target)) continue
    const nonce = randomUUID()
    const stage = join(presets, `.${entry.name}.stage-${nonce}`)
    const backup = join(presets, `.${entry.name}.backup-${nonce}`)
    try {
      await cp(source, stage, { recursive: true, force: false, errorOnExist: true })
      if (existsSync(target)) await renameDirectory(target, backup)
      try { await renameDirectory(stage, target) } catch (error) {
        if (existsSync(backup) && !existsSync(target)) await renameDirectory(backup, target)
        throw error
      }
      if (existsSync(backup)) await rm(backup, { recursive: true, force: true })
    } catch (error) {
      if (existsSync(stage)) await rm(stage, { recursive: true, force: true })
      throw error
    }
  }
}

/** True only for directories carrying the app-owned preset marker without a plugin owner. */
async function readPresetOwnerMarker(directory: string): Promise<boolean> {
  try {
    const marker = JSON.parse(await readFile(join(directory, PROFILE_MARKER), 'utf8')) as { app?: unknown; schema?: unknown; plugin?: unknown }
    return marker.app === 'dsh-editor' && marker.schema === 1 && marker.plugin === undefined
  } catch { return false }
}
