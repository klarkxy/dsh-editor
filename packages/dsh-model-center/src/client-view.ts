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
    capabilityHint: '功能可跟随模型档位，也可单独指定模型；更改档位会影响所有跟随它的功能。',
    capabilities: '能力默认值',
    unsaved: '有未保存的更改',
    notConfigured: '请先设置对话档',
    purposes: '其他功能',
    noPurposes: '没有其他功能需要单独配置。',
    unbound: '跟随对话',
    bindNormal: '对话',
    commonModels: '常用功能',
    otherModels: '其他功能',
    advanced: '更多能力设置',
    flowHint: '先在“供应商”连接模型，再为对话等档位选择模型；能力默认值会跟随所选档位。连接变化不会自动改写已保存的绑定。',
    unavailableProvider: '供应商当前不在可用目录中',
    unavailableModel: '模型当前不在可用目录中',
    unavailableOption: '（当前不可用）',
    affectedSummary: '个功能仍指向不可用模型',
    affectedSummarySingular: '个功能仍指向不可用模型',
    recoveryHint: '请在下方为受影响的档位或功能选择可用模型，然后保存。',
    affectedAdvanced: '受影响的其他功能：',
    noCatalog: '当前未取得可用模型目录。请检查“供应商”连接，或刷新可用模型。',
    refreshCatalog: '刷新可用模型',
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
    capabilityHint: 'Features can follow a tier or use their own model. Changing a tier affects every feature that follows it.',
    capabilities: 'Capability defaults',
    unsaved: 'Unsaved changes',
    notConfigured: 'Configure the Chat tier first',
    purposes: 'Other features',
    noPurposes: 'No other features need a separate model.',
    unbound: 'Follow Chat',
    bindNormal: 'Chat',
    commonModels: 'Common features',
    otherModels: 'Other features',
    advanced: 'More capability settings',
    flowHint: 'Connect models under Providers, then choose models for tiers such as Chat. Capability defaults follow their selected tier. Connection changes do not rewrite saved bindings.',
    unavailableProvider: 'Provider is not in the current catalogue',
    unavailableModel: 'Model is not in the current catalogue',
    unavailableOption: ' (currently unavailable)',
    affectedSummary: 'features still use an unavailable model',
    affectedSummarySingular: 'feature still uses an unavailable model',
    recoveryHint: 'Choose an available model for the affected tiers or features below, then save.',
    affectedAdvanced: 'Other affected features: ',
    noCatalog: 'No available model catalogue was loaded. Check Providers or refresh available models.',
    refreshCatalog: 'Refresh available models',
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
