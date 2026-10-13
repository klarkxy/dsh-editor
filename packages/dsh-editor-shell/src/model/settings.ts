import type { MessageKey } from '../i18n/index.ts'

/*
 * 全页设置的导航模型（shell-rewrite-spec §7）：固定分区 + 插件配置动态项。
 * 固定分区 id 同时是导航 data-testid 的一部分；插件配置项 id 沿用插件页的
 * official:/model:/zhihu/plugin: 前缀规则。
 */
export type SettingsSectionId =
  | 'writing'
  | 'models'
  | 'assistant'
  | 'appearance'
  | 'shortcuts'
  | 'plugins-installed'
  | 'plugins-discovery'
  | 'plugins-manager'
  | 'usage'
  | 'about'
  | 'advanced'

/** `openSettings(tab)` 的入参仍叫 SettingsTab；动态配置分区按裸字符串传递。 */
export type SettingsTab = SettingsSectionId

export type SettingsNavItem = {
  id: SettingsSectionId
  label: MessageKey
  /** 高级分区带警告图标，文字仍用中性色。 */
  warn?: boolean
}

export type SettingsNavGroup = { label: MessageKey; items: readonly SettingsNavItem[] }

const WRITING_GROUP: readonly SettingsNavItem[] = [
  { id: 'writing', label: 'settings.writing' },
  { id: 'models', label: 'settings.models' },
  { id: 'assistant', label: 'settings.assistant' },
]

const APP_GROUP: readonly SettingsNavItem[] = [
  { id: 'appearance', label: 'settings.appearanceTitle' },
  { id: 'shortcuts', label: 'settings.shortcuts' },
]

const PLUGINS_GROUP: readonly SettingsNavItem[] = [
  { id: 'plugins-installed', label: 'settings.pluginsInstalled' },
  { id: 'plugins-discovery', label: 'settings.pluginsDiscovery' },
  { id: 'plugins-manager', label: 'plugins.navManager' },
]

const MORE_GROUP: readonly SettingsNavItem[] = [
  { id: 'usage', label: 'settings.usage' },
  { id: 'about', label: 'settings.about' },
  { id: 'advanced', label: 'settings.advanced', warn: true },
]

/** 助手能力关闭时模型/助手分区整项隐藏，其余分区顺序不变。 */
export function composeSettingsNavGroups(assistantEnabled: boolean): SettingsNavGroup[] {
  const writing = assistantEnabled
    ? WRITING_GROUP
    : WRITING_GROUP.filter(item => item.id === 'writing')
  return [
    { label: 'settings.groupWriting', items: writing },
    { label: 'settings.groupApp', items: APP_GROUP },
    { label: 'settings.plugins', items: PLUGINS_GROUP },
    { label: 'settings.groupMore', items: MORE_GROUP },
  ]
}

const FIXED_SECTION_IDS: readonly string[] = [
  'writing', 'models', 'assistant', 'appearance', 'shortcuts',
  'plugins-installed', 'plugins-discovery', 'plugins-manager',
  'usage', 'about', 'advanced',
]

/** 插件分组里的动态配置分区沿用插件页的 id 前缀规则。 */
export function isPluginsSection(id: string): boolean {
  return id === 'plugins-installed' || id === 'plugins-discovery' || id === 'plugins-manager'
    || id.startsWith('official:')
    || id.startsWith('model:')
    || id === 'zhihu'
    || id.startsWith('plugin:')
}

const LEGACY_SECTION_MAP: Record<string, string> = {
  general: 'appearance',
  plugins: 'plugins-installed',
}

/** 旧 tab 词表与遗留存储值统一映射到新分区 id；未知 id 原样透传。 */
export function normalizeSettingsSection(tab: string | undefined): string {
  if (!tab) return 'writing'
  return LEGACY_SECTION_MAP[tab] ?? tab
}

const SETTINGS_TAB_KEY = 'dsh-editor.settings.tab'

export function readStoredTab(): string {
  try {
    const value = globalThis.localStorage?.getItem(SETTINGS_TAB_KEY)
    if (value) {
      const normalized = normalizeSettingsSection(value)
      if (FIXED_SECTION_IDS.includes(normalized) || isPluginsSection(normalized)) return normalized
    }
  } catch { /* optional preference */ }
  return 'writing'
}

export function persistTab(tab: string): void {
  try { globalThis.localStorage?.setItem(SETTINGS_TAB_KEY, tab) } catch { /* optional preference */ }
}
