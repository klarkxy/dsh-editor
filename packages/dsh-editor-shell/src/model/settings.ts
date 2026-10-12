import type { MessageKey } from '../i18n/index.ts'

export type SettingsTab = 'general' | 'models' | 'assistant' | 'writing' | 'shortcuts' | 'usage' | 'about'

const SETTINGS_TAB_KEY = 'dsh-editor.settings.tab'
export const SETTINGS_TABS: SettingsTab[] = ['general', 'models', 'assistant', 'writing', 'shortcuts', 'usage', 'about']
/** Application preferences only; plugin pages live in the plugin workspace. */
export function composeSettingsNavTabs(featureTabs: readonly SettingsTab[]): SettingsTab[] {
  return [...featureTabs, 'about']
}

export function composeSettingsNavGroups(
  featureTabs: readonly SettingsTab[],
): { label: MessageKey; tabs: SettingsTab[] }[] {
  const available = (tabs: SettingsTab[]) => tabs.filter(tab => featureTabs.includes(tab))
  const groups: { label: MessageKey; tabs: SettingsTab[] }[] = [
    { label: 'settings.groupWriting', tabs: available(['writing', 'shortcuts']) },
    { label: 'settings.groupAssistant', tabs: available(['assistant', 'models', 'usage']) },
    { label: 'settings.groupApp', tabs: ['general', 'about'] },
  ]
  return groups.filter(group => group.tabs.length)
}

export function readStoredTab(): string {
  try {
    const value = globalThis.localStorage?.getItem(SETTINGS_TAB_KEY)
    if (value && (SETTINGS_TABS as string[]).includes(value)) return value
  } catch { /* optional preference */ }
  return 'general'
}

export function persistTab(tab: string): void {
  try { globalThis.localStorage?.setItem(SETTINGS_TAB_KEY, tab) } catch { /* optional preference */ }
}
