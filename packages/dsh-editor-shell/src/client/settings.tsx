import { createElement as e, useEffect, useRef, useState, type ReactNode } from 'react'
import type { SettingsScope } from '../dsh-compat.ts'
import type { ShellContext } from './shared.ts'
import { WritingSettings } from '../writing-settings.ts'
import type { WritingMigration, WritingPreferences } from '../writing-settings.ts'
import { AboutSettingsSection } from './settings-about.tsx'
import { SettingsGeneralSection } from './settings-general.tsx'
import { SettingsModelsSection } from './settings-models.tsx'
import {
  OfficialSettingsSectionPage,
  PLUGIN_SETTINGS_TAB_PREFIX,
  isPluginSettingsTab,
  useOfficialSettingsSections,
  type OfficialSettingsSection,
  type SettingsRenderSlot,
} from './settings-plugins.tsx'
import { SettingsUsageSection } from './settings-usage.tsx'
import { t, useLocale } from '../i18n/index.ts'
import { SettingsIcon } from './icons.tsx'
import { Button, Dialog, Tabs, TabsContent, TabsList, TabsTrigger, m } from './ui/index.ts'
import { useReducedMotion } from 'motion/react'

export type { SettingsRenderSlot }

export type SettingsTab = 'general' | 'models' | 'writing' | 'usage' | 'zhihu' | 'plugins' | 'about'

const SETTINGS_TAB_KEY = 'dsh-editor.settings.tab'
const SETTINGS_TABS: SettingsTab[] = ['general', 'models', 'writing', 'usage', 'zhihu', 'plugins', 'about']

function readStoredTab(): string {
  try {
    const value = globalThis.localStorage?.getItem(SETTINGS_TAB_KEY)
    if (value && (SETTINGS_TABS as string[]).includes(value)) return value
    if (value && isPluginSettingsTab(value)) return value
  } catch { /* optional preference */ }
  return 'general'
}

function persistTab(tab: string): void {
  try { globalThis.localStorage?.setItem(SETTINGS_TAB_KEY, tab) } catch { /* optional preference */ }
}

function SettingsTabPage(props: { tab: string; active: boolean; fromX?: number; children?: ReactNode }) {
  const reduce = useReducedMotion()
  /* 隐藏位姿保持方向中性(x:0):否则反向切回时会从上次留下的旧偏移滑入。
     方向只由入场 keyframes 携带——每次 activate,animate 从隐藏位姿变成新的
     keyframes,Motion 从 keyframes[0](本次切换方向)重新开始,不重挂、不丢 state。 */
  const enter = reduce
    ? { opacity: 1, x: 0, y: 0, filter: 'blur(0px)' }
    : { x: [props.fromX ?? 24, 0], opacity: [0, 1], y: [14, 0], filter: ['blur(4px)', 'blur(0px)'] }
  const pose = reduce
    ? { opacity: 1, x: 0, y: 0, filter: 'blur(0px)' }
    : props.active
      ? enter
      : { opacity: 0, x: 0, y: 12, filter: 'blur(3px)' }
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
      animate: pose,
      transition: reduce ? { duration: 0 } : {
        type: 'spring' as const, stiffness: 340, damping: 26, mass: 0.85,
        /* blur 不走弹簧：keyframes + 欠阻尼 spring 过冲会把 filter 插成负数。 */
        filter: { type: 'tween' as const, duration: 0.45, ease: 'easeOut' },
      },
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
  if (tab === 'about') return t('settings.about')
  return t('settings.usage')
}

function navLabel(tab: string, sections: readonly OfficialSettingsSection[]): string {
  if ((SETTINGS_TABS as string[]).includes(tab)) return tabLabel(tab as SettingsTab)
  return sections.find((section) => section.navId === tab)?.label ?? tab.slice(PLUGIN_SETTINGS_TAB_PREFIX.length)
}

/** 顶栏设置入口。保留 .native-settings-control 包裹和 aria-haspopup 约定（e2e 依赖）。 */
export function SettingsTrigger(props: { onOpen(): void }) {
  useLocale()
  return e('span', { className: 'native-settings-control' },
    e('button', {
      type: 'button',
      className: 'settings-trigger',
      'aria-haspopup': 'dialog',
      'aria-label': t('common.settings'),
      title: t('common.settings'),
      onClick: props.onOpen,
    },
      e('span', { className: 'settings-trigger-icon', 'aria-hidden': true }, e(SettingsIcon, { size: 16 })),
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
  renderSlot?: SettingsRenderSlot
  open?: boolean
  focusTab?: SettingsTab
  onClose(): void
}) {
  useLocale()
  const open = props.open ?? true
  const [tab, setTab] = useState(readStoredTab)
  const [note, setNote] = useState('')
  const [aboutBusy, setAboutBusy] = useState(false)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const official = useOfficialSettingsSections(props.ctx)
  const officialSections = props.renderSlot ? official.sections : []
  useEffect(() => {
    if (!open) {
      setNote('')
      setAboutBusy(false)
    }
  }, [open])
  const selectTab = (next: string) => {
    setTab(next)
    persistTab(next)
  }
  useEffect(() => {
    if (!open || !props.focusTab) return
    if (!(SETTINGS_TABS as string[]).includes(props.focusTab)) return
    setTab(props.focusTab)
    persistTab(props.focusTab)
  }, [open, props.focusTab])

  const openConfigFile = async () => {
    setNote('')
    try {
      const response = await props.ctx.remote.settings.openSettingsDocument()
      if (!response.ok) setNote(t('settings.openConfigFailed', { error: response.error.message ?? '' }))
    } catch (error) {
      setNote(t('settings.openConfigFailed', { error: error instanceof Error ? error.message : String(error) }))
    }
  }

  const featureTabs: SettingsTab[] = props.assistant === false
    ? ['general', 'writing', 'usage', 'zhihu', 'plugins']
    : ['general', 'models', 'writing', 'usage', 'zhihu', 'plugins']
  const navTabs: string[] = [...featureTabs, ...officialSections.map((section) => section.navId), 'about']
  /* 能力在弹窗打开期间变为停用时，或动态插件页消失时，回落到仍可用的分类。 */
  const activeTab = navTabs.includes(tab) ? tab : 'general'
  /* 页面切换方向感:往列表下方切内容从右滑入,往上切从左滑入。 */
  const previousTabRef = useRef(activeTab)
  const fromX = navTabs.indexOf(activeTab) >= navTabs.indexOf(previousTabRef.current) ? 24 : -24
  previousTabRef.current = activeTab
  const activeOfficial = officialSections.find((section) => section.navId === activeTab)
  const builtinPages: SettingsTab[] = [...featureTabs, 'about']
  const content: Record<SettingsTab, () => ReactNode> = {
    general: () => e(SettingsGeneralSection, { ctx: props.ctx }),
    models: () => e(SettingsModelsSection, { ctx: props.ctx, writingScope: props.writingScope }),
    writing: () => e(WritingSettings, { scope: props.writingScope, migrate: props.migrateWriting }),
    usage: () => e(SettingsUsageSection, { ctx: props.ctx }),
    zhihu: () => props.zhihuTab ?? e('p', { className: 'muted' }, t('settings.zhihuUnavailable')),
    plugins: () => props.pluginsTab ?? e('p', { className: 'muted' }, t('settings.pluginsUnavailable')),
    about: () => e(AboutSettingsSection, { active: activeTab === 'about', onBusyChange: setAboutBusy }),
  }

  return e(Dialog, {
    open,
    onOpenChange: (next: boolean) => { if (!next && !aboutBusy) props.onClose() },
    title: t('common.settings'),
    className: 'file-dialog settings-dialog',
    overlayClassName: 'file-dialog-overlay settings-overlay',
    dismissible: !aboutBusy,
    initialFocusRef: closeRef,
  },
    e(Tabs, { value: activeTab, onValueChange: selectTab, orientation: 'vertical', className: 'settings-tabs' },
      e('aside', { className: 'settings-nav' },
        e('h2', { id: 'settings-dialog-title' }, t('common.settings')),
        e(TabsList, { 'aria-label': t('settings.nav') },
          navTabs.map((key) => e(TabsTrigger, {
            key,
            value: key,
            className: `settings-tab${activeTab === key ? ' active' : ''}`,
            'aria-current': activeTab === key,
          }, navLabel(key, officialSections))),
        ),
      ),
      e('div', { className: 'settings-body' },
        e('header', { className: 'settings-header' },
          e('span', { className: 'settings-header-title' }, navLabel(activeTab, officialSections)),
          props.ctx.connection.isLoopback ? e('button', { type: 'button', className: 'settings-open-config', onClick: () => void openConfigFile() }, t('settings.openConfig')) : null,
          e(Button, { ref: closeRef, variant: 'icon', className: 'icon-button settings-close', 'aria-label': t('settings.close'), disabled: aboutBusy, onClick: props.onClose }, '×'),
        ),
        note ? e('p', { className: 'warning pad', role: 'alert' }, note) : null,
        e('div', { className: 'settings-pages', tabIndex: 0 },
          builtinPages.map((key) => e(SettingsTabPage, { key, tab: key, active: key === activeTab, fromX }, content[key]())),
          open && activeOfficial && props.renderSlot
            ? e(SettingsTabPage, { key: activeOfficial.navId, tab: activeOfficial.navId, active: true, fromX },
              e(OfficialSettingsSectionPage, {
                renderSlot: props.renderSlot,
                sectionId: activeOfficial.id,
                version: official.version,
                onClose: props.onClose,
              }))
            : null,
        ),
      ),
    ),
  )
}
