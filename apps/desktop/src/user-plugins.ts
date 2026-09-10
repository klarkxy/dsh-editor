import { cp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Keep in sync with packages/dsh-editor-plugins/src/core.ts. */
const PROTECTED_PACKAGES = new Set([
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  'dsh-manuscript',
  'dsh-proofread',
  'dsh-editor-workbench',
  'dsh-editor-novel-kernel',
  'dsh-zhihu',
  'dsh-editor-shell',
  'dsh-editor-plugins',
])

const PACKAGE_NAME = /^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/

function isSafePackageName(name: string): boolean {
  return PACKAGE_NAME.test(name) && !name.includes('..') && !PROTECTED_PACKAGES.has(name) && !name.startsWith('@deepseek-ai/')
}

export async function restoreUserPlugins(home: string, profilePath: string): Promise<void> {
  let state: { schema?: unknown; installed?: unknown }
  try {
    state = JSON.parse(await readFile(join(home, 'dsh-plugins.json'), 'utf8')) as { schema?: unknown; installed?: unknown }
  } catch {
    return
  }
  if (state.schema !== 1 || !Array.isArray(state.installed)) return
  const manifestPath = join(profilePath, 'package.json')
  let manifest: { dsh?: { profile?: { bundles?: string[] } }; dependencies?: Record<string, string> }
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as typeof manifest
  } catch {
    return
  }
  const bundles = [...(manifest.dsh?.profile?.bundles ?? [])]
  let changed = false
  for (const item of state.installed) {
    if (!item || typeof item !== 'object') continue
    const name = (item as { name?: unknown }).name
    if (typeof name !== 'string' || !isSafePackageName(name)) continue
    const source = join(home, 'user-plugins', name)
    if (!existsSync(join(source, 'package.json'))) continue
    const destination = join(profilePath, 'node_modules', name)
    await mkdir(dirname(destination), { recursive: true })
    if (existsSync(destination)) await rm(destination, { recursive: true, force: true })
    try {
      await symlink(source, destination, process.platform === 'win32' ? 'junction' : 'dir')
    } catch {
      await cp(source, destination, { recursive: true })
    }
    if (!bundles.includes(name)) {
      bundles.push(name)
      changed = true
    }
  }
  if (!changed) return
  manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles } }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}
