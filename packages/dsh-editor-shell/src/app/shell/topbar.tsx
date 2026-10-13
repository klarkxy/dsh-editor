import type { LegacyRef, ReactNode, RefObject } from 'react'
import { IconButton, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../../ui/index.ts'
import { ChevronDownIcon, FocusIcon, PanelLeftIcon, PanelRightIcon } from '../../ui/icons.tsx'
import { t, useLocale } from '../../i18n/index.ts'
import { documentName } from '../../client/shared.ts'
import type { WorkspaceId, WorkspaceView } from '../../dsh-compat.ts'
import { PluginsTrigger, SettingsTrigger } from '../../client/settings.tsx'
import { CommandPaletteTrigger } from '../../client/command-palette.tsx'
import { documentDirectory } from '../../project-files.ts'
import { titleBarDoubleClick } from '../../model/window-controls.ts'

/*
 * 顶栏（spec §2.1）：左区文件开关＋作品菜单＋位置面包屑；中区搜索与命令
 * 触发器；右区扩展坞、设置、专注与辅助栏开关。主题切换移去命令面板。
 * 作品菜单维持原有平铺项与 menuYields 焦点让位约定（对话框打开时不抢焦）。
 */
export function Topbar(props: {
  currentWorkspace?: WorkspaceView
  workspaces: readonly WorkspaceView[]
  openingWorkspace: boolean
  newProjectBusy: boolean
  exporting: boolean
  onSwitchWorkspace(workspaceId: WorkspaceId): void
  onOpenAnotherWorkspace(): void
  onNewProject(): void
  onExportDocuments(): void
  onLeaveHome(): void
  workspaceMenuOpen: boolean
  onWorkspaceMenuOpenChange(open: boolean): void
  onWorkspaceMenuYield(): void
  menuTriggerRef: RefObject<HTMLButtonElement | null>
  menuYieldsRef: { current: boolean }
  /* 面包屑：当前文档目录分段与标题；兄弟文档列表给「切换章节」。 */
  breadcrumb: { path: string; siblings: string[] } | null
  onOpenDocument(path: string): void
  filesVisible: boolean
  auxVisible: boolean
  focus: boolean
  onToggleFiles(): void
  onToggleAux(): void
  onToggleFocus(): void
  onOpenPalette(): void
  extensionsDock?: ReactNode
  windowControls?: ReactNode
  onOpenSettings(): void
  onOpenPlugins(): void
}) {
  useLocale()
  const { breadcrumb } = props
  const currentWorkspace = props.currentWorkspace
  const workspaceTitle = currentWorkspace?.title || currentWorkspace?.path || t('workspace.work')
  const segments = breadcrumb ? breadcrumbSegments(breadcrumb.path) : null
  return (
    <header className="dsh-topbar" role="banner" data-testid="dsh-shell-topbar" onDoubleClick={titleBarDoubleClick}>
      <div className="dsh-topbar__group dsh-topbar__group--left">
        <Menu open={props.workspaceMenuOpen} onOpenChange={props.onWorkspaceMenuOpenChange}>
          <MenuTrigger>
            <button
              type="button"
              ref={props.menuTriggerRef as LegacyRef<HTMLButtonElement>}
              className="workspace-menu-trigger"
              aria-label={t('workspace.menu')}
              aria-haspopup="menu"
              aria-expanded={props.workspaceMenuOpen}
              title={workspaceTitle}
              data-testid="dsh-shell-workspace-menu">
              <span className="workspace-name">{workspaceTitle}</span>
              <ChevronDownIcon size="sm" />
            </button>
          </MenuTrigger>
          <MenuContent
            aria-label={t('workspace.actions')}
            align="start"
            onCloseAutoFocus={(event: Event) => {
              if (props.menuYieldsRef.current) event.preventDefault()
            }}>
            {props.workspaces.map((workspace) => (
              <MenuItem
                key={workspace.workspaceId}
                checked={workspace.workspaceId === currentWorkspace?.workspaceId}
                disabled={props.openingWorkspace}
                onSelect={() => props.onSwitchWorkspace(workspace.workspaceId)}>
                {workspace.title || workspace.path}
              </MenuItem>
            ))}
            {props.workspaces.length ? <MenuSeparator /> : null}
            <MenuItem
              disabled={props.openingWorkspace || props.newProjectBusy}
              onSelect={() => { props.onWorkspaceMenuYield(); props.onOpenAnotherWorkspace() }}>
              {t('command.openWork')}
            </MenuItem>
            <MenuItem
              disabled={props.openingWorkspace || props.newProjectBusy}
              onSelect={() => { props.onWorkspaceMenuYield(); props.onNewProject() }}>
              {t('command.newWork')}
            </MenuItem>
            <MenuItem
              disabled={props.exporting}
              onSelect={() => { props.onWorkspaceMenuYield(); props.onExportDocuments() }}>
              {props.exporting ? t('workspace.exporting') : t('command.export')}
            </MenuItem>
            <MenuSeparator />
            <MenuItem onSelect={() => props.onLeaveHome()}>{t('workspace.backHome')}</MenuItem>
          </MenuContent>
        </Menu>
        {segments ? (
          <nav className="dsh-breadcrumb" aria-label={t('aux.breadcrumb')} data-testid="dsh-shell-breadcrumb">
            {segments.dirs.map((dir) => (
              <span key={dir} className="dsh-breadcrumb__seg">{dir}<span className="dsh-breadcrumb__sep" aria-hidden="true"> / </span></span>
            ))}
            {breadcrumb && breadcrumb.siblings.length > 1 ? (
              <Menu modal={false}>
                <MenuTrigger>
                  <button
                    type="button"
                    className="dsh-breadcrumb__current"
                    aria-haspopup="menu"
                    data-testid="dsh-shell-chapter-switch">
                    {segments.title}
                    <ChevronDownIcon size="sm" />
                  </button>
                </MenuTrigger>
                <MenuContent aria-label={t('aux.chapterSwitch')}>
                  {breadcrumb.siblings.map((sibling) => (
                    <MenuItem key={sibling} checked={sibling === breadcrumb.path} onSelect={() => props.onOpenDocument(sibling)}>
                      {documentName(sibling)}
                    </MenuItem>
                  ))}
                </MenuContent>
              </Menu>
            ) : (
              <span className="dsh-breadcrumb__seg dsh-breadcrumb__current-text" data-testid="dsh-shell-chapter">{segments.title}</span>
            )}
          </nav>
        ) : null}
      </div>
      <div className="dsh-topbar__drag" aria-hidden="true" />
      <div className="dsh-topbar__group dsh-topbar__group--right">
        <IconButton
          label={props.filesVisible ? t('workspace.hideFiles') : t('workspace.showFiles')}
          pressed={props.filesVisible}
          onClick={props.onToggleFiles}
          data-testid="dsh-shell-files-toggle">
          <PanelLeftIcon />
        </IconButton>
        <IconButton
          label={props.focus ? t('workspace.exitFocusShort') : t('workspace.enterFocus')}
          pressed={props.focus}
          onClick={props.onToggleFocus}
          data-testid="dsh-shell-focus-toggle">
          <FocusIcon />
        </IconButton>
        <IconButton
          label={props.auxVisible ? t('workspace.hideAssistant') : t('workspace.showAssistant')}
          pressed={props.auxVisible}
          onClick={props.onToggleAux}
          data-testid="dsh-shell-aux-toggle">
          <PanelRightIcon />
        </IconButton>
        <span data-testid="dsh-shell-palette">
          <CommandPaletteTrigger onClick={props.onOpenPalette} />
        </span>
        {props.extensionsDock}
        <PluginsTrigger onOpen={props.onOpenPlugins} />
        <SettingsTrigger onOpen={props.onOpenSettings} />
        {props.windowControls}
      </div>
    </header>
  )
}

function breadcrumbSegments(path: string): { dirs: string[]; title: string } {
  const dir = documentDirectory(path)
  return {
    dirs: dir ? dir.split('/').filter(Boolean) : [],
    title: documentName(path),
  }
}
