/*
 * 插件对话 preset 通道：插件在 package.json 的 dshEditor.presets 里声明
 * [{ id, path }]，安装时把 preset 目录原子部署到 <dshHome>/.agent-presets/<id>，
 * 卸载时按 owner marker 回收。app-owned preset（marker 无 plugin 字段）永不被触碰。
 */
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { isSafeEntryId } from './core.ts'
import type { PluginPresetDeclaration } from './contracts.ts'

export const PLUGIN_PRESETS_DIRNAME = '.agent-presets'
export const PRESET_OWNER_MARKER = '.dsh-editor-owner.json'
/** 内置写作 preset 全部使用 dsh-editor 前缀，插件 preset 一律不得占用。 */
export const PLUGIN_PRESET_RESERVED_PREFIX = 'dsh-editor'

export type DeclaredPreset = PluginPresetDeclaration & { source: string }
export type PresetProblem = { code: string; message: string }
export type PresetOwner = { app?: unknown; schema?: unknown; plugin?: unknown }

function fail(message: string): never {
  throw new Error(message)
}

export function isSafePluginPresetId(id: string): boolean {
  return isSafeEntryId(id) && !id.startsWith(PLUGIN_PRESET_RESERVED_PREFIX)
}

function resolveInside(root: string, rel: string): string | undefined {
  const cleaned = rel.replaceAll('\\', '/').trim()
  if (!cleaned || isAbsolute(cleaned) || /^[A-Za-z]:/.test(cleaned) || cleaned.includes('://')) return undefined
  const target = resolve(root, cleaned)
  const relToRoot = relative(root, target)
  if (!relToRoot || relToRoot.startsWith('..') || isAbsolute(relToRoot)) return undefined
  return target
}

/** 解析并校验 dshEditor.presets；problems 非空时 presets 只保留通过检查的条目。 */
export async function inspectPluginPresets(pkgDir: string): Promise<{ presets: DeclaredPreset[]; problems: PresetProblem[] }> {
  let manifest: { name?: unknown; dshEditor?: { presets?: unknown } }
  try {
    manifest = JSON.parse(await readFile(join(pkgDir, 'package.json'), 'utf8')) as typeof manifest
  } catch {
    return { presets: [], problems: [] }
  }
  const declared = manifest.dshEditor?.presets
  if (declared === undefined) return { presets: [], problems: [] }
  const problems: PresetProblem[] = []
  const presets: DeclaredPreset[] = []
  if (!Array.isArray(declared)) {
    return { presets, problems: [{ code: 'preset-declaration', message: 'dshEditor.presets 必须是数组' }] }
  }
  const seen = new Set<string>()
  for (const row of declared) {
    const record = row as { id?: unknown; path?: unknown } | null
    const id = typeof record?.id === 'string' ? record.id.trim() : ''
    const path = typeof record?.path === 'string' ? record.path.trim() : ''
    if (!id || !isSafeEntryId(id)) {
      problems.push({ code: 'preset-id', message: `对话 preset id 无效：${id || '(空)'}` })
      continue
    }
    if (id.startsWith(PLUGIN_PRESET_RESERVED_PREFIX)) {
      problems.push({ code: 'preset-id', message: `对话 preset id 不能以 ${PLUGIN_PRESET_RESERVED_PREFIX} 开头，会与内置写作 preset 冲突：${id}` })
      continue
    }
    if (seen.has(id)) {
      problems.push({ code: 'preset-id', message: `对话 preset id 重复：${id}` })
      continue
    }
    seen.add(id)
    if (!path) {
      problems.push({ code: 'preset-path', message: `对话 preset ${id} 缺少 path` })
      continue
    }
    const source = resolveInside(pkgDir, path)
    if (!source) {
      problems.push({ code: 'preset-path', message: `对话 preset ${id} 的 path 不安全：${path}` })
      continue
    }
    if (!existsSync(join(source, 'preset.yml')) || !existsSync(join(source, 'agent.cordis.yml'))) {
      problems.push({ code: 'preset-files', message: `对话 preset ${id} 缺少 preset.yml 或 agent.cordis.yml：${path}` })
      continue
    }
    presets.push({ id, path, source })
  }
  return { presets, problems }
}

export async function readPresetOwner(directory: string): Promise<PresetOwner | undefined> {
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

/**
 * 把一个插件 preset 原子部署进 <home>/.agent-presets。目标已存在时只接受
 * 同名插件(owner 一致)的更新；被 app 或其他插件占用则报错。stage/backup
 * 用点目录，roster 扫描看不到半成品。
 */
export async function deployPluginPreset(home: string, packageName: string, preset: DeclaredPreset): Promise<void> {
  const presetsRoot = join(home, PLUGIN_PRESETS_DIRNAME)
  await mkdir(presetsRoot, { recursive: true })
  const target = join(presetsRoot, preset.id)
  if (existsSync(target)) {
    const owner = await readPresetOwner(target)
    if (owner?.plugin !== packageName) {
      fail(typeof owner?.plugin === 'string'
        ? `对话 preset ${preset.id} 已被插件 ${owner.plugin} 占用`
        : `对话 preset ${preset.id} 与内置 preset 或未标记目录冲突`)
    }
  }
  const nonce = randomUUID()
  const stage = join(presetsRoot, `.${preset.id}.stage-${nonce}`)
  const backup = join(presetsRoot, `.${preset.id}.backup-${nonce}`)
  try {
    await cp(preset.source, stage, { recursive: true, force: false, errorOnExist: true })
    await writeFile(join(stage, PRESET_OWNER_MARKER), `${JSON.stringify({ app: 'dsh-editor', schema: 1, plugin: packageName })}\n`, 'utf8')
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

/** 部署插件声明的全部 preset；声明本身有问题（inspect 漏网）时直接拒绝。 */
export async function deployPluginPresets(home: string, packageName: string, pkgDir: string): Promise<DeclaredPreset[]> {
  const { presets, problems } = await inspectPluginPresets(pkgDir)
  if (problems.length) fail(problems.map((item) => item.message).join('；'))
  for (const preset of presets) await deployPluginPreset(home, packageName, preset)
  return presets
}

/** 回收某插件部署过的全部 preset；只认 owner marker，best-effort。 */
export async function removePluginPresets(home: string, packageName: string): Promise<void> {
  const presetsRoot = join(home, PLUGIN_PRESETS_DIRNAME)
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
    if (owner?.plugin !== packageName) continue
    await rm(directory, { recursive: true, force: true })
  }
}
