import { cp, mkdir, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
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
    await cp(template, stage, { recursive: true, force: false, errorOnExist: true })
    if (runtimeNodeModules) {
      const toolsTarget = join(runtimeNodeModules, '@deepseek-ai', 'dsh-tools')
      if (!existsSync(toolsTarget)) throw new Error(`Bundled DSH tools dependency is missing: ${toolsTarget}`)
      const toolsParent = join(stage, 'node_modules', '@deepseek-ai')
      await mkdir(toolsParent, { recursive: true })
      await symlink(toolsTarget, join(toolsParent, 'dsh-tools'), 'junction')
    }
    await writeFile(join(stage, PROFILE_MARKER), `${JSON.stringify({ app: 'dsh-editor', schema: 1 })}\n`, 'utf8')
    if (existsSync(target)) await renameDirectory(target, backup)
    try { await renameDirectory(stage, target) } catch (error) {
      if (existsSync(backup) && !existsSync(target)) await renameDirectory(backup, target)
      throw error
    }
    if (existsSync(backup)) await rm(backup, { recursive: true, force: true })
    return target
  } catch (error) {
    if (existsSync(stage)) await rm(stage, { recursive: true, force: true })
    throw error
  }
}
