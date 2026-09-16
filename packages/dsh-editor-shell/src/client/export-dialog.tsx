import React, { Fragment, useRef, useState, type RefObject } from 'react';
import { ActivityDots, ActivityRing, ActivitySkeleton, ActivityText, Button, Dialog } from './ui/index.ts'
import { errorMessage, safeRpcCall, type RpcResult, type ShellContext } from './shared.ts'
import { prepareExport, sanitizeExportTitle, type ChapterExport, type ExportFormat, type PreparedExport } from '../export.ts'
import { isHiddenProjectPath, normalizeProjectDirectory, sortDocumentPaths } from '../project-files.ts'
import { buildBook } from '../export-book.ts'
import { buildDocxBlob } from '../export-docx.ts'
import { buildEpubBlob } from '../export-epub.ts'
import { t } from '../i18n/index.ts'

export async function collectDocuments(ctx: ShellContext, sessionId: string, directory: string): Promise<ChapterExport[]> {
  const root = normalizeProjectDirectory(directory)
  if (root && isHiddenProjectPath(root)) return []
  const queue = [root]
  const files: string[] = []
  while (queue.length) {
    const current = queue.shift()!
    const listed = await safeRpcCall<{ entries?: { name: string; type: 'file' | 'directory' | 'other' }[] }>(() => ctx.connection.rpc.call('/manuscript', 'tree.list', {
      sessionId,
      path: current || '.',
    }))
    if (!listed.ok) throw new Error(errorMessage(listed))
    for (const entry of listed.value.entries ?? []) {
      if (entry.name.startsWith('.')) continue
      const child = current ? `${current}/${entry.name}` : entry.name
      if (isHiddenProjectPath(child)) continue
      if (entry.type === 'directory') queue.push(child)
      else if (entry.type === 'file' && /\.(?:md|txt)$/i.test(entry.name)) files.push(child)
    }
  }
  return await Promise.all(sortDocumentPaths(files).map(async (path) => {
    const read = await ctx.connection.rpc.call('/manuscript', 'file.read', { sessionId, path }) as RpcResult<{ text: string }>
    if (!read.ok) throw new Error(errorMessage(read))
    return { path, text: read.value.text }
  }))
}

export function downloadBlob(filename: string, blob: Blob): void {
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = filename
  anchor.click()
  globalThis.setTimeout(() => URL.revokeObjectURL(href), 0)
}

export function downloadExport(filename: string, content: string, format: ExportFormat): void {
  downloadBlob(filename, new Blob([content], { type: format === 'markdown' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8' }))
}

export function previewExport(chapters: readonly ChapterExport[], title: string): Omit<PreparedExport, 'filename' | 'content' | 'format'> {
  const prepared = prepareExport(chapters, title, 'markdown')
  return { chapters: prepared.chapters, totalChars: prepared.totalChars }
}

function ExportPreviewDialog(props: {
  open?: boolean
  chapters: readonly ChapterExport[]
  title: string
  busy: boolean
  note?: string
  onCancel(): void
  onExport(format: ExportFormat): void
  returnFocusRef?: RefObject<HTMLElement | null>
}) {
  const open = props.open ?? true
  const cancel = useRef<HTMLButtonElement | null>(null)
  const shown = useRef({ chapters: props.chapters, title: props.title })
  if (open) shown.current = { chapters: props.chapters, title: props.title }
  const [packing, setPacking] = useState<'docx' | 'epub' | null>(null)
  const [packNote, setPackNote] = useState<string>()
  const preview = shown.current.chapters.length ? previewExport(shown.current.chapters, shown.current.title) : { chapters: [], totalChars: 0 }
  const empty = preview.chapters.filter((item) => item.empty)
  const busy = props.busy || packing !== null
  /* 章节收集是既有的不可取消异步操作:此时还没有章节,展示紧凑加载块,
     不渲染 0 摘要或可点的格式按钮;busy 结束后回到原预览/错误态。
     收集期间只用本次的 props.note:packNote 属于上一轮打包的完成/失败留言,
     弹窗常驻重用,不能盖住新一轮收集的 exportPreparing。 */
  const collecting = props.busy && preview.chapters.length === 0
  /* 打包一开始就清空 packNote,此刻 props.note 往往还是上一轮的"已生成/已就绪"
     完成留言:在途期间用它顶替,圆点也只配给这条真正的在途文案。 */
  const packingNote = packing ? t('workspace.exporting') : undefined
  const note = collecting ? props.note : packingNote ?? packNote ?? props.note
  const exportPacked = async (kind: 'docx' | 'epub') => {
    if (busy || !preview.chapters.length) return
    setPacking(kind)
    setPackNote(undefined)
    try {
      const book = buildBook(props.chapters, props.title)
      const blob = kind === 'docx' ? await buildDocxBlob(book) : await buildEpubBlob(book)
      const filename = `${sanitizeExportTitle(props.title)}.${kind}`
      downloadBlob(filename, blob)
      setPackNote(t('note.exportGenerated', { filename }))
    } catch (error) {
      setPackNote(error instanceof Error ? error.message : t('note.exportFailed'))
    } finally {
      setPacking(null)
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next: boolean) => { if (!next && !busy) props.onCancel() }}
      title={t('export.fullText')}
      className="file-dialog export-preview-dialog"
      overlayClassName="file-dialog-overlay"
      dismissible={!busy}
      initialFocusRef={cancel}
      returnFocusRef={props.returnFocusRef}>
      <header>
        <div>
          <small>
            {t('export.title')}
          </small>
          <h2 id="export-preview-title">
            {t('export.fullText')}
          </h2>
        </div>
      </header>
      {collecting ? <div className="export-loading">
        <ActivityRing size={24} />
        <ActivityText cue="none">
          {note || t('note.exportPreparing')}
        </ActivityText>
        <ActivitySkeleton lines={3} />
      </div> : null}
      {collecting ? null : <dl className="export-summary">
        <div>
          <dt>
            {t('export.chapters')}
          </dt>
          <dd>
            {preview.chapters.length}
          </dd>
        </div>
        <div>
          <dt>
            {t('export.totalChars')}
          </dt>
          <dd>
            {preview.totalChars}
          </dd>
        </div>
      </dl>}
      {empty.length ? <p className="warning" role="alert">
        {t('export.emptyWarning', { count: empty.length })}
      </p> : null}
      {note && !collecting ? <p
        className={/无法|失败|为空|empty|failed|cannot/i.test(note) ? 'warning' : 'muted'}
        role={/无法|失败|为空|empty|failed|cannot/i.test(note) ? 'alert' : 'status'}>
        {packingNote ? <ActivityDots /> : null}
        {note}
      </p> : null}
      {collecting ? null : <ol className="export-chapters">
        {preview.chapters.map((chapter, index) => <li key={chapter.path}>
          <span>
            {`${index + 1}. ${chapter.path}`}
          </span>
          <small>
            {`${t('export.chapterMeta', { chars: chapter.chars })}${chapter.empty ? t('export.chapterEmpty') : ''}`}
          </small>
        </li>)}
      </ol>}
      {collecting ? null : <footer>
        <Button ref={cancel} disabled={busy} onClick={props.onCancel}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="primary"
          className="primary-action"
          disabled={busy || !preview.chapters.length}
          onClick={() => props.onExport('markdown')}>
          {t('export.markdown')}
        </Button>
        <Button
          disabled={busy || !preview.chapters.length}
          onClick={() => props.onExport('text')}>
          {t('export.txt')}
        </Button>
        <Button
          disabled={busy || !preview.chapters.length}
          onClick={() => { void exportPacked('docx') }}>
          {packing === 'docx' ? <Fragment>
            <ActivityDots />
            {t('workspace.exporting')}
          </Fragment> : t('export.docx')}
        </Button>
        <Button
          disabled={busy || !preview.chapters.length}
          onClick={() => { void exportPacked('epub') }}>
          {packing === 'epub' ? <Fragment>
            <ActivityDots />
            {t('workspace.exporting')}
          </Fragment> : t('export.epub')}
        </Button>
      </footer>}
    </Dialog>
  );
}

export { ExportPreviewDialog }
