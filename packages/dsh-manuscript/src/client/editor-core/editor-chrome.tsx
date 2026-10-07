import type { Dispatch, MutableRefObject, ReactNode, RefObject, SetStateAction, CSSProperties } from 'react'
import { Button } from '@radix-ui/themes'
import type { EditorView } from '@codemirror/view'
import { SelectionDiff } from './selection-diff.tsx'
import { normalizeTypography, typographyCssVariables } from './typography.ts'
import type { EditorCoreDraftBackup, EditorCoreProps, EditorCoreSlot } from './editor-contracts.ts'
import type { EditorDocument, SaveState, SelectionTicket } from './editor-state.ts'
import { isDirty } from './editor-state.ts'

type EditorChromeProps = Pick<EditorCoreProps,
  'path' | 'paperClassName' | 'paperStyle' | 'compactControls' | 'enableRewriteSelection' |
  'completionEnabled' | 'onRewriteSelection' | 'testIdPrefix' | 'headerExtras' | 'footerExtras' |
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
  headerExtras, footerExtras, showGhostTip, enablePatch, showProposalDiff,
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
  const showFooter = Boolean(footerExtras) || loadingFim || patching || ghost || conflict || (!compactControls && (proposal || note))
  const paperVars = typographyCssVariables(normalizeTypography(typography)) as CSSProperties

  return (
    <section
      className={[paperClassName, cls('outer')].filter(Boolean).join(' ')}
      aria-label="文稿编辑区"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        '--paper-dim-opacity': '0.35',
        ...paperVars,
        ...paperStyle,
        ...sty('outer'),
      } as CSSProperties}>
      <header
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
        {!compactControls && enableRewriteSelection && completionEnabled ? <Button
          type="button"
          variant="soft"
          color="gray"
          size="1"
          data-testid={`${testIdPrefix}-rewrite`}
          disabled={!hasSelection}
          onClick={() => {
            const sel = textRef.current.slice(selection.start, selection.end)
            if (!sel) return
            void Promise.resolve(onRewriteSelection?.(sel, doc?.path || path))
          }}>
          改这段
        </Button> : null}
        {!compactControls && completionEnabled ? <Button
          type="button"
          variant={loadingFim ? 'soft' : 'solid'}
          color={loadingFim ? 'gray' : undefined}
          size="1"
          data-testid={`${testIdPrefix}-fim`}
          onClick={() => { if (loadingFim) stopCompletion(); else void complete(false) }}>
          {loadingFim ? '停止补全' : ghost ? '重新补全' : '补全'}
        </Button> : null}
        <span data-testid={`${testIdPrefix}-wordcount`} style={{ color: 'var(--gray-11)' }}>
          {`${wordCount} 字`}
        </span>
        <span data-testid={`${testIdPrefix}-save-state`} style={{ color: 'var(--gray-11)' }}>
          {loadingFim ? '正在补全…' : patching ? '正在改写…' : describeStatus(state, conflict)}
        </span>
        {headerExtras}
      </header>
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
        style={{ padding: 12, border: '1px solid var(--gray-6)', borderRadius: 'var(--radius-3)', ...sty('proposal') }}>
        <strong>
          选段修改建议
        </strong>
        {showProposalDiff ? <SelectionDiff original={proposal.ticket.selectedText} revised={proposal.text} /> : <p>
          {proposal.text}
        </p>}
        <div className="proposal-actions">
          <Button type="button" variant="solid" className="primary-action" size="1" onClick={acceptPatch}>
            应用修改
          </Button>
          <Button
            type="button"
            variant="soft"
            color="red"
            className="proposal-dismiss"
            size="1"
            onClick={() => { setProposal(null); report('已放弃修改建议。'); viewRef.current?.focus() }}>
            放弃
          </Button>
        </div>
      </div> : null}
      {conflict ? <div
        data-testid={`${testIdPrefix}-conflict-guard`}
        className={cls('conflict')}
        style={{ padding: '6px 8px', borderTop: '1px solid var(--gray-6)', fontSize: 'var(--font-size-1)', ...sty('conflict') }}>
        <span>
          草稿与磁盘版本不一致，已保留本地内容。
        </span>
      </div> : null}
      {note && sty('notice')?.display !== 'none' ? <div
        data-testid={`${testIdPrefix}-notice`}
        className={cls('notice')}
        role={conflict ? 'alert' : 'status'}
        style={{ padding: '4px 8px', fontSize: 'var(--font-size-1)', opacity: 0.7, ...sty('notice') }}>
        {note}
      </div> : null}
      {error ? <div
        className={cls('notice')}
        style={{ padding: 8, color: 'var(--red-11)', fontSize: 'var(--font-size-1)', ...sty('notice') }}>
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
        {backups.map((backup, index) => <Button
          key={`${backup.ownerId ?? 'legacy'}-${backup.revision ?? index}`}
          type="button"
          variant="soft"
          color="gray"
          size="1"
          disabled={isDirty(doc, textRef.current) || conflict}
          title={isDirty(doc, textRef.current) || conflict ? '当前有未保存内容，请先保存或放弃修改，避免丢稿' : '把这份备份放入当前草稿'}
          onClick={() => adoptBackup(backup)}>
          {draftBackupLabel(backup, index)}
        </Button>)}
      </div> : null}
      {showFooter ? <footer
        className={cls('footer')}
        style={{ padding: '6px 8px', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', ...sty('footer') }}>
        {!compactControls ? <Button
          type="button"
          variant="solid"
          size="1"
          disabled={!doc || textRef.current === doc.text || conflict}
          onClick={() => void save()}>
          保存
        </Button> : null}
        {loadingFim ? <Button
          type="button"
          variant="soft"
          color="gray"
          size="1"
          onClick={stopCompletion}>
          停止补全
        </Button> : null}
        {patching ? <Button
          type="button"
          variant="soft"
          color="gray"
          size="1"
          onClick={stopPatch}>
          停止改写
        </Button> : null}
        {!compactControls && enablePatch && completionEnabled ? <Button
          type="button"
          variant="soft"
          color="gray"
          size="1"
          disabled={!doc || conflict || loadingFim || selection.start === selection.end}
          onClick={() => { void requestPatch() }}>
          修改选段
        </Button> : null}
        {ghost ? <div
          style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <strong>
            补全建议
          </strong>
          <small>
            {`候选 ${ghostIndex + 1}/${ghostCandidates.length}`}
          </small>
          <Button type="button" variant="solid" size="1" onClick={acceptGhost}>
            接受补全
          </Button>
          {ghostCandidates.length < maxGhostCandidates ? <Button type="button" variant="soft" color="gray" size="1" disabled={loadingFim} onClick={() => void complete(true)}>
            再来一个
          </Button> : <span style={{ opacity: 0.55 }}>
            {`已满 ${maxGhostCandidates} 条`}
          </span>}
          <Button
            type="button"
            variant="soft"
            color="red"
            size="1"
            onClick={() => { clearGhost(); report('已放弃补全。'); viewRef.current?.focus() }}>
            放弃
          </Button>
          {ghostCandidates.length > 1 ? <nav aria-label="切换补全候选" style={{ display: 'flex', gap: 4 }}>
            <Button
              type="button"
              variant="ghost"
              color="gray"
              size="1"
              disabled={ghostIndex <= 0}
              onClick={() => setGhostIndex((old) => Math.max(0, old - 1))}>
              上一条
            </Button>
            <Button
              type="button"
              variant="ghost"
              color="gray"
              size="1"
              disabled={ghostIndex >= ghostCandidates.length - 1}
              onClick={() => setGhostIndex((old) => Math.min(ghostCandidates.length - 1, old + 1))}>
              下一条
            </Button>
          </nav> : null}
        </div> : null}
        {conflict ? <Button type="button" variant="soft" color="red" size="1" onClick={discard}>
          放弃草稿并重新读取
        </Button> : null}
        {conflict && onReloadDisk ? <Button
          type="button"
          variant="soft"
          color="gray"
          size="1"
          data-testid={`${testIdPrefix}-reload-disk`}
          onClick={onReloadDisk}>
          重新载入磁盘版本
        </Button> : null}
        {conflict && onSaveConflictCopy ? <Button
          type="button"
          variant="soft"
          color="gray"
          size="1"
          data-testid={`${testIdPrefix}-save-conflict-copy`}
          onClick={onSaveConflictCopy}>
          另存冲突副本
        </Button> : null}
        {loadingFim || patching ? null : footerExtras}
      </footer> : null}
    </section>
  );
}
