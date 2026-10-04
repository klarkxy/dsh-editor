/*
 * 破限模式：设置页（settings-general.tsx）里的一个开关。宿主侧 limit-break-config.ts
 * 读取它；开启时每次提示词组装都会把 resources/limit-break/agents-spec.md 追加为
 * 最后一段系统提示词。
 * 命名空间由宿主侧 cordis entry（cordis.patch.yml 的 ui-limit-break）注册；
 * 未注册的命名空间在客户端是不可用死开关。
 */

export const LIMIT_BREAK_SETTINGS_NAMESPACE = 'ui-limit-break'

export type LimitBreakSettings = { limitBreakMode: boolean }

export const DEFAULT_LIMIT_BREAK_SETTINGS: LimitBreakSettings = { limitBreakMode: false }

export function decodeLimitBreakSettings(value: unknown): LimitBreakSettings | undefined {
  const limitBreakMode = (value as { limitBreakMode?: unknown } | null | undefined)?.limitBreakMode
  return typeof limitBreakMode === 'boolean' ? { limitBreakMode } : undefined
}
