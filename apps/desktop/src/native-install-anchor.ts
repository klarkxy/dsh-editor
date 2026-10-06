import { copyFile, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const MARKER = '.dsh-editor-native-install.json'
const MARKER_BODY = `${JSON.stringify({ app: 'dsh-editor', schema: 1 })}\n`

export interface NativeInstallAnchor {
  installAnchor: string
  dispose: () => Promise<void>
}

export type CreateNativeInstallAnchor = (cliPath: string) => Promise<NativeInstallAnchor>

/** App-owned TEMP install anchor: copied DSH manifest + SDK-only node_modules projection. */
export async function createNativeInstallAnchor(cliPath: string): Promise<NativeInstallAnchor> {
  const dshRoot = dirname(dirname(cliPath))
  const manifest = join(dshRoot, 'package.json')
  const modules = join(dshRoot, 'node_modules')
  if (!existsSync(manifest) || !existsSync(modules)) {
    throw new Error(`DSH runtime is missing a package manifest or node_modules next to ${cliPath}`)
  }
  const root = await mkdtemp(join(tmpdir(), 'dsh-editor-native-'))
  let released = false
  const dispose = async () => {
    if (released) return
    released = true
    await removeOwnedAnchor(root)
  }
  try {
    await copyFile(manifest, join(root, 'package.json'))
    await symlink(modules, join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
    await writeFile(join(root, MARKER), MARKER_BODY)
  } catch (error) {
    released = true
    await rm(root, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
  return { installAnchor: join(root, 'package.json'), dispose }
}

async function removeOwnedAnchor(root: string): Promise<void> {
  try {
    const marker = JSON.parse(await readFile(join(root, MARKER), 'utf8')) as { app?: unknown; schema?: unknown }
    if (marker.app !== 'dsh-editor' || marker.schema !== 1) return
    await rm(root, { recursive: true, force: true, maxRetries: 3 })
  } catch { /* already gone, unreadable, or not this process's directory */ }
}
