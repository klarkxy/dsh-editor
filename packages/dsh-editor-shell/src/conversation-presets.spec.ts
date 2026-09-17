import { describe, expect, it, vi } from 'vitest'
import {
  actualAgentPreset,
  canConfirmConversationPreset,
  cancelNewConversationPresetPicker,
  confirmNewConversationPreset,
  conversationPresetLabel,
  firstAvailableConversationPreset,
  isLegacyEditorPreset,
  LEGACY_AGENT_PRESET,
  loadNewConversationPresets,
  NEW_CONVERSATION_PRESET_IDS,
  projectNewConversationPresets,
  sessionAgentPreset,
  shouldRunLegacyNovelPipeline,
  startNewConversationPresetFlow,
} from './conversation-presets.ts'

const listed = [
  { id: 'dsh-editor-writing', name: '通用写作', description: '默认写作', status: 'ok' },
  { id: 'dsh-editor-novel', name: '小说创作', status: 'ok' },
  { id: 'dsh-editor-article', name: '文章与自媒体', status: 'broken', reason: 'skill missing' },
  { id: 'dsh-editor-technical', name: '技术文档', status: 'ok' },
  { id: 'dsh-editor', name: '旧采访', status: 'ok' },
  { id: 'standard', name: '编码', status: 'ok' },
]

const realRoster = {
  presets: [
    { id: 'dsh-editor-writing', name: '通用写作', description: '默认写作' },
    { id: 'dsh-editor-novel', name: '小说创作', broken: 'skill missing' },
    { id: 'dsh-editor-article', name: '文章与自媒体' },
    { id: 'dsh-editor', name: '旧采访' },
    { id: 'standard', name: '编码' },
  ],
  authorable: false,
}

function hostFixture() {
  const create = vi.fn(async (opts: { workspaceId: string }) => {
    expect(opts).toEqual({ workspaceId: 'ws-1' })
    return 'session-new'
  })
  const select = vi.fn(async () => ({ ok: true as const, value: 'dsh-editor-writing' }))
  const applyDefaultModel = vi.fn(async () => undefined)
  const open = vi.fn()
  return { create, select, applyDefaultModel, open }
}

describe('new conversation preset allowlist', () => {
  it('projects only the four writing modes and never includes legacy dsh-editor', () => {
    const presets = projectNewConversationPresets(listed)
    expect(presets.map((item) => item.id)).toEqual([...NEW_CONVERSATION_PRESET_IDS])
    expect(presets.some((item) => item.id === LEGACY_AGENT_PRESET)).toBe(false)
    expect(presets.some((item) => item.id === 'standard')).toBe(false)
    expect(presets.map((item) => item.name)).toEqual(['通用写作', '小说创作', '文章与自媒体', '技术文档'])
  })

  it('falls back to i18n names that match the approved roster labels', () => {
    const presets = projectNewConversationPresets(NEW_CONVERSATION_PRESET_IDS.map((id) => ({ id, status: 'ok' })))
    expect(presets.map((item) => item.name)).toEqual(['通用写作', '小说创作', '文章与自媒体', '技术文档'])
  })

  it('omits roster-missing modes (disabled by the author) but keeps broken ones visible with a reason', () => {
    const presets = projectNewConversationPresets([
      { id: 'dsh-editor-writing', status: 'ok' },
      { id: 'dsh-editor-novel', status: 'missing' },
      { id: 'dsh-editor-article', status: 'broken', reason: 'skill missing' },
    ])
    expect(presets.map((item) => item.id)).toEqual(['dsh-editor-writing', 'dsh-editor-novel', 'dsh-editor-article'])
    expect(presets.find((item) => item.id === 'dsh-editor-writing')?.available).toBe(true)
    expect(presets.find((item) => item.id === 'dsh-editor-novel')).toMatchObject({
      available: false,
      reason: '这个模式当前不可用。',
    })
    expect(presets.find((item) => item.id === 'dsh-editor-article')).toMatchObject({
      available: false,
      reason: 'skill missing',
    })
    expect(presets.some((item) => item.id === 'dsh-editor-technical')).toBe(false)
    expect(canConfirmConversationPreset(presets, 'dsh-editor-article')).toBe(false)
    expect(canConfirmConversationPreset(presets, 'dsh-editor-technical')).toBe(false)
    expect(canConfirmConversationPreset(presets, 'dsh-editor-writing')).toBe(true)
    expect(firstAvailableConversationPreset(presets)).toBe('dsh-editor-writing')
  })

  it('always lists the core writing mode, degraded to unavailable when the roster loses it', () => {
    const presets = projectNewConversationPresets([{ id: 'dsh-editor-novel', status: 'ok' }])
    expect(presets.map((item) => item.id)).toEqual(['dsh-editor-writing', 'dsh-editor-novel'])
    expect(presets[0]).toMatchObject({
      id: 'dsh-editor-writing',
      name: '通用写作',
      available: false,
      reason: '这个模式当前不可用。',
    })
    expect(firstAvailableConversationPreset(presets)).toBe('dsh-editor-novel')
  })

  it('projects the real AgentPresetRoster shape and treats a non-empty broken string as unavailable', () => {
    const presets = projectNewConversationPresets(realRoster)
    /* realRoster 没有 dsh-editor-technical（等效于作者已停用），picker 不再占位。 */
    expect(presets.map((item) => item.id)).toEqual(['dsh-editor-writing', 'dsh-editor-novel', 'dsh-editor-article'])
    expect(presets.find((item) => item.id === 'dsh-editor-writing')).toMatchObject({
      available: true,
      name: '通用写作',
    })
    expect(presets.find((item) => item.id === 'dsh-editor-novel')).toMatchObject({
      available: false,
      reason: 'skill missing',
    })
    expect(presets.find((item) => item.id === 'dsh-editor-article')?.available).toBe(true)
    expect(canConfirmConversationPreset(presets, 'dsh-editor-novel')).toBe(false)
    expect(canConfirmConversationPreset(presets, 'dsh-editor-technical')).toBe(false)
    expect(firstAvailableConversationPreset(presets)).toBe('dsh-editor-writing')
  })

  it('lets a real broken string win over a compatible status/state of ok', () => {
    const presets = projectNewConversationPresets({
      presets: [
        { id: 'dsh-editor-writing', status: 'ok', state: 'ok', broken: 'preset yaml failed to load' },
        { id: 'dsh-editor-novel', state: 'broken' },
        { id: 'dsh-editor-article', broken: '   ' },
        { id: 'dsh-editor-technical', broken: '' },
      ],
      authorable: true,
    })
    expect(presets.find((item) => item.id === 'dsh-editor-writing')).toMatchObject({
      available: false,
      reason: 'preset yaml failed to load',
    })
    expect(presets.find((item) => item.id === 'dsh-editor-novel')).toMatchObject({
      available: false,
      reason: '这个模式的文件有问题，暂时无法使用。',
    })
    expect(presets.find((item) => item.id === 'dsh-editor-article')?.available).toBe(true)
    expect(presets.find((item) => item.id === 'dsh-editor-technical')?.available).toBe(true)
  })
})

describe('developer mode preset projection', () => {
  it('appends legacy and plugin presets after the four writing modes', () => {
    const presets = projectNewConversationPresets(listed, { developerMode: true })
    expect(presets.map((item) => item.id)).toEqual([...NEW_CONVERSATION_PRESET_IDS, LEGACY_AGENT_PRESET, 'standard'])
    const legacy = presets.find((item) => item.id === LEGACY_AGENT_PRESET)
    expect(legacy).toMatchObject({ name: '旧采访', available: true, legacy: true })
    expect(legacy?.description).toBe('仅用于打开或迁移旧会话；正常写作请使用写作模式。')
    expect(presets.find((item) => item.id === 'standard')).toMatchObject({ name: '编码', available: true })
    expect(presets.find((item) => item.id === 'standard')?.legacy).toBeUndefined()
    expect(firstAvailableConversationPreset(presets)).toBe('dsh-editor-writing')
  })

  it('keeps broken extras visible but disabled with a reason', () => {
    const presets = projectNewConversationPresets([
      { id: 'dsh-editor-writing', status: 'ok' },
      { id: 'dsh-editor', status: 'broken', reason: 'legacy skill missing' },
      { id: 'plugin-preset', state: 'missing' },
    ], { developerMode: true })
    expect(presets.find((item) => item.id === 'dsh-editor')).toMatchObject({
      available: false,
      reason: 'legacy skill missing',
      legacy: true,
    })
    expect(presets.find((item) => item.id === 'plugin-preset')).toMatchObject({
      available: false,
      reason: '这个模式当前不可用。',
    })
    expect(canConfirmConversationPreset(presets, 'dsh-editor')).toBe(false)
  })

  it('falls back to the preset id when an extra has no host-provided name', () => {
    const presets = projectNewConversationPresets([{ id: 'plugin-preset', status: 'ok' }], { developerMode: true })
    expect(presets.find((item) => item.id === 'plugin-preset')).toMatchObject({ name: 'plugin-preset', description: '' })
  })

  it('rejects a custom preset id without the dev flag and accepts it with the flag', async () => {
    const host = hostFixture()
    host.select.mockResolvedValue({ ok: true, value: 'standard' })
    await expect(confirmNewConversationPreset(host, {
      workspaceId: 'ws-1',
      presetId: 'standard',
    })).resolves.toMatchObject({ ok: false, sessionId: undefined })
    expect(host.create).not.toHaveBeenCalled()
    await expect(confirmNewConversationPreset(host, {
      workspaceId: 'ws-1',
      presetId: 'standard',
      allowCustomPreset: true,
    })).resolves.toEqual({ ok: true, sessionId: 'session-new', agentPreset: 'standard' })
    expect(host.select).toHaveBeenCalledWith('session-new', 'standard')
    expect(host.open).toHaveBeenCalledWith('session-new')
  })

  it('gates confirm on the projected set when allowedPresetIds is given', async () => {
    const host = hostFixture()
    await expect(confirmNewConversationPreset(host, {
      workspaceId: 'ws-1',
      presetId: 'dsh-editor-novel',
      allowedPresetIds: ['dsh-editor-writing', 'dsh-editor-article'],
    })).resolves.toMatchObject({ ok: false, sessionId: undefined })
    expect(host.create).not.toHaveBeenCalled()
    host.select.mockResolvedValue({ ok: true, value: 'dsh-editor-article' })
    await expect(confirmNewConversationPreset(host, {
      workspaceId: 'ws-1',
      presetId: 'dsh-editor-article',
      allowedPresetIds: ['dsh-editor-writing', 'dsh-editor-article'],
    })).resolves.toEqual({ ok: true, sessionId: 'session-new', agentPreset: 'dsh-editor-article' })
    expect(host.select).toHaveBeenCalledWith('session-new', 'dsh-editor-article')
  })
})

describe('new conversation preset picker flow', () => {
  it('cancels before confirm with zero create', async () => {
    const list = vi.fn(async () => ({ ok: true as const, value: listed }))
    const create = vi.fn()
    const started = await startNewConversationPresetFlow({
      canDiscardDraft: async () => true,
      list,
    })
    expect(started).toMatchObject({ kind: 'listed' })
    expect(list).toHaveBeenCalledTimes(1)
    await cancelNewConversationPresetPicker({})
    expect(create).not.toHaveBeenCalled()
  })

  it('loads choices from RpcResult<AgentPresetRoster> without treating authorable as a row', async () => {
    const loaded = await loadNewConversationPresets(async () => ({ ok: true, value: realRoster }))
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.presets).toHaveLength(3)
    expect(loaded.presets.find((item) => item.id === 'dsh-editor-novel')).toMatchObject({
      available: false,
      reason: 'skill missing',
    })
    expect(loaded.presets.some((item) => item.id === 'dsh-editor-technical')).toBe(false)
  })

  it('retries a failed list without creating a session', async () => {
    const list = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: true, value: listed })
    const first = await loadNewConversationPresets(list)
    expect(first).toEqual({ ok: false, error: '对话模式列表未能载入，请重试。' })
    const second = await loadNewConversationPresets(list)
    expect(second.ok).toBe(true)
    if (second.ok) expect(second.presets).toHaveLength(4)
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('blocks the picker when the draft guard refuses, and never lists or creates', async () => {
    const list = vi.fn()
    const started = await startNewConversationPresetFlow({
      canDiscardDraft: async () => false,
      list,
    })
    expect(started).toEqual({ kind: 'blocked' })
    expect(list).not.toHaveBeenCalled()
  })

  it('creates, selects, applies the model, then opens — in that order', async () => {
    const order: string[] = []
    const host = hostFixture()
    host.create.mockImplementation(async (opts) => {
      order.push('create')
      expect(opts).toEqual({ workspaceId: 'ws-1' })
      expect(opts).not.toHaveProperty('agentPreset')
      return 'session-new'
    })
    host.select.mockImplementation(async (sessionId, id) => {
      order.push('select')
      expect(sessionId).toBe('session-new')
      expect(id).toBe('dsh-editor-writing')
      return { ok: true, value: 'dsh-editor-writing' }
    })
    host.applyDefaultModel.mockImplementation(async (sessionId) => {
      order.push('model')
      expect(sessionId).toBe('session-new')
    })
    host.open.mockImplementation((id) => {
      order.push('open')
      expect(id).toBe('session-new')
    })
    await expect(confirmNewConversationPreset(host, {
      workspaceId: 'ws-1',
      presetId: 'dsh-editor-writing',
    })).resolves.toEqual({ ok: true, sessionId: 'session-new', agentPreset: 'dsh-editor-writing' })
    expect(order).toEqual(['create', 'select', 'model', 'open'])
    expect(host.create).toHaveBeenCalledTimes(1)
  })

  it('still opens after a successful select if default model application throws', async () => {
    const host = hostFixture()
    host.applyDefaultModel.mockRejectedValueOnce(new Error('model catalog down'))
    await expect(confirmNewConversationPreset(host, {
      workspaceId: 'ws-1',
      presetId: 'dsh-editor-writing',
    })).resolves.toEqual({ ok: true, sessionId: 'session-new', agentPreset: 'dsh-editor-writing' })
    expect(host.open).toHaveBeenCalledWith('session-new')
  })

  it('keeps the same pending session id when select fails and retries', async () => {
    const host = hostFixture()
    host.select
      .mockResolvedValueOnce({ ok: false, error: { code: 'unavailable', message: 'busy' } })
      .mockResolvedValueOnce({ ok: true, value: 'dsh-editor-novel' })
    const first = await confirmNewConversationPreset(host, {
      workspaceId: 'ws-1',
      presetId: 'dsh-editor-novel',
    })
    expect(first).toEqual({ ok: false, sessionId: 'session-new', error: '对话模式未能应用，请重试。未发送任何消息。' })
    expect(host.open).not.toHaveBeenCalled()
    expect(host.applyDefaultModel).not.toHaveBeenCalled()
    const retry = await confirmNewConversationPreset(host, {
      workspaceId: 'ws-1',
      presetId: 'dsh-editor-novel',
      pendingSessionId: first.ok ? undefined : first.sessionId,
    })
    expect(retry).toEqual({ ok: true, sessionId: 'session-new', agentPreset: 'dsh-editor-novel' })
    expect(host.create).toHaveBeenCalledTimes(1)
    expect(host.select).toHaveBeenCalledTimes(2)
    expect(host.select.mock.calls[0]).toEqual(['session-new', 'dsh-editor-novel'])
    expect(host.select.mock.calls[1]).toEqual(['session-new', 'dsh-editor-novel'])
    expect(host.open).toHaveBeenCalledWith('session-new')
  })

  it('fails closed on a malformed select success value and keeps the pending session for retry', async () => {
    const host = hostFixture()
    host.select
      .mockResolvedValueOnce({ ok: true, value: { selected: 12, agentPreset: null } as never })
      .mockResolvedValueOnce({ ok: true, value: 'dsh-editor-writing' })
    const first = await confirmNewConversationPreset(host, {
      workspaceId: 'ws-1',
      presetId: 'dsh-editor-writing',
    })
    expect(first).toEqual({ ok: false, sessionId: 'session-new', error: '对话模式未能应用，请重试。未发送任何消息。' })
    expect(host.applyDefaultModel).not.toHaveBeenCalled()
    expect(host.open).not.toHaveBeenCalled()
    const retry = await confirmNewConversationPreset(host, {
      workspaceId: 'ws-1',
      presetId: 'dsh-editor-writing',
      pendingSessionId: first.ok ? undefined : first.sessionId,
    })
    expect(retry).toEqual({ ok: true, sessionId: 'session-new', agentPreset: 'dsh-editor-writing' })
    expect(host.create).toHaveBeenCalledTimes(1)
    expect(host.select).toHaveBeenCalledTimes(2)
    expect(host.open).toHaveBeenCalledWith('session-new')
  })

  it.each([
    'dsh-editor-novel',
    { selected: 'dsh-editor-novel' },
    { agentPreset: 'dsh-editor-article' },
  ])('fails closed when the host-returned preset %j differs from the requested id', async (value) => {
    const host = hostFixture()
    host.select.mockResolvedValueOnce({ ok: true, value: value as never })
    await expect(confirmNewConversationPreset(host, {
      workspaceId: 'ws-1',
      presetId: 'dsh-editor-writing',
    })).resolves.toEqual({
      ok: false,
      sessionId: 'session-new',
      error: '对话模式未能应用，请重试。未发送任何消息。',
    })
    expect(host.applyDefaultModel).not.toHaveBeenCalled()
    expect(host.open).not.toHaveBeenCalled()
  })

  it.each([
    undefined,
    '',
    '   ',
    1,
    { id: 'dsh-editor-writing' },
    { selected: '', agentPreset: '   ' },
  ])('does not fall back to the requested id when select success is %j', async (value) => {
    const host = hostFixture()
    host.select.mockResolvedValueOnce({ ok: true, value: value as never })
    await expect(confirmNewConversationPreset(host, {
      workspaceId: 'ws-1',
      presetId: 'dsh-editor-writing',
    })).resolves.toEqual({
      ok: false,
      sessionId: 'session-new',
      error: '对话模式未能应用，请重试。未发送任何消息。',
    })
    expect(host.open).not.toHaveBeenCalled()
  })

  it('best-effort archives a failed pending session on cancel and still closes if archive throws', async () => {
    const archive = vi.fn(async () => {
      throw new Error('archive failed')
    })
    await expect(cancelNewConversationPresetPicker({
      pendingSessionId: 'session-new',
      archive,
    })).resolves.toBeUndefined()
    expect(archive).toHaveBeenCalledWith('session-new')
  })
})

describe('legacy session gate from host projection', () => {
  it('reads agentPreset from sessions.byId, flat or nested under projectionValues, and treats the four new modes as non-legacy', () => {
    const byId = {
      legacy: { agentPreset: 'dsh-editor' },
      legacyNested: { projectionValues: { agentPreset: 'dsh-editor' } },
      writing: { agentPreset: 'dsh-editor-writing' },
      novel: { projectionValues: { agentPreset: 'dsh-editor-novel' } },
      article: { agentPreset: 'dsh-editor-article' },
      technical: { agentPreset: 'dsh-editor-technical' },
      unknown: {},
    }
    expect(isLegacyEditorPreset(sessionAgentPreset(byId, 'legacy'))).toBe(true)
    expect(shouldRunLegacyNovelPipeline(sessionAgentPreset(byId, 'legacy'))).toBe(true)
    expect(shouldRunLegacyNovelPipeline(sessionAgentPreset(byId, 'legacyNested'))).toBe(true)
    for (const id of ['writing', 'novel', 'article', 'technical', 'unknown'] as const) {
      expect(shouldRunLegacyNovelPipeline(sessionAgentPreset(byId, id))).toBe(false)
    }
  })

  it('prefers an explicit flat value over the nested projection, including null', () => {
    const byId = {
      flatWins: { agentPreset: 'dsh-editor-writing', projectionValues: { agentPreset: 'dsh-editor' } },
      nestedNull: { projectionValues: { agentPreset: null } },
      nestedEmpty: { projectionValues: {} },
    }
    expect(sessionAgentPreset(byId, 'flatWins')).toBe('dsh-editor-writing')
    expect(sessionAgentPreset(byId, 'nestedNull')).toBeNull()
    expect(sessionAgentPreset(byId, 'nestedEmpty')).toBeUndefined()
    expect(shouldRunLegacyNovelPipeline(sessionAgentPreset(byId, 'flatWins'))).toBe(false)
    expect(shouldRunLegacyNovelPipeline(sessionAgentPreset(byId, 'nestedNull'))).toBe(false)
  })

  it('treats null, undefined, and unknown ids as non-legacy without fallback', () => {
    const byId = {
      nulled: { agentPreset: null },
      empty: {},
      other: { agentPreset: 'standard' },
    }
    expect(sessionAgentPreset(byId, 'nulled')).toBeNull()
    expect(sessionAgentPreset(byId, 'empty')).toBeUndefined()
    expect(sessionAgentPreset(byId, 'missing')).toBeUndefined()
    expect(sessionAgentPreset(undefined, 'any')).toBeUndefined()
    expect(isLegacyEditorPreset(null)).toBe(false)
    expect(isLegacyEditorPreset(undefined)).toBe(false)
    expect(isLegacyEditorPreset('standard')).toBe(false)
    expect(shouldRunLegacyNovelPipeline(null)).toBe(false)
    expect(shouldRunLegacyNovelPipeline(undefined)).toBe(false)
    expect(shouldRunLegacyNovelPipeline(sessionAgentPreset(byId, 'nulled'))).toBe(false)
    expect(shouldRunLegacyNovelPipeline(sessionAgentPreset(byId, 'missing'))).toBe(false)
    expect(shouldRunLegacyNovelPipeline(sessionAgentPreset(byId, 'other'))).toBe(false)
  })

  it('unwraps the host select actual string without inventing a requested fallback', () => {
    expect(actualAgentPreset('dsh-editor-writing')).toBe('dsh-editor-writing')
    expect(actualAgentPreset({ selected: 'dsh-editor-article' })).toBe('dsh-editor-article')
    expect(actualAgentPreset({ agentPreset: 'dsh-editor-novel' })).toBe('dsh-editor-novel')
    expect(actualAgentPreset(undefined)).toBeUndefined()
    expect(actualAgentPreset('')).toBeUndefined()
    expect(actualAgentPreset({ selected: '' })).toBeUndefined()
  })
})

describe('conversation preset label for the current session', () => {
  it('uses product copy for the four writing modes regardless of roster names', () => {
    expect(conversationPresetLabel('dsh-editor-writing')?.name).toBe('通用写作')
    expect(conversationPresetLabel('dsh-editor-writing')?.description).toContain('查找、阅读、提案')
    expect(conversationPresetLabel('dsh-editor-novel')?.name).toBe('小说创作')
    expect(conversationPresetLabel('dsh-editor-article')?.name).toBe('文章与自媒体')
    expect(conversationPresetLabel('dsh-editor-technical')?.name).toBe('技术文档')
    expect(conversationPresetLabel(null)).toBeUndefined()
    expect(conversationPresetLabel('  ')).toBeUndefined()
  })

  it('labels legacy and official/community ids from the roster, with product fallbacks', () => {
    expect(conversationPresetLabel('dsh-editor')?.name).toBe('旧版会话')
    expect(conversationPresetLabel('dsh-editor', listed)?.name).toBe('旧采访')
    expect(conversationPresetLabel('standard')).toEqual({
      id: 'standard',
      name: 'standard',
      description: '此模式使用自身工具目录，不限制终端等官方工具。',
    })
    expect(conversationPresetLabel('standard', listed)).toEqual({
      id: 'standard',
      name: '编码',
      description: '此模式使用自身工具目录，不限制终端等官方工具。',
    })
    expect(conversationPresetLabel('plugin-preset', [{ id: 'plugin-preset', name: '团队风格', description: '组内约定' }])).toEqual({
      id: 'plugin-preset',
      name: '团队风格',
      description: '组内约定',
    })
  })
})
