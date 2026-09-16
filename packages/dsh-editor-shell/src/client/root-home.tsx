import type { ReactNode } from 'react'
import type { WorkspaceView } from '../dsh-compat.ts'
import type { WorkspaceOpenState } from './shared.ts'
import { t } from '../i18n/index.ts'
import { PaperStage } from './components.tsx'
import { FolderIcon, NewDocIcon } from './icons.tsx'
import { CommandPaletteTrigger } from './command-palette.tsx'
import { SettingsTrigger, type SettingsTab } from './settings.tsx'
import { titleBarDoubleClick, WindowControls } from './window-controls.tsx'
import { ActivityRing, ActivityShimmer, ActivityText, m, useChromeMotion } from './ui/index.ts'
import { ConfirmDialog } from './dialogs.tsx'

/* 把 WorkspaceView.updatedAt(ISO-8601)格式化为首页最近作品区使用的简短时间标签:
   60 秒内=刚刚,1 小时内=分钟前,今天=小时前,昨天,7 天内=天数前,
   更早用 M月D日(同年)或 YYYY/MM/DD(跨年)。失败时退回到空串,DOM 仍能挂上小标签。 */
function formatRecentTime(iso: string | undefined, now: Date = new Date()): string {
  if (!iso) return ''
  const stamp = Date.parse(iso)
  if (!Number.isFinite(stamp)) return ''
  const diff = Math.max(0, now.getTime() - stamp)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return t('time.justNow')
  if (diff < hour) return t('time.minutesAgo', { count: Math.floor(diff / minute) })
  if (diff < day && now.getDate() === new Date(stamp).getDate()) return t('time.hoursAgo', { count: Math.floor(diff / hour) })
  const stampDate = new Date(stamp)
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (stampDate.getFullYear() === yesterday.getFullYear() && stampDate.getMonth() === yesterday.getMonth() && stampDate.getDate() === yesterday.getDate()) return t('time.yesterday')
  if (diff < 7 * day) return t('time.daysAgo', { count: Math.floor(diff / day) })
  const yyyy = stampDate.getFullYear()
  const mm = String(stampDate.getMonth() + 1).padStart(2, '0')
  const dd = String(stampDate.getDate()).padStart(2, '0')
  if (yyyy === now.getFullYear()) return t('time.monthDay', { date: `${stampDate.getMonth() + 1}月${stampDate.getDate()}日` })
  return `${yyyy}/${mm}/${dd}`
}

export function HomeScreen(props: {
  workspaceOpen: WorkspaceOpenState
  extensionsDock?: ReactNode
  openingWorkspace: boolean
  newProjectBusy: boolean
  onOpenWork(): void
  onNewProject(): void
  homeCardOpen: ReturnType<typeof useChromeMotion>
  homeCardNew: ReturnType<typeof useChromeMotion>
  pathFallbackForm: ReactNode
  onContinueIntent(): void
  onCancelIntent(): void
  homeNote: string
  workspaces: readonly WorkspaceView[]
  onOpenWorkspace(workspace: WorkspaceView): void
  onRelocate(workspace: WorkspaceView): void
  removeRecentTarget: WorkspaceView | null
  onRequestRemoveRecent(workspace: WorkspaceView): void
  onCancelRemoveRecent(): void
  onConfirmRemoveRecent(): void
  dialogs: ReactNode
  settingsDialog: ReactNode
  onOpenPalette(): void
  onOpenSettings(tab?: SettingsTab): void
}) {
  const { workspaceOpen, extensionsDock } = props
  if (workspaceOpen.kind === 'checking') {
    return (
      <main className="shell no-session" style={{ minWidth: 0, display: 'grid' }}>
        <section className="workspace-checking" aria-label={t('home.verifying')}>
          <ActivityRing size={40} />
          <h1>
            {t('home.checking')}
          </h1>
          <ActivityText cue="none">
            {t('home.checkingDetail')}
          </ActivityText>
          <ActivityShimmer />
          <code>
            {workspaceOpen.path}
          </code>
        </section>
        {extensionsDock}
      </main>
    );
  }

  return (
    <main className="shell no-session" style={{ minWidth: 0, display: 'grid' }}>
      <header className="chrome" onDoubleClick={titleBarDoubleClick}>
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            D
          </span>
          <strong>
            DSH Editor
          </strong>
        </div>
        {extensionsDock}
        <span className="topbar-actions">
          <CommandPaletteTrigger onClick={props.onOpenPalette} />
          <SettingsTrigger onOpen={props.onOpenSettings} />
          <WindowControls />
        </span>
      </header>
      <PaperStage label={t('home.blankPaper')}>
        <div
          className="home-actions home-command-bar"
          role="group"
          aria-label={t('home.commands')}>
          <m.button
            className="home-entry-card"
            type="button"
            aria-label={t('home.openWork')}
            disabled={props.openingWorkspace || props.newProjectBusy}
            onClick={() => void props.onOpenWork()}
            {...props.homeCardOpen}>
            <span className="home-entry-icon" aria-hidden="true">
              <FolderIcon size={20} />
            </span>
            <span className="home-entry-title">
              {t('home.openWork')}
            </span>
          </m.button>
          <m.button
            className="home-entry-card"
            type="button"
            aria-label={t('home.new')}
            disabled={props.openingWorkspace || props.newProjectBusy}
            onClick={() => void props.onNewProject()}
            {...props.homeCardNew}>
            <span className="home-entry-icon" aria-hidden="true">
              <NewDocIcon size={20} />
            </span>
            <span className="home-entry-title">
              {t('home.new')}
            </span>
          </m.button>
        </div>
        {props.pathFallbackForm}
        {workspaceOpen.kind === 'needs-intent' ? <section className="workspace-intent-prompt" role="alert">
          <strong>
            {workspaceOpen.intent === 'create' ? t('home.folderNotWork') : t('home.folderHasWork')}
          </strong>
          <p>
            {workspaceOpen.message}
          </p>
          <code>
            {workspaceOpen.path}
          </code>
          <div>
            <button
              className="primary-action"
              type="button"
              disabled={props.openingWorkspace}
              onClick={() => void props.onContinueIntent()}>
              {workspaceOpen.intent === 'create' ? t('home.createHere') : t('home.openInstead')}
            </button>
            <button
              type="button"
              disabled={props.openingWorkspace}
              onClick={() => void props.onCancelIntent()}>
              {t('common.cancel')}
            </button>
          </div>
        </section> : null}
        {workspaceOpen.kind === 'error' ? <code>
          {workspaceOpen.path}
        </code> : null}
        {props.homeNote ? <p className="warning" role="alert">
          {props.homeNote}
        </p> : null}
        <section className="home-recent" aria-label={t('home.recent')}>
          <header>
            <h2>
              {t('home.recent')}
            </h2>
          </header>
          {props.workspaces.length ? <div className="workspace-list">
            {props.workspaces.map((workspace) => {
              const needsRelocation = workspaceOpen.kind === 'needs-relocation' && workspaceOpen.workspaceId === workspace.workspaceId
              const recentLabel = formatRecentTime(workspace.updatedAt)
              return (
                <article
                  className={`workspace-row${needsRelocation ? ' needs-relocation' : ''}`}
                  key={workspace.workspaceId}>
                  <button
                    className="tree-row"
                    type="button"
                    disabled={props.openingWorkspace}
                    onClick={() => void props.onOpenWorkspace(workspace)}>
                    <strong>
                      {workspace.title || workspace.path}
                    </strong>
                    <small>
                      {workspace.path}
                    </small>
                    {recentLabel ? <span
                      className="workspace-time"
                      aria-label={t('home.recentOpened', { label: recentLabel })}>
                      {recentLabel}
                    </span> : null}
                  </button>
                  <button
                    className="workspace-manage icon-button"
                    type="button"
                    disabled={props.openingWorkspace}
                    title={t('home.removeRecent')}
                    aria-label={t('home.removeRecent')}
                    onClick={() => props.onRequestRemoveRecent(workspace)}>
                    ×
                  </button>
                  {needsRelocation ? <div className="workspace-relocation" role="alert">
                    <p>
                      {workspaceOpen.message}
                    </p>
                    <code>
                      {workspaceOpen.path}
                    </code>
                    <button
                      className="primary-action"
                      type="button"
                      disabled={props.openingWorkspace}
                      onClick={() => void props.onRelocate(workspace)}>
                      {t('home.relocate')}
                    </button>
                    <button
                      type="button"
                      disabled={props.openingWorkspace}
                      onClick={() => props.onRequestRemoveRecent(workspace)}>
                      {t('home.removeRecent')}
                    </button>
                  </div> : null}
                </article>
              );
            })}
          </div> : <p className="muted home-recent-empty">
            {t('home.recentEmpty')}
          </p>}
        </section>
      </PaperStage>
      {props.dialogs}
      <ConfirmDialog
        open={Boolean(props.removeRecentTarget)}
        id="remove-recent"
        title={t('home.removeRecent')}
        message={t('home.removeRecentBody', { title: props.removeRecentTarget?.title || props.removeRecentTarget?.path || '' })}
        confirmLabel={t('home.removeRecent')}
        onCancel={props.onCancelRemoveRecent}
        onConfirm={() => void props.onConfirmRemoveRecent()} />
      {props.settingsDialog}
    </main>
  );
}
