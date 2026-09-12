import { createElement as e, useEffect, useRef, useState, type ReactNode } from 'react'
import type { SettingsScope } from '../dsh-compat.ts'
import type { ShellContext } from './shared.ts'
import { WritingSettings } from '../writing-settings.ts'
import type { WritingMigration, WritingPreferences } from '../writing-settings.ts'
import { SettingsGeneralSection } from './settings-general.tsx'
import { SettingsModelsSection } from './settings-models.tsx'
import { SettingsUsageSection } from './settings-usage.tsx'
import { t, useLocale } from '../i18n/index.ts'
import { Button, Dialog, Tabs, TabsContent, TabsList, TabsTrigger, m } from './ui/index.ts'
import { useReducedMotion } from 'motion/react'


export type SettingsTab = 'general' | 'models' | 'writing' | 'usage' | 'zhihu' | 'plugins'

const SETTINGS_TAB_KEY = 'dsh-editor.settings.tab'
const SETTINGS_TABS: SettingsTab[] = ['general', 'models', 'writing', 'usage', 'zhihu', 'plugins']

function readStoredTab(): SettingsTab {
  try {
    const value = globalThis.localStorage?.getItem(SETTINGS_TAB_KEY)
    if (value && (SETTINGS_TABS as string[]).includes(value)) return value as SettingsTab
  } catch { /* optional preference */ }
  return 'general'
}

function persistTab(tab: SettingsTab): void {
  try { globalThis.localStorage?.setItem(SETTINGS_TAB_KEY, tab) } catch { /* optional preference */ }
}

function SettingsTabPage(props: { tab: SettingsTab; active: boolean; children?: ReactNode }) {
  const reduce = useReducedMotion()
  return e(TabsContent, {
    value: props.tab,
    forceMount: true,
    hidden: !props.active,
    className: `settings-content${props.active ? ' is-active' : ''}`,
    style: { pointerEvents: props.active ? 'auto' : 'none' },
  },
    e(m.div, {
      className: 'settings-page',
      initial: false,
      animate: reduce || props.active ? { opacity: 1, y: 0 } : { opacity: 0, y: 6 },
      transition: reduce ? { duration: 0 } : { type: 'spring' as const, stiffness: 360, damping: 32, mass: 0.85 },
      style: { pointerEvents: props.active ? 'auto' : 'none' },
    }, props.children),
  )
}

function tabLabel(tab: SettingsTab): string {
  if (tab === 'general') return t('settings.general')
  if (tab === 'models') return t('settings.models')
  if (tab === 'writing') return t('settings.writing')
  if (tab === 'plugins') return t('settings.plugins')
  if (tab === 'zhihu') return t('settings.zhihu')
  return t('settings.usage')
}

/** 顶栏设置入口。保留 .native-settings-control 包裹和 aria-haspopup 约定（e2e 依赖）。 */
export function SettingsTrigger(props: { onOpen(): void }) {
  return e('span', { className: 'native-settings-control' },
    e('button', {
      type: 'button',
      className: 'settings-trigger',
      'aria-haspopup': 'dialog',
      onClick: props.onOpen,
    },
      e('span', { className: 'settings-trigger-icon', 'aria-hidden': true }, '⚙'),
      t('common.settings'),
    ),
  )
}

export function SettingsDialog(props: {
  ctx: ShellContext
  writingScope: SettingsScope<WritingPreferences>
  migrateWriting: WritingMigration
  /* 助手能力开关：false 时隐藏模型等助手专属设置；undefined 表示能力尚未加载，保持原样。 */
  assistant?: boolean
  pluginsTab?: ReactNode
  zhihuTab?: ReactNode
  open?: boolean
  onClose(): void
}) {
  useLocale()
  const open = props.open ?? true
  const [tab, setTab] = useState<SettingsTab>(readStoredTab)
  const [note, setNote] = useState('')
  const closeRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (!open) setNote('')
  }, [open])
  const selectTab = (next: SettingsTab) => {
    setTab(next)
    persistTab(next)
  }

  const openConfigFile = async () => {
    setNote('')
    try {
      const response = await props.ctx.remote.settings.openSettingsDocument()
      if (!response.ok) setNote(t('settings.openConfigFailed', { error: response.error.message ?? '' }))
    } catch (error) {
      setNote(t('settings.openConfigFailed', { error: error instanceof Error ? error.message : String(error) }))
    }
  }

  const tabs: SettingsTab[] = props.assistant === false
    ? ['general', 'writing', 'usage', 'zhihu', 'plugins']
    : ['general', 'models', 'writing', 'usage', 'zhihu', 'plugins']
  const content: Record<SettingsTab, () => ReactNode> = {
    general: () => e(SettingsGeneralSection, { ctx: props.ctx }),
    models: () => e(SettingsModelsSection, { ctx: props.ctx, writingScope: props.writingScope }),
    writing: () => e(WritingSettings, { scope: props.writingScope, migrate: props.migrateWriting }),
    usage: () => e(SettingsUsageSection, { ctx: props.ctx }),
    zhihu: () => props.zhihuTab ?? e('p', { className: 'muted' }, t('settings.zhihuUnavailable')),
    plugins: () => props.pluginsTab ?? e('p', { className: 'muted' }, t('settings.pluginsUnavailable')),
  }
  /* 能力在弹窗打开期间变为停用时，回落到仍可用的分类。 */
  const activeTab = tabs.includes(tab) ? tab : 'general'

  return e(Dialog, {
    open,
    onOpenChange: (next: boolean) => { if (!next) props.onClose() },
    title: t('common.settings'),
    className: 'file-dialog settings-dialog',
    overlayClassName: 'file-dialog-overlay settings-overlay',
    initialFocusRef: closeRef,
  },
    e(Tabs, { value: activeTab, onValueChange: (value) => selectTab(value as SettingsTab), orientation: 'vertical', className: 'settings-tabs' },
      e('aside', { className: 'settings-nav' },
        e('h2', { id: 'settings-dialog-title' }, t('common.settings')),
        e(TabsList, { 'aria-label': t('settings.nav') },
          tabs.map((key) => e(TabsTrigger, {
            key,
            value: key,
            className: `settings-tab${activeTab === key ? ' active' : ''}`,
            'aria-current': activeTab === key,
          }, tabLabel(key))),
        ),
      ),
      e('div', { className: 'settings-body' },
        e('header', { className: 'settings-header' },
          e('span', { className: 'settings-header-title' }, tabLabel(activeTab)),
          props.ctx.connection.isLoopback ? e('button', { type: 'button', className: 'settings-open-config', onClick: () => void openConfigFile() }, t('settings.openConfig')) : null,
          e(Button, { ref: closeRef, variant: 'icon', className: 'icon-button settings-close', 'aria-label': t('settings.close'), onClick: props.onClose }, '×'),
        ),
        note ? e('p', { className: 'warning pad', role: 'alert' }, note) : null,
        e('div', { className: 'settings-pages', tabIndex: 0 },
          tabs.map((key) => e(SettingsTabPage, { key, tab: key, active: key === activeTab }, content[key]())),
        ),
      ),
    ),
  )
}
