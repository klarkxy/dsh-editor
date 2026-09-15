/*
 * 开发者设置：目前只有"开发者模式"一个开关。设置页（settings-general.tsx）负责写入，
 * 会话面板（chat.ts）在列出/应用对话模式 preset 时读取，绕过四个写作模式的白名单。
 */

export const DEVELOPER_SETTINGS_NAMESPACE = 'ui-developer'

export type DeveloperSettings = { developerMode: boolean }

export const DEFAULT_DEVELOPER_SETTINGS: DeveloperSettings = { developerMode: false }

export function decodeDeveloperSettings(value: unknown): DeveloperSettings | undefined {
  const developerMode = (value as { developerMode?: unknown } | null | undefined)?.developerMode
  return typeof developerMode === 'boolean' ? { developerMode } : undefined
}
