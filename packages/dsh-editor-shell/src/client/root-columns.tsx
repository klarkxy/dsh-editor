import { memo } from 'react'
import { Box } from '../ui/index.ts'
import type { SessionFace, WorkspaceId } from '../dsh-compat.ts'
import type { CompletionPreference, EditorCoreHandle, EditorCoreStatus } from 'dsh-manuscript/client/editor-core'
import { CENTER_OVERLAYS_SLOT, SIDEBAR_TOOLS_SLOT } from '../root-registration.ts'
import type { ShellProposalCardProps, ShellToolSeatContext } from '../seats.ts'
import { useLocale } from '../i18n/index.ts'
import { type RevealRequest, type ShellContext } from './shared.ts'
import { ShellErrorBoundary } from './components.tsx'
import { Chat, ProposalCard } from './chat.tsx'
import { Editor } from './editor.tsx'
import type { SearchHit } from '../model/search-panel.ts'
import type { SettingsRenderSlot } from './settings.tsx'

/* 工作区三栏拆成模块级 memo 组件：侧栏搜索输入、面板拖拽、editorDirty 翻转等
   高频重渲染不再连带重渲染全部三栏与插槽内容。props 一律由 Root 以
   useMemo/useCallback 固化，memo 才能真的跳过渲染。 */



export function BoundProposalCard(props: ShellProposalCardProps & { ctx: ShellContext }) {
  return (
    <ProposalCard
      ctx={props.ctx}
      sessionId={props.sessionId}
      proposal={props.proposal}
      onApplied={props.onApplied} />
  );
}

export function SidebarTools(props: { renderSlot?: SettingsRenderSlot; seatContext: ShellToolSeatContext }) {
  return <div className="sidebar-tools">
    <div data-dsh-plugin-surface="" style={{ display: 'contents' }}>
      {props.renderSlot?.(SIDEBAR_TOOLS_SLOT, props.seatContext) ?? null}
    </div>
  </div>
}

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
  onStatusChange?(status: EditorCoreStatus): void
  contentRevision: number
  onDirtyChange(dirty: boolean): void
  completionPreference: CompletionPreference
  completionDelayMs?: number
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
    firstLineIndent?: boolean
    centerSectionMarks?: boolean
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
        onStatusChange={props.onStatusChange}
        externalRevision={props.contentRevision}
        onDirtyChange={props.onDirtyChange}
        reveal={props.reveal}
        completionPreference={props.completionPreference}
        completionDelayMs={props.completionDelayMs}
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
  getActiveDocTitle?(): string | undefined
  authorPreferences: string
  authorMemory: string
  renderSlot?: SettingsRenderSlot
  hidden: boolean
  overlay?: boolean
  onConfigure(): void
  onDraftDirtyChange(dirty: boolean): void
  onWritten?(path: string): void
  onApplied(path: string): void
  onHide?(): void
}) {
  const { ctx, chatSession } = props
  return (
    <ShellErrorBoundary key={chatSession.sessionId}>
      <Chat
        ctx={ctx}
        session={chatSession}
        workspaceId={props.workspaceId}
        activePath={props.activePath}
        getActiveDocTitle={props.getActiveDocTitle}
        authorPreferences={props.authorPreferences}
        authorMemory={props.authorMemory}
        renderSlot={props.renderSlot}
        hidden={props.hidden}
        overlay={props.overlay}
        onConfigure={props.onConfigure}
        onDraftDirtyChange={props.onDraftDirtyChange}
        onWritten={props.onWritten}
        onApplied={props.onApplied}
        onHide={props.onHide} />
    </ShellErrorBoundary>
  );
})

/* 遮罩外框只提供底色与边距（§4 修订）：标题与关闭按钮由插件自管，
   shell 不再叠一条标题栏，避免与插件页头重复。 */
export const CenterOverlays = memo(function CenterOverlays(props: {
  show: boolean
  renderSlot?: SettingsRenderSlot
  seatContext: ShellToolSeatContext
}) {
  return props.show
    ? <Box className="center-overlays">
    <div className="center-overlay-surface" data-dsh-plugin-surface="">
      {props.renderSlot?.(CENTER_OVERLAYS_SLOT, props.seatContext) ?? null}
    </div>
  </Box>
    : null;
})
