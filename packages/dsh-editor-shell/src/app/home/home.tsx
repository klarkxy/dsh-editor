import { useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import type { WorkspaceView } from '../../dsh-compat.ts'
import type { WorkspaceOpenState } from '../../client/shared.ts'
import { startupResumeWorkspace } from '../../client/shared.ts'
import { t, useLocale } from '../../i18n/index.ts'
import { formatRecentTime } from '../../home-stage.ts'
import {
  readHomeResumeMap,
  recentWorkRowMeta,
  type HomeResumeDoc,
} from '../../model/home-resume.ts'
import { AppBrandMark, DotsIcon } from '../../client/icons.tsx'
import { CommandPaletteTrigger } from '../../client/command-palette.tsx'
import { PluginsTrigger, SettingsTrigger } from '../../client/settings.tsx'
import type { SettingsTab } from '../../model/settings.ts'
import { WindowControls } from '../../client/window-controls.tsx'
import { titleBarDoubleClick } from '../../model/window-controls.ts'
import { ActivityRing, ActivityShimmer, ActivityText } from '../../client/ui/index.ts'
import {
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Notice,
} from '../../ui/index.ts'
import './home.styles.ts'

function HomeChrome(props: {
  extensionsDock?: ReactNode
  onOpenPalette(): void
  onOpenSettings(tab?: SettingsTab): void
  onOpenPlugins(): void
}) {
  return (
    <header className="chrome" role="banner" onDoubleClick={titleBarDoubleClick}>
      <div className="chrome-main">
        <div className="brand-lockup">
          <AppBrandMark size={22} />
          <span className="brand-lockup__name">DSH Editor</span>
        </div>
        {props.extensionsDock}
      </div>
      <div className="topbar-actions">
        <CommandPaletteTrigger onClick={props.onOpenPalette} />
        <PluginsTrigger onOpen={props.onOpenPlugins} />
        <SettingsTrigger onOpen={props.onOpenSettings} />
      </div>
      <WindowControls />
    </header>
  )
}

/* §6：作品行右键菜单沿用文件树的锚点式 Menu——隐藏触发器定位到右键坐标，
   面板夹进取视口内。 */
function RecentRowMenu(props: {
  x: number
  y: number
  needsRelocation: boolean
  onOpen(): void
  onRelocate(): void
  onRemove(): void
  onClose(): void
}) {
  const left = Math.max(8, Math.min(props.x, globalThis.innerWidth - 220))
  const top = Math.max(8, Math.min(props.y, globalThis.innerHeight - 200))
  return (
    <div
      style={{ position: 'fixed', left, top, width: 0, height: 0 }}
      onContextMenu={(event: ReactMouseEvent<HTMLDivElement>) => event.preventDefault()}>
      <Menu open={true} onOpenChange={(open: boolean) => { if (!open) props.onClose() }}>
        <MenuTrigger>
          <button type="button" className="dsh-home-row__menu-anchor" tabIndex={-1} aria-hidden="true" />
        </MenuTrigger>
        <MenuContent align="start" side="bottom" sideOffset={0} aria-label={t('home.rowMenu')}>
          <MenuItem onSelect={props.onOpen}>{t('common.open')}</MenuItem>
          {props.needsRelocation
            ? <MenuItem onSelect={props.onRelocate}>{t('home.relocate')}</MenuItem>
            : null}
          <MenuSeparator />
          <MenuItem tone="danger" onSelect={props.onRemove}>{t('home.removeRecent')}</MenuItem>
        </MenuContent>
      </Menu>
    </div>
  )
}

function RecentRow(props: {
  workspace: WorkspaceView
  resume: HomeResumeDoc | undefined
  needsRelocation: boolean
  relocationMessage?: string
  disabled: boolean
  onOpen(): void
  onRelocate(): void
  onRemove(): void
}) {
  const { workspace } = props
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  const { lineInfo, meta } = recentWorkRowMeta(workspace, props.resume, formatRecentTime)
  return (
    <li className={`dsh-home-row${props.needsRelocation ? ' needs-relocation' : ''}`}>
      <button
        type="button"
        className="dsh-home-row__main"
        title={workspace.path}
        disabled={props.disabled}
        onClick={props.onOpen}
        onContextMenu={(event: ReactMouseEvent<HTMLButtonElement>) => {
          event.preventDefault()
          setMenuAt({ x: event.clientX, y: event.clientY })
        }}>
        <span className="dsh-home-row__line1">
          <span className="dsh-home-row__title">{workspace.title || workspace.path}</span>
          {lineInfo ? <>
            <span className="dsh-home-row__leader" aria-hidden="true" />
            <span className="dsh-home-row__info">{lineInfo}</span>
          </> : null}
        </span>
        {meta.length ? <span className="dsh-home-row__line2">
          {meta.map((item, index) => <span key={index} className="dsh-home-row__meta">{item}</span>)}
        </span> : null}
      </button>
      <IconButton
        className="dsh-home-row__manage"
        label={t('home.rowMenu')}
        size="sm"
        disabled={props.disabled}
        onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
          const rect = event.currentTarget.getBoundingClientRect()
          setMenuAt({ x: rect.left, y: rect.bottom })
        }}>
        <DotsIcon size={14} />
      </IconButton>
      {menuAt ? <RecentRowMenu
        x={menuAt.x}
        y={menuAt.y}
        needsRelocation={props.needsRelocation}
        onOpen={props.onOpen}
        onRelocate={props.onRelocate}
        onRemove={props.onRemove}
        onClose={() => setMenuAt(null)} /> : null}
      {props.needsRelocation ? <Notice className="dsh-home-row__relocation" tone="danger" title={props.relocationMessage}>
        <code>{workspace.path}</code>
        <span className="dsh-home-row__relocation-actions">
          <Button size="sm" disabled={props.disabled} onClick={props.onRelocate}>
            {t('home.relocate')}
          </Button>
          <Button size="sm" variant="ghost" disabled={props.disabled} onClick={props.onRemove}>
            {t('home.removeRecent')}
          </Button>
        </span>
      </Notice> : null}
    </li>
  )
}

export function HomeScreen(props: {
  workspaceOpen: WorkspaceOpenState
  extensionsDock?: ReactNode
  openingWorkspace: boolean
  newProjectBusy: boolean
  onOpenWork(): void
  onNewProject(): void
  pathFallbackForm: ReactNode
  onContinueIntent(): void
  onCancelIntent(): void
  homeNote: string
  workspaces: readonly WorkspaceView[]
  onOpenWorkspace(workspace: WorkspaceView, preferredPath?: string): void
  onRelocate(workspace: WorkspaceView): void
  removeRecentTarget: WorkspaceView | null
  onRequestRemoveRecent(workspace: WorkspaceView): void
  onCancelRemoveRecent(): void
  onConfirmRemoveRecent(): void
  dialogs: ReactNode
  onOpenPalette(): void
  onOpenSettings(tab?: SettingsTab): void
  onOpenPlugins(): void
}) {
  const { workspaceOpen, extensionsDock } = props
  useLocale()
  /* 上次位置记录很小，直接每次渲染读 localStorage：离开编辑器写一条后回到
     首页时 workspaces 引用未必变，memo 会让继续块拿到旧数据。 */
  const resumeMap = readHomeResumeMap()
  const latest = startupResumeWorkspace(props.workspaces)
  const latestResume = latest ? resumeMap[latest.workspaceId] : undefined
  const busy = props.openingWorkspace || props.newProjectBusy
  if (workspaceOpen.kind === 'checking') {
    return (
      <main className="shell no-session" style={{ minWidth: 0, display: 'grid' }}>
        <HomeChrome
          extensionsDock={extensionsDock}
          onOpenPalette={props.onOpenPalette}
          onOpenSettings={props.onOpenSettings}
          onOpenPlugins={props.onOpenPlugins} />
        <div className="workspace-checking" role="status" aria-label={t('home.verifying')}>
          <ActivityRing size={40} />
          <div className="workspace-checking__title">{t('home.checking')}</div>
          <ActivityText cue="none">
            {t('home.checkingDetail')}
          </ActivityText>
          <ActivityShimmer />
          <code className="workspace-checking__path">{workspaceOpen.path}</code>
        </div>
      </main>
    );
  }

  return (
    <main className="shell no-session" style={{ minWidth: 0, display: 'grid' }}>
      <HomeChrome
        extensionsDock={extensionsDock}
        onOpenPalette={props.onOpenPalette}
        onOpenSettings={props.onOpenSettings}
        onOpenPlugins={props.onOpenPlugins} />
      <div className="empty-paper home-stage dsh-home" role="region" aria-label={t('home.title')}>
        <div className="dsh-home__inner">
          <header className="dsh-home__head">
            <h1 className="dsh-home__title">{t('home.recent')}</h1>
            {props.workspaces.length ? <div className="dsh-home__actions">
              <Button variant="secondary" disabled={busy} onClick={() => void props.onOpenWork()}>
                {t('home.openWork')}
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => void props.onNewProject()}>
                {t('home.newWork')}
              </Button>
            </div> : null}
          </header>
          {latest ? <section className="dsh-home-continue" aria-label={t('home.continueWriting')}>
            <div className="dsh-home-continue__text">
              <span className="dsh-home-continue__label">{t('home.continueWriting')}</span>
              <h2 className="dsh-home-continue__title">{latest.title || latest.path}</h2>
              {latestResume ? <div className="dsh-home-continue__meta">
                <span className="dsh-home-continue__chapter">{latestResume.title}</span>
                {latestResume.excerpt ? <span className="dsh-home-continue__excerpt">{latestResume.excerpt}</span> : null}
              </div> : null}
            </div>
            <Button
              className="dsh-home-continue__action"
              disabled={busy}
              onClick={() => props.onOpenWorkspace(latest, latestResume?.path)}>
              {t('home.continue')}
            </Button>
          </section> : null}
          {props.pathFallbackForm}
          {workspaceOpen.kind === 'needs-intent' ? <Notice tone="warning" className="dsh-home__intent" title={workspaceOpen.intent === 'create' ? t('home.folderNotWork') : t('home.folderHasWork')}>
            {workspaceOpen.message}
            <code>{workspaceOpen.path}</code>
            <span className="dsh-home__intent-actions">
              <Button size="sm" disabled={props.openingWorkspace} onClick={() => void props.onContinueIntent()}>
                {workspaceOpen.intent === 'create' ? t('home.createHere') : t('home.openInstead')}
              </Button>
              <Button size="sm" variant="ghost" disabled={props.openingWorkspace} onClick={() => void props.onCancelIntent()}>
                {t('common.cancel')}
              </Button>
            </span>
          </Notice> : null}
          {workspaceOpen.kind === 'error' ? <code className="dsh-home__error-path">{workspaceOpen.path}</code> : null}
          {props.homeNote ? <Notice tone="danger">{props.homeNote}</Notice> : null}
          <section className="home-recent" aria-label={t('home.recent')}>
            {props.workspaces.length ? <ul className="dsh-home__list">
              {props.workspaces.map((workspace) => {
                const needsRelocation = workspaceOpen.kind === 'needs-relocation' && workspaceOpen.workspaceId === workspace.workspaceId
                return (
                  <RecentRow
                    key={workspace.workspaceId}
                    workspace={workspace}
                    resume={resumeMap[workspace.workspaceId]}
                    needsRelocation={needsRelocation}
                    relocationMessage={needsRelocation && workspaceOpen.kind === 'needs-relocation' ? workspaceOpen.message : undefined}
                    disabled={props.openingWorkspace}
                    onOpen={() => void props.onOpenWorkspace(workspace, resumeMap[workspace.workspaceId]?.path)}
                    onRelocate={() => props.onRelocate(workspace)}
                    onRemove={() => props.onRequestRemoveRecent(workspace)} />
                )
              })}
            </ul> : <EmptyState
              className="dsh-home__empty"
              title={t('home.recentEmpty')}
              actions={<>
                <Button disabled={busy} onClick={() => void props.onNewProject()}>
                  {t('home.newWork')}
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => void props.onOpenWork()}>
                  {t('home.openWork')}
                </Button>
              </>} />}
          </section>
        </div>
      </div>
      {props.dialogs}
      <ConfirmDialog
        open={Boolean(props.removeRecentTarget)}
        title={t('home.removeRecent')}
        message={t('home.removeRecentBody', { title: props.removeRecentTarget?.title || props.removeRecentTarget?.path || '' })}
        confirmLabel={t('home.removeRecent')}
        cancelLabel={t('common.cancel')}
        tone="danger"
        onCancel={props.onCancelRemoveRecent}
        onConfirm={() => void props.onConfirmRemoveRecent()} />
    </main>
  );
}
