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
    roles: '模型预设',
    purposes: '其他功能',
    noPurposes: '没有其他功能需要单独配置。',
    unbound: '跟随默认模型',
    bindNormal: '默认模型',
    commonModels: '常用功能',
    otherModels: '其他功能',
    advanced: '高级设置',
    defaultPreset: '默认模型',
    efficientPreset: '省资源模型',
    qualityPreset: '高质量模型',
    followDefault: '跟随默认模型',
    followEfficient: '跟随省资源模型',
    followQuality: '跟随高质量模型',
    useModel: '使用模型',
    followSession: '跟随当前会话',
    explicit: '指定模型',
    provider: '供应商',
    model: '模型',
    effort: '推理强度',
    exactEffort: '精确强度',
    exactModel: '精确模型',
    exactIds: '精确 ID',
    chooseModel: '选择模型',
    catalog: '会话模型',
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
    roles: 'Model presets',
    purposes: 'Other features',
    noPurposes: 'No other features need a separate model.',
    unbound: 'Follow default model',
    bindNormal: 'Default model',
    commonModels: 'Common features',
    otherModels: 'Other features',
    advanced: 'Advanced settings',
    defaultPreset: 'Default model',
    efficientPreset: 'Efficient model',
    qualityPreset: 'High-quality model',
    followDefault: 'Follow default model',
    followEfficient: 'Follow efficient model',
    followQuality: 'Follow high-quality model',
    useModel: 'Use model',
    followSession: 'Follow current session',
    explicit: 'Explicit model',
    provider: 'Provider',
    model: 'Model',
    effort: 'Reasoning',
    exactEffort: 'Exact effort',
    exactModel: 'Exact model',
    exactIds: 'Exact IDs',
    chooseModel: 'Choose a model',
    catalog: 'Session models',
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
