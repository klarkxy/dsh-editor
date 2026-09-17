import type { ReactNode, RefObject } from 'react'
import { Button, DropdownMenu, Flex, IconButton, Text } from '@radix-ui/themes'
import type { WorkspaceId, WorkspaceView } from '../dsh-compat.ts'
import { t } from '../i18n/index.ts'
import { DeepSeekWhaleMark } from './components.tsx'
import { FolderIcon, FocusIcon } from './icons.tsx'
import { CommandPaletteTrigger } from './command-palette.tsx'
import { SettingsTrigger, type SettingsTab } from './settings.tsx'
import { ThemeToggle, type ThemeValue } from './theme.tsx'
import { titleBarDoubleClick, WindowControls } from './window-controls.tsx'
import { DOCUMENT_ARCHIVE_UI } from './archive.tsx'
import { Menu, MenuContent, MenuItem, MenuSeparator, Tooltip, m, useChromeMotion } from './ui/index.ts'

function LayoutToggle(props: {
  pressed: boolean
  disabled?: boolean
  label: string
  tooltip: string
  onClick(): void
  children: ReactNode
}) {
  return (
    <Tooltip
      content={props.tooltip}
      children={<IconButton
        type="button"
        variant={props.pressed ? 'soft' : 'ghost'}
        color={props.pressed ? undefined : 'gray'}
        size="2"
        disabled={props.disabled}
        aria-pressed={props.pressed}
        aria-label={props.label}
        title={props.tooltip}
        onClick={props.onClick}>
        {props.children}
      </IconButton>} />
  )
}

/* 工作台顶栏：作品菜单(切换/新建/导出/返回首页)、布局开关(侧栏/专注/搭档)、
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
  const workspaceTitle = currentWorkspace?.title || currentWorkspace?.path || t('workspace.work')
  return (
    <Flex
      className="chrome"
      role="banner"
      align="center"
      gap="0"
      pl="3"
      width="100%"
      minWidth="0"
      onDoubleClick={titleBarDoubleClick}>
      <Flex className="chrome-main" align="center" gap="2" minWidth="0" flexGrow="1">
        <m.div
          className="workspace-chrome"
          role="group"
          aria-label={t('workspace.work')}
          style={{ display: 'flex', alignItems: 'center', width: 'auto', minWidth: '8.5rem', maxWidth: '16rem' }}
          {...props.workspaceChromeMotion}>
        <div className="workspace-menu">
          <Menu
            open={props.workspaceMenuOpen}
            onOpenChange={props.onWorkspaceMenuOpenChange}>
            <DropdownMenu.Trigger>
              <Button
                ref={props.menuTriggerRef as RefObject<HTMLButtonElement>}
                className="workspace-menu-trigger"
                variant="soft"
                color="gray"
                size="2"
                title={workspaceTitle}
                aria-label={t('workspace.menu')}
                aria-controls="workspace-actions"
                style={{
                  width: 'auto',
                  minWidth: '8.5rem',
                  maxWidth: '16rem',
                  height: 'var(--control-h)',
                  justifyContent: 'flex-start',
                  gap: 'var(--space-2)',
                }}>
                <Text size="2" weight="medium" truncate>
                  {workspaceTitle}
                </Text>
                <DropdownMenu.TriggerIcon />
              </Button>
            </DropdownMenu.Trigger>
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
              {DOCUMENT_ARCHIVE_UI ? <MenuItem
                className="workspace-menu-item"
                onSelect={() => { props.onWorkspaceMenuYield(); props.onOpenArchive() }}>
                {t('workspace.archived')}
              </MenuItem> : null}
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
      <Flex
        className="layout-controls"
        role="navigation"
        aria-label={t('workspace.layout')}
        align="center"
        gap="1"
        flexShrink="0">
        <LayoutToggle
          pressed={props.sidebarOpen && !props.compactChrome}
          disabled={props.focusMode || props.compactChrome}
          label={t('workspace.files')}
          tooltip={props.sidebarOpen ? t('workspace.hideFiles') : t('workspace.showFiles')}
          onClick={props.onToggleSidebar}>
          <FolderIcon size={16} />
        </LayoutToggle>
        <LayoutToggle
          pressed={props.focusMode}
          label={props.focusMode ? t('workspace.exitFocusShort') : t('workspace.focus')}
          tooltip={props.focusMode ? t('workspace.exitFocus') : t('workspace.enterFocus')}
          onClick={props.onToggleFocusMode}>
          <FocusIcon size={16} />
        </LayoutToggle>
        <LayoutToggle
          pressed={props.assistantOpen && !props.compactChrome}
          disabled={props.focusMode || props.compactChrome}
          label={t('workspace.assistant')}
          tooltip={props.assistantOpen ? t('workspace.hideAssistant') : t('workspace.showAssistant')}
          onClick={props.onToggleAssistant}>
          <DeepSeekWhaleMark />
        </LayoutToggle>
      </Flex>
      {props.extensionsDock}
      </Flex>
      <Flex className="topbar-actions" align="center" gap="2" flexShrink="0">
        <ThemeToggle theme={props.theme} onChange={props.onThemeChange} />
        <CommandPaletteTrigger onClick={props.onOpenPalette} />
        <SettingsTrigger onOpen={props.onOpenSettings} />
      </Flex>
      <WindowControls />
    </Flex>
  );
}
