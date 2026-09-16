import type { ReactNode, RefObject } from 'react'
import type { WorkspaceId, WorkspaceView } from '../dsh-compat.ts'
import { t } from '../i18n/index.ts'
import { DeepSeekWhaleMark } from './components.tsx'
import { FolderIcon, FocusIcon } from './icons.tsx'
import { CommandPaletteTrigger } from './command-palette.tsx'
import { SettingsTrigger, type SettingsTab } from './settings.tsx'
import { ThemeToggle, type ThemeValue } from './theme.tsx'
import { titleBarDoubleClick, WindowControls } from './window-controls.tsx'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Tooltip, m, useChromeMotion } from './ui/index.ts'

/* 工作台顶栏：作品菜单(切换/新建/导出/归档/返回首页)、布局开关(侧栏/专注/搭档)、
   主题/命令面板/设置/窗口控制。全部状态由 Root 持有,这里只做呈现。 */
export function WorkbenchTopbar(props: {
  workspaceChromeMotion: ReturnType<typeof useChromeMotion>
  workspaceMenuOpen: boolean
  onWorkspaceMenuOpenChange(open: boolean): void
  onWorkspaceMenuYield(): void
  menuTriggerRef: RefObject<HTMLButtonElement | null>
  menuYieldsRef: RefObject<boolean>
  currentWorkspace: WorkspaceView | undefined
  workspaces: readonly WorkspaceView[]
  openingWorkspace: boolean
  newProjectBusy: boolean
  exporting: boolean
  onSwitchWorkspace(workspaceId: WorkspaceId): void
  onOpenAnotherWorkspace(): void
  onNewProject(): void
  onExportDocuments(): void
  onOpenArchive(): void
  onLeaveHome(): void
  sidebarOpen: boolean
  compactChrome: boolean
  focusMode: boolean
  assistantOpen: boolean
  onToggleSidebar(): void
  onToggleFocusMode(): void
  onToggleAssistant(): void
  extensionsDock?: ReactNode
  theme: ThemeValue
  onThemeChange(theme: ThemeValue): void
  onOpenPalette(): void
  onOpenSettings(tab?: SettingsTab): void
}) {
  const currentWorkspace = props.currentWorkspace
  return (
    <header className="chrome" onDoubleClick={titleBarDoubleClick}>
      <m.div
        className="workspace-chrome"
        role="group"
        aria-label={t('workspace.work')}
        {...props.workspaceChromeMotion}>
        <div className="workspace-menu">
          <Menu
            open={props.workspaceMenuOpen}
            onOpenChange={props.onWorkspaceMenuOpenChange}>
            <MenuTrigger
              ref={props.menuTriggerRef as RefObject<HTMLButtonElement>}
              className="workspace-menu-trigger"
              title={currentWorkspace?.title || currentWorkspace?.path || t('workspace.work')}
              aria-label={t('workspace.menu')}
              aria-controls="workspace-actions">
              <span>
                {currentWorkspace?.title || currentWorkspace?.path || t('workspace.work')}
              </span>
            </MenuTrigger>
            <MenuContent
              id="workspace-actions"
              className="workspace-menu-panel"
              aria-label={t('workspace.actions')}
              align="start"
              onCloseAutoFocus={(event: Event) => {
                if (props.menuYieldsRef.current) event.preventDefault()
              }}>
              {props.workspaces.length ? <span className="sr-only">
                {t('workspace.switch')}
              </span> : null}
              {props.workspaces.length ? props.workspaces.map((workspace) => <MenuItem
                key={workspace.workspaceId}
                className="workspace-menu-item"
                aria-current={workspace.workspaceId === currentWorkspace?.workspaceId ? 'true' : undefined}
                disabled={props.openingWorkspace}
                onSelect={() => { void props.onSwitchWorkspace(workspace.workspaceId) }}>
                {workspace.title || workspace.path}
              </MenuItem>) : null}
              {props.workspaces.length ? <MenuSeparator className="workspace-menu-divider" aria-hidden="true" /> : null}
              <MenuItem
                className="workspace-menu-item"
                disabled={props.openingWorkspace || props.newProjectBusy}
                onSelect={() => { props.onWorkspaceMenuYield(); void props.onOpenAnotherWorkspace() }}>
                {t('home.openWork')}
              </MenuItem>
              <MenuItem
                className="workspace-menu-item"
                disabled={props.openingWorkspace || props.newProjectBusy}
                onSelect={() => { props.onWorkspaceMenuYield(); void props.onNewProject() }}>
                {t('home.new')}
              </MenuItem>
              <MenuItem
                className="workspace-menu-item"
                disabled={props.exporting}
                onSelect={() => { props.onWorkspaceMenuYield(); void props.onExportDocuments() }}>
                {props.exporting ? t('workspace.exporting') : t('command.export')}
              </MenuItem>
              <MenuItem
                className="workspace-menu-item"
                onSelect={() => { props.onWorkspaceMenuYield(); props.onOpenArchive() }}>
                {t('workspace.archived')}
              </MenuItem>
              <MenuItem
                className="workspace-menu-item"
                aria-label={t('workspace.backHome')}
                onSelect={() => { void props.onLeaveHome() }}>
                {t('workspace.backHome')}
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>
      </m.div>
      <nav className="layout-controls" aria-label={t('workspace.layout')}>
        <Tooltip
          content={props.sidebarOpen ? t('workspace.hideFiles') : t('workspace.showFiles')}
          children={<button
            type="button"
            disabled={props.focusMode || props.compactChrome}
            aria-pressed={props.sidebarOpen && !props.compactChrome}
            aria-label={t('workspace.files')}
            title={props.sidebarOpen ? t('workspace.hideFiles') : t('workspace.showFiles')}
            onClick={props.onToggleSidebar}>
            {<FolderIcon size={16} />}
          </button>} />
        <Tooltip
          content={props.focusMode ? t('workspace.exitFocus') : t('workspace.enterFocus')}
          children={<button
            type="button"
            aria-pressed={props.focusMode}
            aria-label={props.focusMode ? t('workspace.exitFocusShort') : t('workspace.focus')}
            title={props.focusMode ? t('workspace.exitFocus') : t('workspace.enterFocus')}
            onClick={props.onToggleFocusMode}>
            {<FocusIcon size={16} />}
          </button>} />
        <Tooltip
          content={props.assistantOpen ? t('workspace.hideAssistant') : t('workspace.showAssistant')}
          children={<button
            type="button"
            disabled={props.focusMode}
            aria-pressed={props.assistantOpen}
            aria-label={t('workspace.assistant')}
            title={props.assistantOpen ? t('workspace.hideAssistant') : t('workspace.showAssistant')}
            onClick={props.onToggleAssistant}>
            {<DeepSeekWhaleMark />}
          </button>} />
      </nav>
      {props.extensionsDock}
      <div className="topbar-actions">
        <ThemeToggle theme={props.theme} onChange={props.onThemeChange} />
        <CommandPaletteTrigger onClick={props.onOpenPalette} />
        <SettingsTrigger onOpen={props.onOpenSettings} />
        <WindowControls />
      </div>
    </header>
  );
}
