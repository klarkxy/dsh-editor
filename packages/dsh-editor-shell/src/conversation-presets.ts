import type { RpcResult, SessionId, WorkspaceId } from './dsh-compat.ts'
import { t, type MessageKey } from './i18n/index.ts'

export const LEGACY_AGENT_PRESET = 'dsh-editor'

/*
 * 第一方写作模式的已知 id 与文案顺序。picker 投影以 Host roster 为准：
 * 被作者停用的模式不再部署、不进 roster，picker 直接省略；核心的
 * dsh-editor-writing 永远列出（roster 缺失时降级为不可用行）。
 */
export const NEW_CONVERSATION_PRESET_IDS = [
  'dsh-editor-writing',
  'dsh-editor-novel',
  'dsh-editor-article',
  'dsh-editor-technical',
] as const

export type NewConversationPresetId = typeof NEW_CONVERSATION_PRESET_IDS[number]

const CORE_WRITING_PRESET_ID: NewConversationPresetId = 'dsh-editor-writing'

export type ConversationPresetChoice = {
  /* 开发者模式下可能超出四个写作模式的 id，因此类型放宽为 string。 */
  id: string
  name: string
  description: string
  available: boolean
  reason?: string
  /* 旧版 dsh-editor 会话，仅开发者模式列出，picker 里以诊断徽标区分。 */
  legacy?: boolean
}

const PRESET_COPY: Record<NewConversationPresetId, { name: MessageKey; description: MessageKey }> = {
  'dsh-editor-writing': { name: 'chat.presetWriting', description: 'chat.presetWritingHint' },
  'dsh-editor-novel': { name: 'chat.presetNovel', description: 'chat.presetNovelHint' },
  'dsh-editor-article': { name: 'chat.presetArticle', description: 'chat.presetArticleHint' },
  'dsh-editor-technical': { name: 'chat.presetTechnical', description: 'chat.presetTechnicalHint' },
}

export function isNewConversationPresetId(id: string): id is NewConversationPresetId {
  return (NEW_CONVERSATION_PRESET_IDS as readonly string[]).includes(id)
}

export function isLegacyEditorPreset(preset: string | null | undefined): boolean {
  return preset === LEGACY_AGENT_PRESET
}

export type ConversationPresetLabel = {
  id: string
  name: string
  description: string
}

/**
 * Display name for the bound session mode. The four writing modes and
 * legacy use product copy; official/community ids use the Host roster
 * name when present, otherwise the raw id.
 */
export function conversationPresetLabel(presetId: string | null | undefined, roster?: unknown): ConversationPresetLabel | undefined {
  if (typeof presetId !== 'string' || !presetId.trim()) return undefined
  const id = presetId.trim()
  const listed = listedPresetRecords(roster).find((item) => item.id === id)
  const listedName = typeof listed?.name === 'string' && listed.name.trim() ? listed.name.trim() : undefined
  const listedDescription = typeof listed?.description === 'string' && listed.description.trim() ? listed.description.trim() : undefined
  if (isNewConversationPresetId(id)) {
    const copy = PRESET_COPY[id]
    return { id, name: t(copy.name), description: t(copy.description) }
  }
  if (isLegacyEditorPreset(id)) {
    return { id, name: listedName ?? t('chat.legacyMigrationTitle'), description: t('chat.presetLegacyDescription') }
  }
  return { id, name: listedName ?? id, description: listedDescription ?? t('chat.presetHostHint') }
}

export function sessionAgentPreset(
  byId: Record<string, { agentPreset?: string | null; projectionValues?: { agentPreset?: string | null } | undefined } | undefined> | undefined,
  sessionId: string,
): string | null | undefined {
  const summary = byId?.[sessionId]
  if (!summary) return undefined
  /* 运行时的会话列表把 preset 放在 projectionValues 里；扁平 agentPreset 只是旧线形。 */
  if (summary.agentPreset !== undefined) return summary.agentPreset
  return summary.projectionValues?.agentPreset
}

export function shouldRunLegacyNovelPipeline(preset: string | null | undefined): boolean {
  return isLegacyEditorPreset(preset)
}

function listedPresetRecords(value: unknown): Array<Record<string, unknown>> {
  const items = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? (value as { presets?: unknown; items?: unknown }).presets
        ?? (value as { items?: unknown }).items
      : undefined
  if (!Array.isArray(items)) return []
  return items.filter((item): item is Record<string, unknown> => (
    Boolean(item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string')
  ))
}

function listedBrokenReason(record: Record<string, unknown>): string | undefined {
  return typeof record.broken === 'string' && record.broken.trim() ? record.broken : undefined
}

function listedStatus(record: Record<string, unknown>): string {
  if (typeof record.status === 'string') return record.status
  if (typeof record.state === 'string') return record.state
  return 'ok'
}

function listedReason(record: Record<string, unknown>, status: string): string | undefined {
  if (typeof record.reason === 'string' && record.reason.trim()) return record.reason.trim()
  if (typeof record.error === 'string' && record.error.trim()) return record.error.trim()
  if (status === 'missing') return t('chat.presetMissing')
  if (status === 'broken') return t('chat.presetBroken')
  return undefined
}

function projectedChoice(
  id: NewConversationPresetId,
  item: Record<string, unknown> | undefined,
): ConversationPresetChoice {
  const copy = PRESET_COPY[id]
  const name = item && typeof item.name === 'string' && item.name.trim() ? item.name.trim() : t(copy.name)
  const description = item && typeof item.description === 'string' && item.description.trim()
    ? item.description.trim()
    : t(copy.description)
  if (!item) {
    return { id, name, description, available: false, reason: t('chat.presetMissing') }
  }
  const broken = listedBrokenReason(item)
  if (broken !== undefined) {
    return { id, name, description, available: false, reason: broken }
  }
  const status = listedStatus(item)
  const unavailable = status === 'missing' || status === 'broken'
  return {
    id,
    name,
    description,
    available: !unavailable,
    ...(unavailable ? { reason: listedReason(item, status) ?? t(status === 'missing' ? 'chat.presetMissing' : 'chat.presetBroken') } : {}),
  }
}

export type PresetProjectionOptions = { developerMode?: boolean }

function extraChoice(item: Record<string, unknown>): ConversationPresetChoice {
  const id = item.id as string
  const legacy = isLegacyEditorPreset(id)
  const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : id
  /* 旧版 preset 的展示描述固定为迁移指引，不沿用 host 侧的历史文案。 */
  const description = legacy
    ? t('chat.presetLegacyDescription')
    : typeof item.description === 'string' && item.description.trim() ? item.description.trim() : ''
  const broken = listedBrokenReason(item)
  if (broken !== undefined) return { id, name, description, available: false, reason: broken, ...(legacy ? { legacy } : {}) }
  const status = listedStatus(item)
  const unavailable = status === 'missing' || status === 'broken'
  return {
    id,
    name,
    description,
    available: !unavailable,
    ...(unavailable ? { reason: listedReason(item, status) ?? t(status === 'missing' ? 'chat.presetMissing' : 'chat.presetBroken') } : {}),
    ...(legacy ? { legacy } : {}),
  }
}

export function projectNewConversationPresets(value: unknown, options?: PresetProjectionOptions): ConversationPresetChoice[] {
  const listed = listedPresetRecords(value)
  const byId: Record<string, Record<string, unknown>> = {}
  const extras: Array<Record<string, unknown>> = []
  for (const item of listed) {
    const id = item.id
    if (typeof id !== 'string') continue
    if (isNewConversationPresetId(id)) byId[id] = item
    else if (options?.developerMode) extras.push(item)
  }
  const choices: ConversationPresetChoice[] = []
  for (const id of NEW_CONVERSATION_PRESET_IDS) {
    /* 停用的第一方模式已从 roster 消失，不再占位；核心通用写作始终列出。 */
    if (id !== CORE_WRITING_PRESET_ID && !byId[id]) continue
    choices.push(projectedChoice(id, byId[id]))
  }
  for (const item of extras) choices.push(extraChoice(item))
  return choices
}

export function firstAvailableConversationPreset(presets: readonly ConversationPresetChoice[]): string | undefined {
  return presets.find((item) => item.available)?.id
}

export function canConfirmConversationPreset(presets: readonly ConversationPresetChoice[], presetId: string | undefined): boolean {
  return Boolean(presetId && presets.some((item) => item.id === presetId && item.available))
}

export async function startNewConversationPresetFlow(input: {
  canDiscardDraft(): Promise<boolean>
  list(): Promise<RpcResult<unknown>>
  projection?: PresetProjectionOptions
}): Promise<
  | { kind: 'blocked' }
  | { kind: 'listed'; presets: ConversationPresetChoice[] }
  | { kind: 'list-error'; error: string }
> {
  if (!await input.canDiscardDraft()) return { kind: 'blocked' }
  const loaded = await loadNewConversationPresets(input.list, input.projection)
  if (!loaded.ok) return { kind: 'list-error', error: loaded.error }
  return { kind: 'listed', presets: loaded.presets }
}

export async function loadNewConversationPresets(list: () => Promise<RpcResult<unknown>>, options?: PresetProjectionOptions): Promise<
  { ok: true; presets: ConversationPresetChoice[] } | { ok: false; error: string }
> {
  try {
    const result = await list()
    if (!result.ok) return { ok: false, error: t('chat.presetListFailed') }
    return { ok: true, presets: projectNewConversationPresets(result.value, options) }
  } catch {
    return { ok: false, error: t('chat.presetListFailed') }
  }
}

export function actualAgentPreset(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.selected === 'string' && record.selected.trim()) return record.selected.trim()
    if (typeof record.agentPreset === 'string' && record.agentPreset.trim()) return record.agentPreset.trim()
  }
  return undefined
}

export type ConfirmNewConversationPresetHost = {
  create(opts: { workspaceId: WorkspaceId }): Promise<SessionId>
  select(sessionId: SessionId, id: string): Promise<RpcResult<unknown>>
  applyDefaultModel?(sessionId: SessionId): Promise<void>
  open(id: SessionId): void
}

export async function confirmNewConversationPreset(
  host: ConfirmNewConversationPresetHost,
  input: { workspaceId: WorkspaceId; presetId: string; pendingSessionId?: SessionId; allowCustomPreset?: boolean; allowedPresetIds?: readonly string[] },
): Promise<
  | { ok: true; sessionId: SessionId; agentPreset: string }
  | { ok: false; sessionId?: SessionId; error: string }
> {
  /* 确认闸与 picker 投影同源：只放行当前投影里的 id；开发者模式才放行自选 id。 */
  const allowed = input.allowedPresetIds
    ? input.allowedPresetIds.includes(input.presetId)
    : isNewConversationPresetId(input.presetId)
  if (!allowed && !input.allowCustomPreset) {
    return { ok: false, sessionId: input.pendingSessionId, error: t('chat.presetSelectFailed') }
  }
  let sessionId = input.pendingSessionId
  try {
    if (!sessionId) sessionId = await host.create({ workspaceId: input.workspaceId })
  } catch {
    return { ok: false, error: t('chat.newFailed') }
  }
  try {
    const selected = await host.select(sessionId, input.presetId)
    if (!selected.ok) return { ok: false, sessionId, error: t('chat.presetSelectFailed') }
    const agentPreset = actualAgentPreset(selected.value)
    if (!agentPreset || agentPreset !== input.presetId) {
      return { ok: false, sessionId, error: t('chat.presetSelectFailed') }
    }
    try {
      if (host.applyDefaultModel) await host.applyDefaultModel(sessionId)
    } catch {
      /* Model selection is best-effort after the host preset is bound. */
    }
    host.open(sessionId)
    return { ok: true, sessionId, agentPreset }
  } catch {
    return { ok: false, sessionId, error: t('chat.presetSelectFailed') }
  }
}

export async function cancelNewConversationPresetPicker(input: {
  pendingSessionId?: SessionId
  archive?(sessionId: SessionId): Promise<void>
}): Promise<void> {
  if (!input.pendingSessionId || !input.archive) return
  try {
    await input.archive(input.pendingSessionId)
  } catch {
    /* Best-effort: a leftover blank session is preferable to blocking cancel. */
  }
}
