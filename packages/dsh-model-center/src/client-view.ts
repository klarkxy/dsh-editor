import {
  AI_RPC_CHANNEL, MODEL_CENTER_RPC_CHANNEL, MODEL_SETTINGS_SLOT, type ModelCenterLocale, type ModelCenterStatus,
  type ModelCenterTab, type RpcResult,
} from './contracts.ts'

export const SETTINGS_SECTION_SLOT = 'settings.section'
export const MODEL_CENTER_SLOT_ID = 'model-center'
export const MODEL_CENTER_SLOT_ORDER = 40

export const SETTINGS_SEAT = {
  replacement: MODEL_SETTINGS_SLOT,
  fallback: SETTINGS_SECTION_SLOT,
  exclusive: true,
} as const

export function visibleSettingsSeat(replacementAvailable: boolean): 'replacement' | 'section' {
  return replacementAvailable ? 'replacement' : 'section'
}

export class RpcCallError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message)
    this.name = 'RpcCallError'
  }
}

export function unwrapRpc<T>(result: unknown): T {
  if (!result || typeof result !== 'object') throw new RpcCallError('请求失败。')
  const row = result as RpcResult<T>
  if ('ok' in row) {
    if (!row.ok) throw new RpcCallError(row.error.message || '请求失败。', row.error.code)
    return row.value
  }
  return result as T
}

export function isHostEnabledStatus(value: unknown): boolean {
  try {
    const status = unwrapRpc<ModelCenterStatus>(value)
    return status.enabled === true
  } catch {
    return false
  }
}

export function shouldReplaceModelsUi(enabled: boolean): boolean {
  return enabled === true
}

export function tablistKey(current: ModelCenterTab, key: string): ModelCenterTab | undefined {
  if (key === 'Home') return 'policy'
  if (key === 'End') return 'providers'
  if (key === 'ArrowRight' || key === 'ArrowLeft') {
    const tabs: ModelCenterTab[] = ['policy', 'runtime', 'providers']
    const index = tabs.indexOf(current)
    const step = key === 'ArrowRight' ? 1 : -1
    return tabs[(index + step + tabs.length) % tabs.length]
  }
  return undefined
}

export function tabLabel(tab: ModelCenterTab, locale: ModelCenterLocale): string {
  if (tab === 'providers') return locale === 'en' ? 'Providers' : '供应商'
  if (tab === 'runtime') return locale === 'en' ? 'Runtime' : '运行设置'
  return locale === 'en' ? 'Model routing' : '模型配置'
}

export function centerLabel(locale: ModelCenterLocale): string {
  return locale === 'en' ? 'Model Center' : '模型中心'
}

export type SlotSpec = { name: string; id: string; label: string; order: number }

export function modelSettingsSlotSpec(locale: ModelCenterLocale): SlotSpec {
  return { name: MODEL_SETTINGS_SLOT, id: MODEL_CENTER_SLOT_ID, order: 0, label: centerLabel(locale) }
}

export function settingsSectionSlotSpec(locale: ModelCenterLocale): SlotSpec {
  return { name: SETTINGS_SECTION_SLOT, id: MODEL_CENTER_SLOT_ID, order: MODEL_CENTER_SLOT_ORDER, label: centerLabel(locale) }
}

export type SlotHandle = {
  inject: (key: string, callback: () => unknown) => unknown
  register: (spec: SlotSpec, render: unknown) => unknown
}

/** Bind the replacement seat when declared; otherwise the standalone settings.section. Never both. */
export function registerExclusiveSettingsSeats(
  slots: SlotHandle,
  render: unknown,
  locale: ModelCenterLocale = 'zh',
): () => void {
  let replacementLive = false
  let dropFallbackInject = () => {}
  let dropFallbackRegister = () => {}

  const dropReplacement = slots.inject(SETTINGS_SEAT.replacement, () => {
    replacementLive = true
    dropFallbackRegister()
    dropFallbackRegister = () => {}
    dropFallbackInject()
    dropFallbackInject = () => {}
    return slots.register(modelSettingsSlotSpec(locale), render)
  }) as () => void

  if (!replacementLive) {
    dropFallbackInject = slots.inject(SETTINGS_SEAT.fallback, () => {
      if (replacementLive) return () => {}
      dropFallbackRegister = slots.register(settingsSectionSlotSpec(locale), render) as () => void
      return () => { dropFallbackRegister() }
    }) as () => void
  }

  return () => {
    dropReplacement()
    dropFallbackInject()
    dropFallbackRegister()
  }
}

export const AI_STATUS_ENDPOINT = 'status'
export const AI_UPDATE_ENDPOINT = 'update'
export const AI_RESOLVE_ENDPOINT = 'resolve'
export const HOST_STATUS_ENDPOINT = 'status'

export function aiChannel(): string {
  return AI_RPC_CHANNEL
}

export function hostChannel(): string {
  return MODEL_CENTER_RPC_CHANNEL
}

export async function readHostEnabled(
  call: (channel: string, endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<unknown>,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    return isHostEnabledStatus(await call(MODEL_CENTER_RPC_CHANNEL, HOST_STATUS_ENDPOINT, {}, signal))
  } catch {
    return false
  }
}

export const COPY = {
  zh: {
    loading: '正在读取模型中心…',
    reconnect: '重新连接',
    hostOff: '模型中心未启用。',
    policyMissing: '无法读取 AI 策略。',
    save: '保存',
    saved: '已保存。',
    retry: '重试',
    limits: '限额与超时',
    retryLimit: '失败重试次数',
    concurrency: '并发',
    timeout: '超时（毫秒）',
    maxInput: '输入字符上限',
    maxOutput: '输出 token 上限',
    roles: '模型档位',
    fantasyPreset: '幻想',
    capabilityHint: '跟随档位时，模型与思考强度会一起更新。',
    capabilities: '能力默认值',
    unsaved: '有未保存的更改',
    notConfigured: '请先设置对话档',
    purposes: '其他功能',
    noPurposes: '没有其他功能需要单独配置。',
    unbound: '跟随对话',
    bindNormal: '对话',
    commonModels: '常用功能',
    otherModels: '其他功能',
    advanced: '高级设置',
    defaultPreset: '对话',
    efficientPreset: '快速',
    qualityPreset: '思考',
    followDefault: '跟随对话',
    followEfficient: '跟随快速',
    followQuality: '跟随思考',
    useModel: '使用模型',
    followSession: '跟随当前会话',
    explicit: '单独设置',
    provider: '供应商',
    model: '模型',
    effort: '思考强度',
    chooseModel: '选择模型',
    catalog: '模型',
    resolved: '解析结果',
    source: '配置来源',
    conflict: '冲突',
    discovery: '发现模型',
    discovering: '正在发现…',
    noProviders: '没有可列出的供应商。',
    live: '已激活',
    dormant: '未激活',
    openNative: '打开原生设置',
    nativeHint: '凭据请在原生设置中编辑。',
    editorHint: '供应商编辑由宿主提供。',
    revisionConflict: '配置已被更新，请刷新后重试。',
    storageFailed: '策略存储失败。',
    defaultEffort: '默认',
    unknownOp: '未知操作。',
  },
  en: {
    loading: 'Loading Model Center…',
    reconnect: 'Reconnect',
    hostOff: 'Model Center is off.',
    policyMissing: 'Could not read AI policy.',
    save: 'Save',
    saved: 'Saved.',
    retry: 'Retry',
    limits: 'Limits and timeouts',
    retryLimit: 'Retry attempts',
    concurrency: 'Concurrency',
    timeout: 'Timeout (ms)',
    maxInput: 'Input character cap',
    maxOutput: 'Output token cap',
    roles: 'Model tiers',
    fantasyPreset: 'Fantasy',
    capabilityHint: 'Following a tier inherits both its model and reasoning effort.',
    capabilities: 'Capability defaults',
    unsaved: 'Unsaved changes',
    notConfigured: 'Configure the Chat tier first',
    purposes: 'Other features',
    noPurposes: 'No other features need a separate model.',
    unbound: 'Follow Chat',
    bindNormal: 'Chat',
    commonModels: 'Common features',
    otherModels: 'Other features',
    advanced: 'Advanced settings',
    defaultPreset: 'Chat',
    efficientPreset: 'Quick',
    qualityPreset: 'Thinking',
    followDefault: 'Follow Chat',
    followEfficient: 'Follow Quick',
    followQuality: 'Follow Thinking',
    useModel: 'Use model',
    followSession: 'Follow current session',
    explicit: 'Custom',
    provider: 'Provider',
    model: 'Model',
    effort: 'Reasoning',
    chooseModel: 'Choose a model',
    catalog: 'Model',
    resolved: 'Resolved',
    source: 'Source',
    conflict: 'Conflict',
    discovery: 'Discover models',
    discovering: 'Discovering…',
    noProviders: 'No providers to list.',
    live: 'Live',
    dormant: 'Dormant',
    openNative: 'Open native settings',
    nativeHint: 'Edit credentials in native settings.',
    editorHint: 'The host supplies the provider editor.',
    revisionConflict: 'Policy changed; refresh and retry.',
    storageFailed: 'Policy storage failed.',
    defaultEffort: 'Default',
    unknownOp: 'Unknown operation.',
  },
} as const

export function copy(locale: ModelCenterLocale) {
  return COPY[locale]
}
