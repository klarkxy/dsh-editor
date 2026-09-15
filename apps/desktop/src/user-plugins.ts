import { cp, mkdir, readdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, isAbsolute, join } from 'node:path'

const PACKAGE_NAME = /^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/
const PRESET_ID = /^[A-Za-z0-9._-]+$/
const PRESET_OWNER_MARKER = '.dsh-editor-owner.json'
/** 内置写作 preset 全部使用此前缀，插件 preset 不得占用。 */
const PRESET_RESERVED_PREFIX = 'dsh-editor'

function isProtectedName(name: string, bundles: readonly string[]): boolean {
  return bundles.includes(name) || name.startsWith('@deepseek-ai/')
}

function isSafePackageName(name: string, bundles: readonly string[]): boolean {
  return PACKAGE_NAME.test(name) && !name.includes('..') && !isProtectedName(name, bundles)
}

type PresetDeclaration = { id: string; path: string }

/** 防御式解析 dshEditor.presets；桌面 restore 面对任意已装插件，只放行完全合规的条目。 */
function readPresetDeclarations(manifest: unknown): PresetDeclaration[] {
  const declared = (manifest as { dshEditor?: { presets?: unknown } } | null)?.dshEditor?.presets
  if (!Array.isArray(declared)) return []
  const presets: PresetDeclaration[] = []
  const seen = new Set<string>()
  for (const row of declared) {
    const record = row as { id?: unknown; path?: unknown } | null
    const id = typeof record?.id === 'string' ? record.id.trim() : ''
    const sourcePath = typeof record?.path === 'string' ? record.path.trim() : ''
    if (!id || id.length > 80 || !PRESET_ID.test(id) || id.startsWith(PRESET_RESERVED_PREFIX) || seen.has(id)) continue
    if (!sourcePath || sourcePath.includes('..') || isAbsolute(sourcePath) || /^[A-Za-z]:/.test(sourcePath)) continue
    seen.add(id)
    presets.push({ id, path: sourcePath })
  }
  return presets
}

type PresetOwner = { app?: unknown; schema?: unknown; plugin?: unknown }

async function readPresetOwner(directory: string): Promise<PresetOwner | undefined> {
  try {
    const marker = JSON.parse(await readFile(join(directory, PRESET_OWNER_MARKER), 'utf8')) as PresetOwner
    return marker.app === 'dsh-editor' && marker.schema === 1 ? marker : undefined
  } catch {
    return undefined
  }
}

async function renameWithRetry(source: string, target: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(source, target)
      return
    } catch (error) {
      const transient = process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM' && attempt < 4
      if (!transient) throw error
      await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)))
    }
  }
}

/** 与 profile.ts 的 app-owned 部署同规则：stage + 原子换名，只更新自己(owner)名下的目录。 */
async function deployPluginPreset(presetsRoot: string, owner: string, preset: PresetDeclaration, source: string): Promise<void> {
  const target = join(presetsRoot, preset.id)
  if (existsSync(target)) {
    const existing = await readPresetOwner(target)
    if (existing?.plugin !== owner) return
  }
  const nonce = randomUUID()
  const stage = join(presetsRoot, `.${preset.id}.stage-${nonce}`)
  const backup = join(presetsRoot, `.${preset.id}.backup-${nonce}`)
  try {
    await cp(source, stage, { recursive: true, force: false, errorOnExist: true })
    await writeFile(join(stage, PRESET_OWNER_MARKER), `${JSON.stringify({ app: 'dsh-editor', schema: 1, plugin: owner })}\n`, 'utf8')
    if (existsSync(target)) await renameWithRetry(target, backup)
    try {
      await renameWithRetry(stage, target)
    } catch (error) {
      if (existsSync(backup) && !existsSync(target)) await renameWithRetry(backup, target)
      throw error
    }
    if (existsSync(backup)) await rm(backup, { recursive: true, force: true })
  } catch (error) {
    if (existsSync(stage)) await rm(stage, { recursive: true, force: true })
    throw error
  }
}

/**
 * 每次部署 profile 后同步插件 preset：扫描全部 bundle（含内置包与市集安装），
 * 把声明的 preset 部署进 <dshHome>/.agent-presets，并回收 owner 已不在
 * bundle 列表里的插件 preset。app-owned 目录(marker 无 plugin 字段)永不动。
 */
async function restorePluginPresets(home: string, profilePath: string, bundles: readonly string[]): Promise<void> {
  const presetsRoot = join(home, '.agent-presets')
  await mkdir(presetsRoot, { recursive: true })
  for (const name of bundles) {
    let manifest: unknown
    try {
      manifest = JSON.parse(await readFile(join(profilePath, 'node_modules', name, 'package.json'), 'utf8'))
    } catch {
      continue
    }
    for (const preset of readPresetDeclarations(manifest)) {
      const source = join(profilePath, 'node_modules', name, preset.path)
      if (!existsSync(join(source, 'preset.yml')) || !existsSync(join(source, 'agent.cordis.yml'))) continue
      await deployPluginPreset(presetsRoot, name, preset, source)
    }
  }
  let entries
  try {
    entries = await readdir(presetsRoot, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const directory = join(presetsRoot, entry.name)
    const owner = await readPresetOwner(directory)
    if (typeof owner?.plugin !== 'string' || bundles.includes(owner.plugin)) continue
    await rm(directory, { recursive: true, force: true })
  }
}

export async function restoreUserPlugins(home: string, profilePath: string): Promise<void> {
  let state: { schema?: unknown; installed?: unknown }
  try {
    state = JSON.parse(await readFile(join(home, 'dsh-plugins.json'), 'utf8')) as { schema?: unknown; installed?: unknown }
  } catch {
    state = { schema: 1, installed: [] }
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
    if (typeof name !== 'string' || !isSafePackageName(name, bundles)) continue
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
  await restorePluginPresets(home, profilePath, bundles)
  if (!changed) return
  manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles } }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}
