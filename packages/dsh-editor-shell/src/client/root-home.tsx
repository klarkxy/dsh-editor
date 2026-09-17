import type { ReactNode } from 'react'
import { Box, Button, Callout, Card, Flex, Heading, IconButton, ScrollArea, Separator, Text } from '@radix-ui/themes'
import type { WorkspaceView } from '../dsh-compat.ts'
import type { WorkspaceOpenState } from './shared.ts'
import { t, useLocale } from '../i18n/index.ts'
import { homeStageCopy } from '../home-stage.ts'
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

function HomeChrome(props: {
  extensionsDock?: ReactNode
  onOpenPalette(): void
  onOpenSettings(tab?: SettingsTab): void
}) {
  return (
    <Flex
      className="chrome"
      role="banner"
      align="center"
      gap="3"
      px="3"
      width="100%"
      minWidth="0"
      onDoubleClick={titleBarDoubleClick}>
      <Flex className="brand-lockup" align="center" gap="2" flexShrink="0">
        <Flex
          className="brand-mark"
          aria-hidden="true"
          align="center"
          justify="center"
          style={{
            width: 22,
            height: 22,
            borderRadius: 'var(--radius-2)',
            background: 'var(--accent-9)',
            color: 'var(--accent-contrast)',
            fontWeight: 700,
            fontSize: 'var(--font-size-1)',
          }}>
          D
        </Flex>
        <Text weight="bold" size="2">
          DSH Editor
        </Text>
      </Flex>
      {props.extensionsDock}
      <Flex className="topbar-actions" align="center" gap="2" flexShrink="0">
        <CommandPaletteTrigger onClick={props.onOpenPalette} />
        <SettingsTrigger onOpen={props.onOpenSettings} />
        <WindowControls />
      </Flex>
    </Flex>
  )
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
  useLocale()
  const homeCopy = homeStageCopy()
  if (workspaceOpen.kind === 'checking') {
    return (
      <main className="shell no-session" style={{ minWidth: 0, display: 'grid' }}>
        <Flex
          className="workspace-checking"
          direction="column"
          align="center"
          justify="center"
          gap="3"
          p="8"
          aria-label={t('home.verifying')}>
          <ActivityRing size={40} />
          <Heading as="h1" size="6">
            {t('home.checking')}
          </Heading>
          <ActivityText cue="none">
            {t('home.checkingDetail')}
          </ActivityText>
          <ActivityShimmer />
          <Text size="1" color="gray">
            <code>
              {workspaceOpen.path}
            </code>
          </Text>
        </Flex>
        {extensionsDock}
      </main>
    );
  }

  return (
    <main className="shell no-session" style={{ minWidth: 0, display: 'grid' }}>
      <HomeChrome
        extensionsDock={extensionsDock}
        onOpenPalette={props.onOpenPalette}
        onOpenSettings={props.onOpenSettings} />
      <PaperStage label={t('home.blankPaper')}>
        <Text className="home-hint" size="2" color="gray">
          {homeCopy.intro}
        </Text>
        <Flex
          className="home-actions home-command-bar"
          role="group"
          aria-label={t('home.commands')}
          gap="3"
          wrap="wrap"
          width="100%">
          <Box flexGrow="1" flexBasis="16rem" minWidth="0">
            <Card asChild size="2">
              <m.button
                className="home-entry-card"
                type="button"
                aria-label={t('home.openWork')}
                disabled={props.openingWorkspace || props.newProjectBusy}
                onClick={() => void props.onOpenWork()}
                style={{ width: '100%', textAlign: 'left' }}
                {...props.homeCardOpen}>
                <Flex align="center" gap="3">
                  <Flex
                    className="home-entry-icon"
                    aria-hidden="true"
                    align="center"
                    justify="center"
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 'var(--radius-3)',
                      background: 'var(--accent-a3)',
                      color: 'var(--accent-11)',
                    }}>
                    <FolderIcon size={20} />
                  </Flex>
                  <Text className="home-entry-title" size="3" weight="medium">
                    {homeCopy.openWork}
                  </Text>
                </Flex>
              </m.button>
            </Card>
          </Box>
          <Box flexGrow="1" flexBasis="16rem" minWidth="0">
            <Card asChild size="2">
              <m.button
                className="home-entry-card"
                type="button"
                aria-label={t('home.new')}
                disabled={props.openingWorkspace || props.newProjectBusy}
                onClick={() => void props.onNewProject()}
                style={{ width: '100%', textAlign: 'left' }}
                {...props.homeCardNew}>
                <Flex align="center" gap="3">
                  <Flex
                    className="home-entry-icon"
                    aria-hidden="true"
                    align="center"
                    justify="center"
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 'var(--radius-3)',
                      background: 'var(--accent-a3)',
                      color: 'var(--accent-11)',
                    }}>
                    <NewDocIcon size={20} />
                  </Flex>
                  <Text className="home-entry-title" size="3" weight="medium">
                    {homeCopy.newWork}
                  </Text>
                </Flex>
              </m.button>
            </Card>
          </Box>
        </Flex>
        {props.pathFallbackForm}
        {workspaceOpen.kind === 'needs-intent' ? <Callout.Root className="workspace-intent-prompt" role="alert" color="amber">
          <Text weight="bold" as="div">
            {workspaceOpen.intent === 'create' ? t('home.folderNotWork') : t('home.folderHasWork')}
          </Text>
          <Text as="p" mt="1">
            {workspaceOpen.message}
          </Text>
          <Text as="p" size="1" color="gray" mt="1">
            <code>
              {workspaceOpen.path}
            </code>
          </Text>
          <Flex gap="2" mt="2" wrap="wrap">
            <Button
              className="primary-action"
              variant="solid"
              type="button"
              disabled={props.openingWorkspace}
              onClick={() => void props.onContinueIntent()}>
              {workspaceOpen.intent === 'create' ? t('home.createHere') : t('home.openInstead')}
            </Button>
            <Button
              variant="soft"
              color="gray"
              type="button"
              disabled={props.openingWorkspace}
              onClick={() => void props.onCancelIntent()}>
              {t('common.cancel')}
            </Button>
          </Flex>
        </Callout.Root> : null}
        {workspaceOpen.kind === 'error' ? <Text size="1" color="gray">
          <code>
            {workspaceOpen.path}
          </code>
        </Text> : null}
        {props.homeNote ? <Callout.Root className="warning" role="alert" color="red">
          <Callout.Text>
            {props.homeNote}
          </Callout.Text>
        </Callout.Root> : null}
        <Separator size="4" my="2" />
        <section className="home-recent" aria-label={t('home.recent')}>
          <Flex direction="column" gap="3">
            <Heading as="h2" size="4">
              {t('home.recent')}
            </Heading>
            {props.workspaces.length ? <ScrollArea type="auto" scrollbars="vertical" style={{ maxHeight: '40vh' }}>
              <Flex className="workspace-list" direction="column" gap="2" pr="2">
                {props.workspaces.map((workspace) => {
                  const needsRelocation = workspaceOpen.kind === 'needs-relocation' && workspaceOpen.workspaceId === workspace.workspaceId
                  const recentLabel = formatRecentTime(workspace.updatedAt)
                  return (
                    <Card
                      className={`workspace-row${needsRelocation ? ' needs-relocation' : ''}`}
                      key={workspace.workspaceId}
                      size="2">
                      <Flex align="center" gap="2">
                        <Box flexGrow="1" minWidth="0">
                          <Button
                            className="tree-row"
                            type="button"
                            variant="ghost"
                            color="gray"
                            disabled={props.openingWorkspace}
                            style={{ width: '100%', textAlign: 'left', background: 'transparent' }}
                            onClick={() => void props.onOpenWorkspace(workspace)}>
                            <Flex direction="column" align="start" gap="1">
                              <Text weight="medium" size="2">
                                {workspace.title || workspace.path}
                              </Text>
                              <Text size="1" color="gray" truncate>
                                {workspace.path}
                              </Text>
                              {recentLabel ? <Text
                                className="workspace-time"
                                size="1"
                                color="gray"
                                aria-label={t('home.recentOpened', { label: recentLabel })}>
                                {recentLabel}
                              </Text> : null}
                            </Flex>
                          </Button>
                        </Box>
                        <IconButton
                          className="workspace-manage icon-button"
                          type="button"
                          variant="ghost"
                          color="gray"
                          size="1"
                          disabled={props.openingWorkspace}
                          title={t('home.removeRecent')}
                          aria-label={t('home.removeRecent')}
                          onClick={() => props.onRequestRemoveRecent(workspace)}>
                          ×
                        </IconButton>
                      </Flex>
                      {needsRelocation ? <Callout.Root className="workspace-relocation" role="alert" color="red" mt="2">
                        <Callout.Text>
                          {workspaceOpen.message}
                        </Callout.Text>
                        <Text as="p" size="1" color="gray" mt="1">
                          <code>
                            {workspaceOpen.path}
                          </code>
                        </Text>
                        <Flex gap="2" mt="2" wrap="wrap">
                          <Button
                            className="primary-action"
                            variant="solid"
                            type="button"
                            disabled={props.openingWorkspace}
                            onClick={() => void props.onRelocate(workspace)}>
                            {t('home.relocate')}
                          </Button>
                          <Button
                            variant="soft"
                            color="gray"
                            type="button"
                            disabled={props.openingWorkspace}
                            onClick={() => props.onRequestRemoveRecent(workspace)}>
                            {t('home.removeRecent')}
                          </Button>
                        </Flex>
                      </Callout.Root> : null}
                    </Card>
                  );
                })}
              </Flex>
            </ScrollArea> : <Text className="muted home-recent-empty" size="2" color="gray">
              {t('home.recentEmpty')}
            </Text>}
          </Flex>
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
