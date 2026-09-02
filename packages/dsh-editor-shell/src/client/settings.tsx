import { createElement as e, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { ShellContext } from './shared.ts'
import { useDialogReturnFocus } from './dialogs.ts'
import { WritingSettings } from '../writing-settings.ts'
import type { WritingMigration, WritingPreferences } from '../writing-settings.ts'
import { SettingsGeneralSection } from './settings-general.tsx'
import { SettingsModelsSection } from './settings-models.tsx'
import { SettingsZhihuSection } from './settings-zhihu.tsx'
import { SettingsUsageSection } from './settings-usage.tsx'

export type SettingsTab = 'general' | 'models' | 'writing' | 'zhihu' | 'usage'

const TAB_LABEL: Record<SettingsTab, string> = {
  general: '通用设置',
  models: '模型',
  writing: '写作',
  zhihu: '知乎',
  usage: '用量',
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
      '设置',
    ),
  )
}

export function SettingsDialog(props: {
  ctx: ShellContext
  writingScope: SettingsScope<WritingPreferences>
  migrateWriting: WritingMigration
  onClose(): void
}) {
  const [tab, setTab] = useState<SettingsTab>('general')
  const [note, setNote] = useState('')
  const dialog = useRef<HTMLDivElement | null>(null)
  useDialogReturnFocus(dialog, () => dialog.current?.querySelector<HTMLButtonElement>('.settings-close')?.focus())

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // 内部弹层（自制下拉、确认框）已经处理过的 Escape 不再关闭整个设置弹窗。
    if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); props.onClose() }
  }
  // 遮罩点击关闭：只有点中遮罩本身（而非面板内）才关。
  const onOverlayMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) props.onClose()
  }

  const openConfigFile = async () => {
    setNote('')
    try {
      const response = await props.ctx.connection.api.settings.openDocument({})
      if (!response.result.ok) setNote(`打开配置文件失败：${response.result.error.message}`)
    } catch (error) {
      setNote(`打开配置文件失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const tabs = (Object.keys(TAB_LABEL) as SettingsTab[])
  const content: Record<SettingsTab, () => ReactNode> = {
    general: () => e(SettingsGeneralSection, { ctx: props.ctx }),
    models: () => e(SettingsModelsSection, { ctx: props.ctx }),
    writing: () => e(WritingSettings, { scope: props.writingScope, migrate: props.migrateWriting }),
    zhihu: () => e(SettingsZhihuSection, { ctx: props.ctx }),
    usage: () => e(SettingsUsageSection, { ctx: props.ctx }),
  }

  return e('div', { className: 'file-dialog-overlay settings-overlay', onMouseDown: onOverlayMouseDown },
    e('div', {
      ref: dialog,
      className: 'file-dialog settings-dialog',
      role: 'dialog',
      'aria-modal': true,
      'aria-labelledby': 'settings-dialog-title',
      onKeyDown,
    },
      e('aside', { className: 'settings-nav' },
        e('h2', { id: 'settings-dialog-title' }, '设置'),
        e('nav', { 'aria-label': '设置分类' },
          tabs.map((key) => e('button', {
            key,
            type: 'button',
            className: `settings-tab${tab === key ? ' active' : ''}`,
            'aria-current': tab === key,
            onClick: () => setTab(key),
          }, TAB_LABEL[key])),
        ),
      ),
      e('div', { className: 'settings-body' },
        e('header', { className: 'settings-header' },
          e('span', { className: 'settings-header-title' }, TAB_LABEL[tab]),
          props.ctx.connection.isLoopback ? e('button', { type: 'button', className: 'settings-open-config', onClick: () => void openConfigFile() }, '打开配置文件') : null,
          e('button', { type: 'button', className: 'icon-button settings-close', 'aria-label': '关闭设置', onClick: props.onClose }, '×'),
        ),
        note ? e('p', { className: 'warning pad', role: 'alert' }, note) : null,
        e('div', { className: 'settings-content' }, content[tab]()),
      ),
    ),
  )
}
