import type { Dispatch, MutableRefObject, ReactNode, RefObject, SetStateAction, CSSProperties } from 'react'
import { SeatButton } from 'dsh-editor-seats/seat-button'
import { surfaceTokenVars } from 'dsh-editor-seats/tokens'
import type { EditorView } from '@codemirror/view'
import { SelectionDiff } from './selection-diff.tsx'
import { normalizeTypography, typographyCssVariables } from './typography.ts'
import type { EditorCoreDraftBackup, EditorCoreProps, EditorCoreSlot } from './editor-contracts.ts'
import type { EditorDocument, SaveState, SelectionTicket } from './editor-state.ts'
import { isDirty } from './editor-state.ts'

type EditorChromeProps = Pick<EditorCoreProps,
  'path' | 'paperClassName' | 'paperStyle' | 'compactControls' | 'enableRewriteSelection' |
  'completionEnabled' | 'onRewriteSelection' | 'testIdPrefix' | 'headerExtras' | 'footerExtras' |
  'paperHeader' | 'conflictNotice' | 'hostButton' |
  'showGhostTip' | 'enablePatch' | 'showProposalDiff' | 'onReloadDisk' | 'onSaveConflictCopy' | 'typography'
> & {
  slotClassName: NonNullable<EditorCoreProps['slotClassName']>
  slotStyle: NonNullable<EditorCoreProps['slotStyle']>
  maxGhostCandidates: number
  doc: EditorDocument | null
  textRef: MutableRefObject<string>
  selection: { start: number; end: number }
  hasSelection: boolean
  wordCount: number
  state: SaveState
  loadingFim: boolean
  patching: boolean
  conflict: boolean
  error: string
  note: string
  ghost: string
  ghostCandidates: string[]
  ghostIndex: number
  proposal: { ticket: SelectionTicket; text: string } | null
  backups: EditorCoreDraftBackup[]
  proposalRef: RefObject<HTMLDivElement>
  containerRef: RefObject<HTMLDivElement>
  viewRef: MutableRefObject<EditorView | null>
  save(): Promise<boolean>
  discard(): void
  stopCompletion(): void
  stopPatch(): void
  complete(append?: boolean): Promise<void>
  requestPatch(): Promise<void>
  acceptGhost(): void
  acceptPatch(): void
  clearGhost(): void
  report(message: string): void
  adoptBackup(backup: EditorCoreDraftBackup): void
  setGhostIndex: Dispatch<SetStateAction<number>>
  setProposal: Dispatch<SetStateAction<{ ticket: SelectionTicket; text: string } | null>>
}

/* editor-core の inline default スタイルはホスト可搬性のため残しつつ、
   見た目リテラルはモジュール定数に集約する（クラス/スロット上書きが常に優先）。 */
const PROPOSAL_STYLE: CSSProperties = {
  padding: 12,
  border: '1px solid var(--s-line-strong)',
  borderRadius: 'var(--radius-3)',
}
const CONFLICT_STYLE: CSSProperties = {
  padding: '6px 8px',
  borderTop: '1px solid var(--s-line-strong)',
  fontSize: 'var(--font-size-1)',
}
const ERROR_NOTICE_STYLE: CSSProperties = {
  padding: 8,
  color: 'var(--s-danger)',
  fontSize: 'var(--font-size-1)',
}
const STATUS_TEXT_STYLE: CSSProperties = { color: 'var(--s-muted)' }
const FOOTER_STATUS_STYLE: CSSProperties = {
  marginLeft: 'auto',
  marginRight: 'auto',
  display: 'flex',
  gap: 12,
  alignItems: 'baseline',
  fontSize: 'var(--font-size-1)',
  color: 'var(--s-muted)',
}

function describeStatus(state: SaveState, conflict: boolean): string {
  if (state === 'empty') return ''
  if (state === 'loading') return '读取中…'
  if (state === 'saved') return '已保存'
  if (state === 'draft') return '草稿未保存'
  if (state === 'conflict') return conflict ? '版本冲突' : '需处理'
  return '读取失败'
}

/** 备份按钮的小标签：序号 + 本地化的可读更新时间（没有 updatedAt 时只有序号）。 */
function draftBackupLabel(backup: EditorCoreDraftBackup, index: number): string {
  const date = backup.updatedAt ? new Date(backup.updatedAt) : null
  const stamp = date && !Number.isNaN(date.getTime())
    ? new Intl.DateTimeFormat(globalThis.navigator?.language || undefined, {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(date)
    : ''
  return stamp ? `备份 ${index + 1} · ${stamp}` : `备份 ${index + 1}`
}

/** Existing editor controls; component identity is stable across host renders. */
export function EditorChrome({
  path, paperClassName, paperStyle, slotClassName, slotStyle, compactControls,
  enableRewriteSelection, completionEnabled, onRewriteSelection, testIdPrefix,
  headerExtras, footerExtras, paperHeader, conflictNotice, hostButton,
  showGhostTip, enablePatch, showProposalDiff,
  onReloadDisk, onSaveConflictCopy, typography, maxGhostCandidates,
  doc, textRef, selection, hasSelection, wordCount, state, loadingFim, patching,
  conflict, error, note, ghost, ghostCandidates, ghostIndex, proposal, backups,
  proposalRef, containerRef, viewRef, save, discard, stopCompletion, complete,
  requestPatch, acceptGhost, acceptPatch, clearGhost, report, adoptBackup,
  setGhostIndex, setProposal, stopPatch,
}: EditorChromeProps): ReactNode {
  if (!path) return null

  const cls = (slot: EditorCoreSlot) => slotClassName[slot]
  const sty = (slot: EditorCoreSlot) => slotStyle[slot]
  const showFooter = Boolean(paperHeader) || Boolean(footerExtras) || loadingFim || patching || ghost || conflict || (!compactControls && (proposal || note))
  const paperVars = typographyCssVariables(normalizeTypography(typography)) as CSSProperties
  const statusText = loadingFim ? '正在补全…' : patching ? '正在改写…' : describeStatus(state, conflict)
  /* 页脚状态行只显示一次：宿主页眉（paperHeader）模式下页脚承载「N 字 + 保存状态」，
     独立宿主沿用页头状态区，两处 testid 不变。 */
  const statusLine = <>
    <span data-testid={`${testIdPrefix}-wordcount`} style={STATUS_TEXT_STYLE}>
      {`${wordCount} 字`}
    </span>
    <span data-testid={`${testIdPrefix}-save-state`} style={STATUS_TEXT_STYLE}>
      {statusText}
    </span>
  </>

  return (
    <section
      className={[paperClassName, cls('outer')].filter(Boolean).join(' ')}
      aria-label="文稿编辑区"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        '--paper-dim-opacity': '0.35',
        ...surfaceTokenVars,
        ...paperVars,
        ...paperStyle,
        ...sty('outer'),
      } as CSSProperties}>
      {paperHeader ? null : <header
        className={cls('header')}
        style={{
          fontSize: 'var(--font-size-1)',
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          flexWrap: 'wrap',
          ...(cls('header') ? undefined : { padding: '4px 8px' }),
          ...sty('header'),
        }}>
        <span
          data-testid={`${testIdPrefix}-path`}
          style={{ opacity: 0.7, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {doc?.path || path}
        </span>
        {!compactControls && enableRewriteSelection && completionEnabled ? <SeatButton
          host={hostButton}
          data-testid={`${testIdPrefix}-rewrite`}
          disabled={!hasSelection}
          onClick={() => {
            const sel = textRef.current.slice(selection.start, selection.end)
            if (!sel) return
            void Promise.resolve(onRewriteSelection?.(sel, doc?.path || path))
          }}>
          改这段
        </SeatButton> : null}
        {!compactControls && completionEnabled ? <SeatButton
          host={hostButton}
          variant={loadingFim ? undefined : 'primary'}
          data-testid={`${testIdPrefix}-fim`}
          onClick={() => { if (loadingFim) stopCompletion(); else void complete(false) }}>
          {loadingFim ? '停止补全' : ghost ? '重新补全' : '补全'}
        </SeatButton> : null}
        {statusLine}
        {headerExtras}
      </header>}
      <div
        className={cls('textarea')}
        style={{ position: 'relative', flex: 1, minHeight: 0, ...sty('textarea') }}>
        {// CodeMirror mounts here. The container keeps the legacy testid and
        // fills the wrapper; the EditorView lives on `__cmView` for e2e.
        <div
          ref={containerRef}
          data-testid={`${testIdPrefix}-editor`}
          aria-label="文档编辑器"
          style={{ position: 'absolute', inset: 0 }} />}
      </div>
      {showGhostTip && ghost ? <div
        className={cls('ghostTip')}
        style={{ padding: '4px 8px', fontSize: 'var(--font-size-1)', opacity: 0.55, ...sty('ghostTip') }}>
        Tab · Esc
      </div> : null}
      {proposal ? <div
        ref={proposalRef}
        className={[cls('proposal') || 'proposal', 'manuscript-paper-proposal'].filter(Boolean).join(' ')}
        aria-label="选段修改建议"
        style={{ ...(cls('proposal') ? undefined : PROPOSAL_STYLE), ...sty('proposal') }}>
        <strong>
          选段修改建议
        </strong>
        {showProposalDiff ? <SelectionDiff original={proposal.ticket.selectedText} revised={proposal.text} /> : <p>
          {proposal.text}
        </p>}
        <div className="proposal-actions">
          <SeatButton host={hostButton} variant="primary" onClick={acceptPatch}>
            应用修改
          </SeatButton>
          <SeatButton
            host={hostButton}
            variant="danger"
            className="proposal-dismiss"
            onClick={() => { setProposal(null); report('已放弃修改建议。'); viewRef.current?.focus() }}>
            放弃
          </SeatButton>
        </div>
      </div> : null}
      {conflict ? (conflictNotice ?? <div
        data-testid={`${testIdPrefix}-conflict-guard`}
        className={cls('conflict')}
        style={{ ...CONFLICT_STYLE, ...sty('conflict') }}>
        <span>
          草稿与磁盘版本不一致，已保留本地内容。
        </span>
      </div>) : null}
      {note && sty('notice')?.display !== 'none' ? <div
        data-testid={`${testIdPrefix}-notice`}
        className={cls('notice')}
        role={conflict ? 'alert' : 'status'}
        style={{ padding: '4px 8px', fontSize: 'var(--font-size-1)', opacity: 0.7, ...sty('notice') }}>
        {note}
      </div> : null}
      {error ? <div
        className={cls('notice')}
        style={{ ...ERROR_NOTICE_STYLE, ...sty('notice') }}>
        {error}
      </div> : null}
      {/* 恢复备份入口独立于 notice 槽：shell 会把 slotStyle.notice 设为 display:none
         只隐藏普通提示，这里的按钮必须始终可见可点。 */
      backups.length > 0 && doc ? <div
        data-testid={`${testIdPrefix}-draft-backups`}
        role="status"
        style={{ padding: '4px 8px', fontSize: 'var(--font-size-1)', opacity: 0.8, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <span>
          {`发现 ${backups.length} 份其他窗口的未保存备份（采纳后原备份保留）：`}
        </span>
        {backups.map((backup, index) => <SeatButton
          key={`${backup.ownerId ?? 'legacy'}-${backup.revision ?? index}`}
          host={hostButton}
          disabled={isDirty(doc, textRef.current) || conflict}
          title={isDirty(doc, textRef.current) || conflict ? '当前有未保存内容，请先保存或放弃修改，避免丢稿' : '把这份备份放入当前草稿'}
          onClick={() => adoptBackup(backup)}>
          {draftBackupLabel(backup, index)}
        </SeatButton>)}
      </div> : null}
      {showFooter ? <footer
        className={cls('footer')}
        style={{ padding: '6px 8px', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', ...sty('footer') }}>
        {!compactControls ? <SeatButton
          host={hostButton}
          variant="primary"
          disabled={!doc || textRef.current === doc.text || conflict}
          onClick={() => void save()}>
          保存
        </SeatButton> : null}
        {loadingFim ? <SeatButton
          host={hostButton}
          onClick={stopCompletion}>
          停止补全
        </SeatButton> : null}
        {patching ? <SeatButton
          host={hostButton}
          onClick={stopPatch}>
          停止改写
        </SeatButton> : null}
        {!compactControls && enablePatch && completionEnabled ? <SeatButton
          host={hostButton}
          disabled={!doc || conflict || loadingFim || selection.start === selection.end}
          onClick={() => { void requestPatch() }}>
          修改选段
        </SeatButton> : null}
        {ghost ? <div
          style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <strong>
            补全建议
          </strong>
          <small>
            {`候选 ${ghostIndex + 1}/${ghostCandidates.length}`}
          </small>
          <SeatButton host={hostButton} variant="primary" onClick={acceptGhost}>
            接受补全
          </SeatButton>
          {ghostCandidates.length < maxGhostCandidates ? <SeatButton host={hostButton} disabled={loadingFim} onClick={() => void complete(true)}>
            再来一个
          </SeatButton> : <span style={{ opacity: 0.55 }}>
            {`已满 ${maxGhostCandidates} 条`}
          </span>}
          <SeatButton
            host={hostButton}
            variant="danger"
            onClick={() => { clearGhost(); report('已放弃补全。'); viewRef.current?.focus() }}>
            放弃
          </SeatButton>
          {ghostCandidates.length > 1 ? <nav aria-label="切换补全候选" style={{ display: 'flex', gap: 4 }}>
            <SeatButton
              host={hostButton}
              disabled={ghostIndex <= 0}
              onClick={() => setGhostIndex((old) => Math.max(0, old - 1))}>
              上一条
            </SeatButton>
            <SeatButton
              host={hostButton}
              disabled={ghostIndex >= ghostCandidates.length - 1}
              onClick={() => setGhostIndex((old) => Math.min(ghostCandidates.length - 1, old + 1))}>
              下一条
            </SeatButton>
          </nav> : null}
        </div> : null}
        {/* 冲突操作：宿主提供 conflictNotice 时由宿主 Notice 承载（重新载入/另存冲突副本），
            否则沿用内置三个按钮。 */}
        {!conflictNotice && conflict ? <SeatButton host={hostButton} variant="danger" onClick={discard}>
          放弃草稿并重新读取
        </SeatButton> : null}
        {!conflictNotice && conflict && onReloadDisk ? <SeatButton
          host={hostButton}
          data-testid={`${testIdPrefix}-reload-disk`}
          onClick={onReloadDisk}>
          重新载入磁盘版本
        </SeatButton> : null}
        {!conflictNotice && conflict && onSaveConflictCopy ? <SeatButton
          host={hostButton}
          data-testid={`${testIdPrefix}-save-conflict-copy`}
          onClick={onSaveConflictCopy}>
          另存冲突副本
        </SeatButton> : null}
        {loadingFim || patching ? null : footerExtras}
        {paperHeader ? <div
          className="paper-footer-status"
          style={FOOTER_STATUS_STYLE}>
          {statusLine}
        </div> : null}
      </footer> : null}
    </section>
  );
}
