/*
 * 第一方写作模式 preset 的开关通道。可开关的 preset 集合来自 profile 的
 * composition.json（构建期由 dshEditor.presets 声明解析而来）；核心
 * `dsh-editor-writing` 永远部署、不可关闭。开关立即生效：启用时把包内
 * preset 原子部署到 <dshHome>/.agent-presets/<id>（app-owned marker，无
 * plugin 字段，与模板通道一致），停用时按同样 marker 纪律删除目录；
 * roster 每次调用都重扫该目录，picker 下一次列表即反映，无需重启。
 * 进行中的会话绑定的是会话级记录，不受影响。
 */
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { isAbsolute, join } from 'node:path'
import { isSafeEntryId, isSafePackageName } from './core.ts'
import { PLUGIN_PRESETS_DIRNAME, PRESET_OWNER_MARKER, readPresetOwner } from './presets.ts'
import type { WritingPresetCard } from './contracts.ts'
import type { PluginState } from './overlay.ts'
import type { PluginPaths } from './paths.ts'

export const CORE_WRITING_PRESET_ID = 'dsh-editor-writing'

export type CompositionPreset = { id: string; packageName: string; path: string }

function fail(message: string): never {
  throw new Error(message)
}

/** 防御式解析 composition.json 的 presets；任何不合规条目都让整份登记失效。 */
export async function readCompositionPresets(profileDir: string): Promise<CompositionPreset[]> {
  let value: unknown
  try {
    value = JSON.parse(await readFile(join(profileDir, 'composition.json'), 'utf8'))
  } catch {
    return []
  }
  const declared = (value as { presets?: unknown } | null)?.presets
  if (!Array.isArray(declared)) return []
  const presets: CompositionPreset[] = []
  const seen = new Set<string>()
  for (const row of declared) {
    const record = row as { id?: unknown; packageName?: unknown; path?: unknown } | null
    const id = typeof record?.id === 'string' ? record.id.trim() : ''
    const packageName = typeof record?.packageName === 'string' ? record.packageName.trim() : ''
    const path = typeof record?.path === 'string' ? record.path.trim() : ''
    if (!id || !isSafeEntryId(id) || seen.has(id)) return []
    if (!packageName || !isSafePackageName(packageName)) return []
    if (!path || path.includes('..') || isAbsolute(path) || /^[A-Za-z]:/.test(path)) return []
    seen.add(id)
    presets.push({ id, packageName, path })
  }
  return presets.sort((left, right) => left.id.localeCompare(right.id))
}

/** preset.yml 是简单的顶层标量 YAML；只取 name / description 两行。 */
async function readPresetMeta(dir: string): Promise<{ name?: string; description?: string }> {
  let text: string
  try {
    text = await readFile(join(dir, 'preset.yml'), 'utf8')
  } catch {
    return {}
  }
  const pick = (key: string) => {
    const match = text.match(new RegExp(`^${key}:\\s*(.+)\\s*$`, 'm'))
    return match?.[1]?.trim() || undefined
  }
  return { name: pick('name'), description: pick('description') }
}

export async function listWritingPresets(paths: PluginPaths, state: PluginState): Promise<{ presets: WritingPresetCard[] }> {
  const cards: WritingPresetCard[] = []
  const coreMeta = await readPresetMeta(join(paths.home, PLUGIN_PRESETS_DIRNAME, CORE_WRITING_PRESET_ID))
  cards.push({
    id: CORE_WRITING_PRESET_ID,
    title: coreMeta.name ?? '通用写作',
    description: coreMeta.description ?? '',
    enabled: true,
    locked: true,
  })
  for (const row of await readCompositionPresets(paths.profileDir)) {
    const meta = await readPresetMeta(join(paths.profileDir, 'node_modules', row.packageName, row.path))
    cards.push({
      id: row.id,
      title: meta.name ?? row.id,
      description: meta.description ?? '',
      enabled: state.presets[row.id] !== false,
      locked: false,
      packageName: row.packageName,
    })
  }
  return { presets: cards }
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
 * 把第一方 preset 原子部署进 <home>/.agent-presets，marker 与模板通道一致
 * （app-owned、无 plugin 字段）。目标被插件目录或未标记目录占用时拒绝。
 */
export async function deployAppOwnedPreset(home: string, presetId: string, source: string): Promise<void> {
  if (!existsSync(join(source, 'preset.yml')) || !existsSync(join(source, 'agent.cordis.yml'))) {
    fail(`写作模式 ${presetId} 的安装源缺失`)
  }
  const presetsRoot = join(home, PLUGIN_PRESETS_DIRNAME)
  await mkdir(presetsRoot, { recursive: true })
  const target = join(presetsRoot, presetId)
  if (existsSync(target)) {
    const owner = await readPresetOwner(target)
    if (!owner || typeof owner.plugin === 'string') fail(`写作模式 ${presetId} 的目录被占用`)
  }
  const nonce = randomUUID()
  const stage = join(presetsRoot, `.${presetId}.stage-${nonce}`)
  const backup = join(presetsRoot, `.${presetId}.backup-${nonce}`)
  try {
    await cp(source, stage, { recursive: true, force: false, errorOnExist: true })
    await writeFile(join(stage, PRESET_OWNER_MARKER), `${JSON.stringify({ app: 'dsh-editor', schema: 1 })}\n`, 'utf8')
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

/** 只删除 app-owned（无 plugin 字段）的 preset 目录；其余一律不动。 */
export async function removeAppOwnedPreset(home: string, presetId: string): Promise<void> {
  const target = join(home, PLUGIN_PRESETS_DIRNAME, presetId)
  if (!existsSync(target)) return
  const owner = await readPresetOwner(target)
  if (!owner || typeof owner.plugin === 'string') fail(`写作模式 ${presetId} 的目录不归应用管理，未删除`)
  await rm(target, { recursive: true, force: true })
}
