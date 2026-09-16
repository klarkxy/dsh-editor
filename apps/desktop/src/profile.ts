import { copyFile, cp, lstat, mkdir, readdir, readFile, readlink, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { restoreUserPlugins } from './user-plugins.js'
import { existsSync } from 'node:fs'
import { isAbsolute, join, resolve as resolvePath } from 'node:path'
import { randomUUID } from 'node:crypto'

export const PROFILE_NAME = 'dsh-editor'
export const PROFILE_MARKER = '.dsh-editor-owner.json'

export class ProfileCollisionError extends Error {
  constructor(profilePath: string) {
    super(`Refusing to replace ${profilePath}: it is not marked as owned by DSH Editor.`)
    this.name = 'ProfileCollisionError'
  }
}

export function resolveDshHome(env: NodeJS.ProcessEnv, homeDirectory: string): string {
  return env.DSH_HOME?.trim() || join(homeDirectory, '.dsh-editor')
}

async function isOwnedProfile(profilePath: string): Promise<boolean> {
  try {
    const marker = JSON.parse(await readFile(join(profilePath, PROFILE_MARKER), 'utf8')) as { app?: unknown; schema?: unknown }
    return marker.app === 'dsh-editor' && marker.schema === 1
  } catch { return false }
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

/** Deploy only the marked profile, staging beside it so DSH home data survives. */
export async function deployProfile(home: string, template: string, runtimeNodeModules?: string): Promise<string> {
  const profiles = join(home, 'profiles')
  const target = join(profiles, PROFILE_NAME)
  await mkdir(profiles, { recursive: true })
  await ensureDirectory(target)
  if (existsSync(target) && !(await isOwnedProfile(target))) throw new ProfileCollisionError(target)
  const nonce = randomUUID()
  const stage = join(profiles, `.${PROFILE_NAME}.stage-${nonce}`)
  const backup = join(profiles, `.${PROFILE_NAME}.backup-${nonce}`)
  try {
    await copyTemplateTree(template, stage)
    if (runtimeNodeModules) {
      const peerParent = join(stage, 'node_modules', '@deepseek-ai')
      await mkdir(peerParent, { recursive: true })
      for (const peer of ['dsh-tools', 'dsh-llm']) {
        const target = join(runtimeNodeModules, '@deepseek-ai', peer)
        if (!existsSync(target)) throw new Error(`Bundled DSH dependency is missing: ${target}`)
        await symlink(target, join(peerParent, peer), 'junction')
      }
    }
    await writeFile(join(stage, PROFILE_MARKER), `${JSON.stringify({ app: 'dsh-editor', schema: 1 })}\n`, 'utf8')
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
  await deployAgentPresets(home, template)
  await restoreUserPlugins(home, target)
  return target
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
