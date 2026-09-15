import type { RpcResult, SessionId, WorkspaceId } from './dsh-compat.ts'
import { t, type MessageKey } from './i18n/index.ts'

export const LEGACY_AGENT_PRESET = 'dsh-editor'

export const NEW_CONVERSATION_PRESET_IDS = [
  'dsh-editor-writing',
  'dsh-editor-novel',
  'dsh-editor-article',
  'dsh-editor-technical',
] as const

export type NewConversationPresetId = typeof NEW_CONVERSATION_PRESET_IDS[number]

export type ConversationPresetChoice = {
  id: NewConversationPresetId
  name: string
  description: string
  available: boolean
  reason?: string
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

export function sessionAgentPreset(
  byId: Record<string, { agentPreset?: string | null } | undefined> | undefined,
  sessionId: string,
): string | null | undefined {
  return byId?.[sessionId]?.agentPreset
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

export function projectNewConversationPresets(value: unknown): ConversationPresetChoice[] {
  const listed = listedPresetRecords(value)
  const byId: Record<string, Record<string, unknown>> = {}
  for (const item of listed) {
    const id = item.id
    if (typeof id === 'string' && isNewConversationPresetId(id)) byId[id] = item
  }
  return NEW_CONVERSATION_PRESET_IDS.map((id) => projectedChoice(id, byId[id]))
}

export function firstAvailableConversationPreset(presets: readonly ConversationPresetChoice[]): NewConversationPresetId | undefined {
  return presets.find((item) => item.available)?.id
}

export function canConfirmConversationPreset(presets: readonly ConversationPresetChoice[], presetId: string | undefined): boolean {
  return Boolean(presetId && presets.some((item) => item.id === presetId && item.available))
}

export async function startNewConversationPresetFlow(input: {
  canDiscardDraft(): Promise<boolean>
  list(): Promise<RpcResult<unknown>>
}): Promise<
  | { kind: 'blocked' }
  | { kind: 'listed'; presets: ConversationPresetChoice[] }
  | { kind: 'list-error'; error: string }
> {
  if (!await input.canDiscardDraft()) return { kind: 'blocked' }
  const loaded = await loadNewConversationPresets(input.list)
  if (!loaded.ok) return { kind: 'list-error', error: loaded.error }
  return { kind: 'listed', presets: loaded.presets }
}

export async function loadNewConversationPresets(list: () => Promise<RpcResult<unknown>>): Promise<
  { ok: true; presets: ConversationPresetChoice[] } | { ok: false; error: string }
> {
  try {
    const result = await list()
    if (!result.ok) return { ok: false, error: t('chat.presetListFailed') }
    return { ok: true, presets: projectNewConversationPresets(result.value) }
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
  input: { workspaceId: WorkspaceId; presetId: string; pendingSessionId?: SessionId },
): Promise<
  | { ok: true; sessionId: SessionId; agentPreset: string }
  | { ok: false; sessionId?: SessionId; error: string }
> {
  if (!isNewConversationPresetId(input.presetId)) {
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
