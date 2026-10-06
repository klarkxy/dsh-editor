import { syncPresetDeclarations } from './preset-config.js'
import { migrateWritingSettings } from './settings-migration.js'
import { copyFile, cp, mkdir, readdir, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import {
  BUNDLED_PACKAGES_DIR,
  copyRetargetedProfileTree,
  ensureNativeWorkspace,
  importerSpecsEqual,
  linkSdkIntoArtifactTree,
  nativeMigrationComplete,
  nativeReuseLayoutReady,
  preserveNativeProfileState,
  PROFILE_CONFIG_PACKAGE,
  projectRuntimeLinks,
  readCompositionPackages,
  readNativeBaseline,
  reconcileNativeLockfile,
  resolveNativeNodePath,
  restoreHomePluginFiles,
  retargetInternalLinkTargets,
  snapshotHomePluginFiles,
  writeNativeMigrationMarker,
  type NativePluginCommand,
} from './native-profile.js'
import { restoreUserPlugins, sanitizeHostLockedPluginOverrides } from './user-plugins.js'
import { linkPointsTo, sameFileTree } from './file-tree.js'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export const PROFILE_NAME = 'dsh-editor'
export const PROFILE_MARKER = '.dsh-editor-owner.json'
/** Bump when skip-path invariants change so old stamps restage. */
export const PROFILE_DEPLOY_ALGORITHM = 4

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

export interface ProfileDeployOptions {
  writeFile?: typeof writeFile
  nodePath?: string
  env?: NodeJS.ProcessEnv
  runPluginCommand?: NativePluginCommand
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

async function readTemplatePackageManifest(template: string, name: string): Promise<{ name?: unknown; dsh?: { bundle?: unknown } }> {
  const candidates = name === PROFILE_CONFIG_PACKAGE
    ? [
      join(template, 'profile-config', 'package.json'),
      join(template, 'node_modules', name, 'package.json'),
    ]
    : [
      join(template, BUNDLED_PACKAGES_DIR, ...name.split('/'), 'package.json'),
      join(template, 'node_modules', ...name.split('/'), 'package.json'),
    ]
  for (const candidate of candidates) {
    try {
      return JSON.parse(await readFile(candidate, 'utf8')) as { name?: unknown; dsh?: { bundle?: unknown } }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  throw new Error(`Required profile package is missing or unreadable: ${name}`)
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
  for (const name of [...packages, ...libraries, PROFILE_CONFIG_PACKAGE]) {
    if (typeof name !== 'string' || !/^(?:@[^/]+\/)?[A-Za-z0-9._-]+$/.test(name)) {
      throw new Error(`Invalid required profile package: ${String(name)}`)
    }
    const manifest = await readTemplatePackageManifest(template, name)
    if (manifest.name !== name || ((packages.includes(name) || name === PROFILE_CONFIG_PACKAGE) && !manifest.dsh?.bundle)) {
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
  const gate = await nativeReuseLayoutReady(profilePath, template, runtimeNodeModules)
  if (gate === 'restage') return false
  if (gate === 'legacy') {
    if (!await bundledEntriesPresent(template, profilePath)) return false
    if (runtimeNodeModules && !await peerLinksValid(profilePath, runtimeNodeModules)) return false
  }
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

async function stageProfileTree(template: string, stage: string, runtimeNodeModules?: string): Promise<void> {
  const nativeLayout = existsSync(join(template, 'bundled-packages')) || await readNativeBaseline(template) !== undefined
  await copyRetargetedProfileTree(template, stage, { skip: runtimeNodeModules && nativeLayout ? ['runtime-links'] : [] })
  if (!runtimeNodeModules) return
  if (nativeLayout) {
    const appNames = new Set<string>([PROFILE_CONFIG_PACKAGE])
    for (const name of await readCompositionPackages(stage)) appNames.add(name)
    const baseline = await readNativeBaseline(stage)
    if (baseline) for (const name of Object.keys(baseline)) appNames.add(name)
    await projectRuntimeLinks(stage, runtimeNodeModules, appNames)
    await linkSdkIntoArtifactTree(stage, runtimeNodeModules)
    return
  }
  const peerParent = join(stage, 'node_modules', '@deepseek-ai')
  await mkdir(peerParent, { recursive: true })
  for (const peer of PEER_PACKAGES) {
    const source = join(runtimeNodeModules, '@deepseek-ai', peer)
    if (!existsSync(source)) throw new Error(`Bundled DSH dependency is missing: ${source}`)
    await symlink(source, join(peerParent, peer), 'junction')
  }
}

async function replaceOwnedProfile(
  profiles: string,
  target: string,
  template: string,
  runtimeNodeModules: string | undefined,
  options: ProfileDeployOptions = {},
  deploy?: ProfileDeployIdentity,
): Promise<string | undefined> {
  const nonce = randomUUID()
  const stage = join(profiles, `.${PROFILE_NAME}.stage-${nonce}`)
  const backup = join(profiles, `.${PROFILE_NAME}.backup-${nonce}`)
  let swapped = false
  let backedUp = false
  try {
    await stageProfileTree(template, stage, runtimeNodeModules)
    const previousMarker = await readOwnerMarker(target)
    const hasUserConfig = previousMarker?.configVersion === 2 || existsSync(join(target, '.editor-writing-migrated'))
      || existsSync(join(target, 'node_modules', PROFILE_CONFIG_PACKAGE, 'package.json'))
      || existsSync(join(target, 'profile-config', 'package.json'))
    if (!hasUserConfig && existsSync(join(target, 'cordis.patch.yml'))) {
      await copyFile(join(target, 'cordis.patch.yml'), join(stage, 'cordis.patch.before-dsh-0.1.7.yml'))
    }
    const preserved = await preserveNativeProfileState(target, stage, {
      mergePatch: hasUserConfig,
      runtimeNodeModules,
    })
    const canReconcile = Boolean(options.runPluginCommand || runtimeNodeModules)
      && existsSync(join(stage, 'pnpm-lock.yaml'))
      && !importerSpecsEqual(preserved.previousDependencies, preserved.mergedDependencies)
    if (canReconcile) {
      if (!runtimeNodeModules) throw new Error('Native lock reconciliation requires the actual runtime node_modules')
      await reconcileNativeLockfile({
        stage,
        runtimeNodeModules,
        nodePath: resolveNativeNodePath(options, deploy, options.env),
        env: options.env,
        previousDependencies: preserved.previousDependencies,
        mergedDependencies: preserved.mergedDependencies,
        runPluginCommand: options.runPluginCommand,
      })
    }
    await writeOwnerMarker(stage)
    if (existsSync(target)) {
      await renameDirectory(target, backup)
      backedUp = true
    }
    try {
      await renameDirectory(stage, target)
      swapped = true
    } catch (error) {
      try {
        if (backedUp && existsSync(backup) && !existsSync(target)) await renameDirectory(backup, target)
      } catch (cleanupError) {
        console.warn('Could not restore owned profile backup:', backup, cleanupError)
      }
      throw error
    }
    await retargetInternalLinkTargets(target, stage, target)
    return backedUp && existsSync(backup) ? backup : undefined
  } catch (error) {
    try {
      if (swapped && existsSync(target)) await rm(target, { recursive: true, force: true })
      if (backedUp && existsSync(backup) && !existsSync(target)) await renameDirectory(backup, target)
      if (existsSync(stage)) await rm(stage, { recursive: true, force: true })
    } catch (cleanupError) {
      console.warn('Could not roll back owned profile replacement:', target, cleanupError)
    }
    throw error
  }
}

/** Deploy the owned profile. Same identity skips the tree copy; sanitize and preset/plugin sync still run. */
export async function deployOwnedProfile(
  home: string,
  template: string,
  runtimeNodeModules?: string,
  deploy?: ProfileDeployIdentity,
  options: ProfileDeployOptions = {},
): Promise<ProfileDeployResult> {
  if (runtimeNodeModules) await assertRequiredCompositionPackages(template)
  const bundled = await readTemplateBundles(template)
  const profiles = join(home, 'profiles')
  const target = join(profiles, PROFILE_NAME)
  const previousOwned = existsSync(target) && await isOwnedProfile(target)
  const homeSnaps = await snapshotHomePluginFiles(home)
  const presetSwaps: PresetSwap[] = []
  let backup: string | undefined
  let reused = false
  try {
    await sanitizeHostLockedPluginOverrides(home, bundled)
    await mkdir(profiles, { recursive: true })
    await ensureDirectory(target)
    if (existsSync(target) && !(await isOwnedProfile(target))) throw new ProfileCollisionError(target)
    reused = Boolean(deploy && existsSync(target) && await canReuseProfile(target, template, runtimeNodeModules, deploy))
    if (!reused) backup = await replaceOwnedProfile(profiles, target, template, runtimeNodeModules, options, deploy)
    await deployAgentPresets(home, template, presetSwaps)
    await restoreUserPlugins(home, target, bundled)
    await syncPresetDeclarations(home, target)
    await migrateWritingSettings(home, target)
    await ensureNativeWorkspace(target)
    if (!(await nativeMigrationComplete(home))) {
      await writeNativeMigrationMarker(home, options?.writeFile ?? writeFile)
    }
    if (deploy) await writeOwnerMarker(target, deploy)
    await commitPresetSwaps(presetSwaps)
    if (backup && existsSync(backup)) await rm(backup, { recursive: true, force: true })
  } catch (error) {
    await restoreHomePluginFiles(homeSnaps)
    await restorePresetSwaps(presetSwaps)
    if (backup && existsSync(backup)) {
      if (existsSync(target)) await rm(target, { recursive: true, force: true })
      await renameDirectory(backup, target)
    } else if (!previousOwned && existsSync(target) && await isOwnedProfile(target)) {
      await rm(target, { recursive: true, force: true })
    }
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
type PresetSwap = { target: string; backup?: string }

async function commitPresetSwaps(swaps: readonly PresetSwap[]): Promise<void> {
  for (const swap of swaps) {
    if (swap.backup && existsSync(swap.backup)) await rm(swap.backup, { recursive: true, force: true })
  }
}

async function restorePresetSwaps(swaps: readonly PresetSwap[]): Promise<void> {
  for (const swap of [...swaps].reverse()) {
    if (swap.backup && existsSync(swap.backup)) {
      if (existsSync(swap.target)) await rm(swap.target, { recursive: true, force: true })
      await renameDirectory(swap.backup, swap.target)
    } else if (existsSync(swap.target)) {
      await rm(swap.target, { recursive: true, force: true })
    }
  }
}

async function deployAgentPresets(home: string, template: string, swaps: PresetSwap[]): Promise<void> {
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
      if (owner) {
        const nonce = randomUUID()
        const backup = join(presets, `.${entry.name}.backup-${nonce}`)
        await renameDirectory(target, backup)
        swaps.push({ target, backup })
      }
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
      swaps.push({ target, backup: existsSync(backup) ? backup : undefined })
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
