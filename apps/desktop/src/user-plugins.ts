import { copyFile, cp, mkdir, readdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { constants, existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, isAbsolute, join } from 'node:path'
import { linkPointsTo, sameFileTree } from './file-tree.js'

const PACKAGE_NAME = /^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/
/** Keep in sync with HOST_LOCKED_ENTRY_IDS in dsh-editor-plugins. */
const HOST_LOCKED_PLUGIN_IDS = new Set(['editor-novel-kernel', 'editor-workbench-tools', 'proofread', 'web-search-tavily'])
const MANAGED_PATCH_MARK = 'managed-by: dsh-editor-plugins'
const PRESET_ID = /^[A-Za-z0-9._-]+$/
const PRESET_OWNER_MARKER = '.dsh-editor-owner.json'
/** 内置写作 preset 全部使用此前缀，插件 preset 不得占用。 */
const PRESET_RESERVED_PREFIX = 'dsh-editor'

function isProtectedName(name: string, bundles: readonly string[]): boolean {
  return bundles.includes(name) || name.startsWith('@deepseek-ai/')
}

function isSafePackageName(name: string, bundles: readonly string[]): boolean {
  return name !== 'dsh-web-search-tavily' && PACKAGE_NAME.test(name) && !name.includes('..') && !isProtectedName(name, bundles)
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
    if (await sameFileTree(source, target, new Set([PRESET_OWNER_MARKER]))) return
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
 * 每次部署 profile 后同步插件 preset：扫描市集安装的 bundle，
 * 把声明的 preset 部署进 <dshHome>/.agent-presets，并回收 owner 已不在
 * bundle 列表里的插件 preset。app-owned 目录(marker 无 plugin 字段)永不动。
 * 第一方包的 preset 由模板通道部署（configureProfile → deployAgentPresets），
 * 本通道只认 dsh-plugins.json 里登记为市集安装的包，避免重复部署或误拒
 * 第一方的 dsh-editor 前缀声明。
 */
async function restorePluginPresets(home: string, profilePath: string, bundles: readonly string[], installedNames: ReadonlySet<string>): Promise<void> {
  const presetsRoot = join(home, '.agent-presets')
  await mkdir(presetsRoot, { recursive: true })
  for (const name of bundles) {
    if (!installedNames.has(name)) continue
    const packageDir = join(profilePath, 'node_modules', name)
    let manifest: unknown
    try {
      manifest = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'))
    } catch {
      continue
    }
    for (const preset of readPresetDeclarations(manifest)) {
      const source = join(packageDir, preset.path)
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

function renderManagedOverridePatch(overrides: Record<string, boolean>): string {
  const ids = Object.keys(overrides).sort()
  if (ids.length === 0) return '[]\n'
  return `# ${MANAGED_PATCH_MARK}\n${ids.map((id) => `- id: ${id}\n  disabled: ${overrides[id] ? 'false' : 'true'}`).join('\n')}\n`
}

function parseManagedOverridePatch(text: string): Record<string, boolean> | undefined {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  const trimmed = normalized.trim()
  if (!trimmed || trimmed === '[]') return {}
  if (!trimmed.includes(MANAGED_PATCH_MARK)) return undefined
  const overrides: Record<string, boolean> = {}
  const pattern = /- id:\s*([A-Za-z0-9._-]+)\r?\n\s+disabled:\s*(true|false)/g
  for (const match of normalized.matchAll(pattern)) {
    if (match[1]) overrides[match[1]] = match[2] === 'false'
  }
  const comparable = normalized.endsWith('\n') ? normalized : `${normalized}\n`
  if (comparable !== renderManagedOverridePatch(overrides)) return undefined
  return overrides
}

/**
 * Stale plugin toggles used to re-enable host-wide novel-kernel / workbench
 * / standalone proofread. Those entries stay disabled so presets can remount
 * them; leftover `disabled: false` overlays crash DSH boot.
 * The retired Tavily entry is removed from managed state with a backup; its
 * credentials and the web-search settings domain remain in place.
 */
async function backupBeforeTavilyMerge(file: string): Promise<void> {
  try { await copyFile(file, file + '.before-tavily-merge', constants.COPYFILE_EXCL) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
}

export async function sanitizeHostLockedPluginOverrides(home: string): Promise<void> {
  const statePath = join(home, 'dsh-plugins.json')
  try {
    const state = JSON.parse(await readFile(statePath, 'utf8')) as { schema?: unknown; overrides?: unknown; installed?: unknown }
    if (state.schema === 1) {
      let changed = false
      let retired = false
      if (state.overrides && typeof state.overrides === 'object' && !Array.isArray(state.overrides)) {
        const overrides = state.overrides as Record<string, unknown>
        retired = Object.prototype.hasOwnProperty.call(overrides, 'web-search-tavily')
        for (const id of HOST_LOCKED_PLUGIN_IDS) {
          if (Object.prototype.hasOwnProperty.call(overrides, id)) { delete overrides[id]; changed = true }
        }
      }
      if (Array.isArray(state.installed)) {
        const installed = state.installed.filter(item => item?.name !== 'dsh-web-search-tavily')
        if (installed.length !== state.installed.length) { state.installed = installed; changed = true; retired = true }
      }
      if (changed) {
        if (retired) await backupBeforeTavilyMerge(statePath)
        await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
      }
    }
  } catch { /* missing or unreadable state is left alone */ }

  const patchPath = join(home, 'cordis.patch.yml')
  try {
    const text = await readFile(patchPath, 'utf8')
    const parsed = parseManagedOverridePatch(text)
    if (!parsed) return
    const next: Record<string, boolean> = {}
    for (const [id, enabled] of Object.entries(parsed)) {
      if (!HOST_LOCKED_PLUGIN_IDS.has(id)) next[id] = enabled
    }
    const rendered = renderManagedOverridePatch(next)
    const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
    const comparable = normalized.endsWith('\n') ? normalized : `${normalized}\n`
    if (comparable !== rendered) {
      if (Object.prototype.hasOwnProperty.call(parsed, 'web-search-tavily')) await backupBeforeTavilyMerge(patchPath)
      await writeFile(patchPath, rendered, 'utf8')
    }
  } catch { /* missing overlay is a clean home */ }
}

async function linkUserPlugin(source: string, destination: string): Promise<void> {
  if (await linkPointsTo(destination, source)) return
  await mkdir(dirname(destination), { recursive: true })
  if (existsSync(destination)) await rm(destination, { recursive: true, force: true })
  try {
    await symlink(source, destination, process.platform === 'win32' ? 'junction' : 'dir')
  } catch {
    await cp(source, destination, { recursive: true })
  }
}

export async function restoreUserPlugins(home: string, profilePath: string, bundledNames: readonly string[] = []): Promise<void> {
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
  const previous = [...(manifest.dsh?.profile?.bundles ?? [])]
  const installedNames = new Set<string>()
  for (const item of state.installed) {
    if (!item || typeof item !== 'object') continue
    const name = (item as { name?: unknown }).name
    if (typeof name !== 'string' || !isSafePackageName(name, bundledNames)) continue
    const source = join(home, 'user-plugins', name)
    if (!existsSync(join(source, 'package.json'))) continue
    await linkUserPlugin(source, join(profilePath, 'node_modules', name))
    installedNames.add(name)
  }
  const bundles = [...bundledNames]
  for (const name of installedNames) if (!bundles.includes(name)) bundles.push(name)
  for (const name of previous) {
    if (bundles.includes(name) || bundledNames.includes(name) || name.startsWith('@deepseek-ai/')) continue
    const destination = join(profilePath, 'node_modules', name)
    if (existsSync(destination)) await rm(destination, { recursive: true, force: true })
  }
  await restorePluginPresets(home, profilePath, bundles, installedNames)
  const unchanged = previous.length === bundles.length && previous.every((name, index) => name === bundles[index])
  if (unchanged) return
  manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles } }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}
