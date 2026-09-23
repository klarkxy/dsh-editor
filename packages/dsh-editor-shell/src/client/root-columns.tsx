import { memo, useState, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Box, Callout, DropdownMenu, Flex, IconButton, Text, TextField } from '@radix-ui/themes'
import type { PanelSize } from 'react-resizable-panels'
import type { SessionFace, WorkspaceId } from '../dsh-compat.ts'
import type { CompletionPreference, EditorCoreHandle } from 'dsh-manuscript/client/editor-core'
import { CENTER_OVERLAYS_SLOT, SIDEBAR_TOOLS_SLOT } from '../root-registration.ts'
import type { ShellProposalCardProps, ShellToolSeatContext } from '../seats.ts'
import type { WritingModelRoute } from '../writing-settings.ts'
import { t, useLocale } from '../i18n/index.ts'
import { isSuccessWorkbenchNote, type RevealRequest, type ShellContext } from './shared.ts'
import { ShellErrorBoundary } from './components.tsx'
import { Chat, ProposalCard } from './chat.tsx'
import { Editor } from './editor.tsx'
import { SearchIcon } from './icons.tsx'
import { Tree } from './sidebar.tsx'
import { SearchPanel, type SearchHit } from './search-panel.tsx'
import type { SettingsRenderSlot } from './settings.tsx'
import { isImeEvent, Menu, MenuContent, MenuItem, m, useChromeMotion } from './ui/index.ts'

/* 工作区三栏拆成模块级 memo 组件：侧栏搜索输入、面板拖拽、editorDirty 翻转等
   高频重渲染不再连带重渲染全部三栏与插槽内容。props 一律由 Root 以
   useMemo/useCallback 固化，memo 才能真的跳过渲染。 */

export type FileMenuKind = 'file' | 'directory'
export type SidebarFileMenuProps = {
  onOpen(path: string): void
  onPreviewImage(path: string): void
  onFileMenu(kind: FileMenuKind, path: string, position: { x: number; y: number }, trigger?: HTMLElement | null): void
  onCreateFile(directory: string): void
  onCreateFolder(directory: string): void
  onMove(source: { kind: FileMenuKind; path: string }, targetDir: string): void
}

export const panelPixels = (size: PanelSize): number => Math.round(size.inPixels)

export function BoundProposalCard(props: ShellProposalCardProps & { ctx: ShellContext }) {
  return (
    <ProposalCard
      ctx={props.ctx}
      sessionId={props.sessionId}
      proposal={props.proposal}
      onApplied={props.onApplied} />
  );
}

export const TreeColumn = memo(function TreeColumn(props: SidebarFileMenuProps & {
  ctx: ShellContext
  sessionId: string
  active: string
  expandPath: string
  highlightPath?: string
  revision: number
}) {
  return (
    <Tree
      ctx={props.ctx}
      sessionId={props.sessionId}
      active={props.active}
      expandPath={props.expandPath}
      highlightPath={props.highlightPath}
      onOpen={props.onOpen}
      onPreviewImage={props.onPreviewImage}
      onFileMenu={props.onFileMenu}
      onCreateFile={props.onCreateFile}
      onCreateFolder={props.onCreateFolder}
      onMove={props.onMove}
      revision={props.revision} />
  );
})

export const SidebarColumn = memo(function SidebarColumn(props: SidebarFileMenuProps & {
  ctx: ShellContext
  sessionId: string
  searchOpen: boolean
  onSearchRequestOpen(): void
  onOpenDocument(path: string, hit?: SearchHit): void
  onSearchReplaced(paths: string[]): void
  activePath: string
  activeDirty: boolean
  fileRevision: number
  historyOpen: boolean
  snapshotBusy: boolean
  onCommitSnapshot(): void
  onOpenHistory(): void
  createNote: string
  workspaceWarning: string | undefined
  workbenchNote: string
  expandPath: string
  highlightPath?: string
  renderSlot?: SettingsRenderSlot
  seatContext: ShellToolSeatContext
}) {
  /* 搜索查询串留在侧栏层：按键只重渲染本列，不上升到 Root 惊动其余两栏。 */
  const [searchQuery, setSearchQuery] = useState('')
  const [searchSubmitTick, setSearchSubmitTick] = useState(0)
  const panelMotion = useChromeMotion('panel', 0, 'left')
  useLocale()
  return (
    <m.aside
      className="sidebar"
      aria-label={t('workspace.filesAndNotes')}
      {...panelMotion}>
      <Flex className="side-title" align="center" justify="between" px="3">
        <Text size="2" weight="medium" className="side-title-label" truncate>
          {t('sidebar.manuscriptTree')}
        </Text>
        <Menu>
          <DropdownMenu.Trigger>
            <IconButton
              className="side-version-trigger"
              variant="ghost"
              color="gray"
              size="2"
              title={t('sidebar.versionMenu')}
              aria-label={t('sidebar.versionMenu')}>
              ⋯
            </IconButton>
          </DropdownMenu.Trigger>
          <MenuContent
            className="file-context-menu"
            align="end"
            side="bottom"
            aria-label={t('sidebar.versionMenu')}>
            <MenuItem
              disabled={props.snapshotBusy}
              title={t('workspace.commitTitle')}
              onSelect={() => { props.onCommitSnapshot() }}>
              {t('workspace.commit')}
            </MenuItem>
            <MenuItem
              aria-current={props.historyOpen ? 'true' : undefined}
              title={t('workspace.commitHistory')}
              onSelect={() => props.onOpenHistory()}>
              {t('common.history')}
            </MenuItem>
          </MenuContent>
        </Menu>
      </Flex>
      <TextField.Root
        className="side-search"
        type="search"
        size="2"
        mx="3"
        mb="2"
        value={searchQuery}
        maxLength={120}
        placeholder={t('search.placeholder')}
        aria-label={t('search.aria')}
        title={t('workspace.searchTitle')}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          setSearchQuery(event.target.value)
          if (!props.searchOpen) props.onSearchRequestOpen()
        }}
        onFocus={() => props.onSearchRequestOpen()}
        onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
          if (event.key !== 'Enter') return
          if (isImeEvent({ isComposing: event.nativeEvent.isComposing, keyCode: event.nativeEvent.keyCode })) {
            event.preventDefault()
            return
          }
          props.onSearchRequestOpen()
          setSearchSubmitTick((tick) => tick + 1)
        }}>
        <TextField.Slot>
          <SearchIcon size={14} />
        </TextField.Slot>
      </TextField.Root>
      {props.searchOpen ? <SearchPanel
        ctx={props.ctx}
        sessionId={props.sessionId}
        revision={props.fileRevision}
        query={searchQuery}
        onQueryChange={setSearchQuery}
        submitTick={searchSubmitTick}
        /* 跳转统一走 openDocument 的保存 gate，不再因脏禁用；替换写入仍受 activeDirty 保护。 */
        navigationBlocked={false}
        activePath={props.activePath}
        activeDirty={props.activeDirty}
        onOpen={(hit: SearchHit) => props.onOpenDocument(hit.path, hit)}
        onReplaced={props.onSearchReplaced} /> : null}
      <m.div className="sidebar-tools" {...panelMotion}>
        {props.renderSlot?.(SIDEBAR_TOOLS_SLOT, props.seatContext) ?? null}
      </m.div>
      {props.createNote ? <Callout.Root className="warning" color="red" size="1" mx="3" mb="2" role="alert">
        <Callout.Text>
          {props.createNote}
        </Callout.Text>
      </Callout.Root> : null}
      {props.workspaceWarning ? <Callout.Root className="warning" color="red" size="1" mx="3" mb="2" role="status">
        <Callout.Text>
          {props.workspaceWarning}
        </Callout.Text>
      </Callout.Root> : null}
      {props.workbenchNote ? (
        isSuccessWorkbenchNote(props.workbenchNote)
          ? <Callout.Root className="side-status" size="1" mx="3" mb="2" role="status">
            <Callout.Text>
              {props.workbenchNote}
            </Callout.Text>
          </Callout.Root>
          : <Callout.Root className="warning" color="red" size="1" mx="3" mb="2" role="alert">
            <Callout.Text>
              {props.workbenchNote}
            </Callout.Text>
          </Callout.Root>
      ) : null}
      <TreeColumn
        ctx={props.ctx}
        sessionId={props.sessionId}
        active={props.activePath}
        expandPath={props.expandPath}
        highlightPath={props.highlightPath}
        onOpen={props.onOpen}
        onPreviewImage={props.onPreviewImage}
        onFileMenu={props.onFileMenu}
        onCreateFile={props.onCreateFile}
        onCreateFolder={props.onCreateFolder}
        onMove={props.onMove}
        revision={props.fileRevision} />
    </m.aside>
  );
})

export const EditorColumn = memo(function EditorColumn(props: {
  ctx: ShellContext
  fileSession: SessionFace
  path: string
  files: string[]
  referenceFiles?: readonly string[]
  referenceRevision?: number
  onOpenReference?(path: string, hit?: SearchHit): void
  onPinReference?(path: string): void
  onCreate(): void
  onHandle(handle: EditorCoreHandle | null): void
  contentRevision: number
  onDirtyChange(dirty: boolean): void
  completionPreference: CompletionPreference
  completionEnabled: boolean
  authorPreferences: string
  authorMemory: string
  typewriter?: boolean
  focusParagraph?: boolean
  typography?: {
    fontSize?: number
    lineHeight?: number
    fontFamily?: 'serif' | 'sans' | 'mono' | string
    paragraphSpacing?: number
    maxWidth?: number
  }
  onSaved(): void
  reveal: RevealRequest | null
}) {
  const { ctx, fileSession, path, files } = props
  /* 空态/改写弹窗等文案走 t()：自行订阅语言，memo 跳过时也能随语言切换刷新（同 Chat）。 */
  useLocale()
  return (
    <ShellErrorBoundary>
      <Editor
        ctx={ctx}
        session={fileSession}
        path={path}
        files={files}
        referenceFiles={props.referenceFiles}
        referenceRevision={props.referenceRevision}
        onOpenReference={props.onOpenReference}
        onPinReference={props.onPinReference}
        create={props.onCreate}
        onHandle={props.onHandle}
        externalRevision={props.contentRevision}
        onDirtyChange={props.onDirtyChange}
        reveal={props.reveal}
        completionPreference={props.completionPreference}
        /* 能力未加载完成前不发起补全/改写 RPC;显式错误态由用户重试恢复。 */
        completionEnabled={props.completionEnabled}
        authorPreferences={props.authorPreferences}
        authorMemory={props.authorMemory}
        typewriter={props.typewriter}
        focusParagraph={props.focusParagraph}
        typography={props.typography}
        onSaved={props.onSaved} />
    </ShellErrorBoundary>
  );
})

export const ChatColumn = memo(function ChatColumn(props: {
  ctx: ShellContext
  chatSession: SessionFace
  workspaceId?: WorkspaceId
  activePath?: string
  authorPreferences: string
  authorMemory: string
  chatModel?: WritingModelRoute
  onAcceptMemory(observation: string): Promise<boolean> | boolean
  hidden: boolean
  overlay?: boolean
  onConfigure(): void
  onDraftDirtyChange(dirty: boolean): void
  onWritten?(path: string): void
  onApplied(path: string): void
}) {
  const { ctx, chatSession } = props
  return (
    <ShellErrorBoundary key={chatSession.sessionId}>
      <Chat
        ctx={ctx}
        session={chatSession}
        workspaceId={props.workspaceId}
        activePath={props.activePath}
        authorPreferences={props.authorPreferences}
        authorMemory={props.authorMemory}
        chatModel={props.chatModel}
        onAcceptMemory={props.onAcceptMemory}
        hidden={props.hidden}
        overlay={props.overlay}
        onConfigure={props.onConfigure}
        onDraftDirtyChange={props.onDraftDirtyChange}
        onWritten={props.onWritten}
        onApplied={props.onApplied} />
    </ShellErrorBoundary>
  );
})

export const CenterOverlays = memo(function CenterOverlays(props: {
  show: boolean
  renderSlot?: SettingsRenderSlot
  seatContext: ShellToolSeatContext
}) {
  return props.show
    ? <Box className="center-overlays">
    {props.renderSlot?.(CENTER_OVERLAYS_SLOT, props.seatContext) ?? null}
  </Box>
    : null;
})

