import { createElement as e, Fragment, useRef, useState, type RefObject } from 'react'
import { ActivityDots, ActivityRing, ActivitySkeleton, ActivityText, Button, Dialog } from './ui/index.ts'
import { errorMessage, safeRpcCall, type RpcResult, type ShellContext } from './shared.ts'
import { prepareExport, sanitizeExportTitle, type ChapterExport, type ExportFormat, type PreparedExport } from '../export.ts'
import { buildBook } from '../export-book.ts'
import { buildDocxBlob } from '../export-docx.ts'
import { buildEpubBlob } from '../export-epub.ts'
import { t } from '../i18n/index.ts'

export async function collectChapters(ctx: ShellContext, sessionId: string): Promise<ChapterExport[]> {
  const queue = ['正文']
  const files: string[] = []
  while (queue.length) {
    const directory = queue.shift()!
    const listed = await safeRpcCall<{ entries?: { name: string; type: 'file' | 'directory' | 'other' }[] }>(() => ctx.connection.rpc.call('/manuscript', 'tree.list', {
      sessionId,
      path: directory,
    }))
    if (!listed.ok) throw new Error(errorMessage(listed))
    for (const entry of listed.value.entries ?? []) {
      const child = `${directory}/${entry.name}`
      if (entry.type === 'directory') queue.push(child)
      else if (entry.type === 'file' && /\.(?:md|txt)$/i.test(entry.name)) files.push(child)
    }
  }
  return await Promise.all(files.map(async (path) => {
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
  const note = collecting ? props.note : packNote ?? props.note
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
  return e(Dialog, {
    open,
    onOpenChange: (next: boolean) => { if (!next && !busy) props.onCancel() },
    title: t('export.fullText'),
    className: 'file-dialog export-preview-dialog',
    overlayClassName: 'file-dialog-overlay',
    dismissible: !busy,
    initialFocusRef: cancel,
    returnFocusRef: props.returnFocusRef,
  },
    e('header', null, e('div', null, e('small', null, t('export.title')), e('h2', { id: 'export-preview-title' }, t('export.fullText')))),
    collecting ? e('div', { className: 'export-loading' },
      e(ActivityRing, { size: 24 }),
      e(ActivityText, { cue: 'none' }, note || t('note.exportPreparing')),
      e(ActivitySkeleton, { lines: 3 }),
    ) : null,
    collecting ? null : e('dl', { className: 'export-summary' },
      e('div', null, e('dt', null, t('export.chapters')), e('dd', null, preview.chapters.length)),
      e('div', null, e('dt', null, t('export.totalChars')), e('dd', null, preview.totalChars)),
    ),
    empty.length ? e('p', { className: 'warning', role: 'alert' }, t('export.emptyWarning', { count: empty.length })) : null,
    note && !collecting ? e('p', { className: /无法|失败|为空|empty|failed|cannot/i.test(note) ? 'warning' : 'muted', role: /无法|失败|为空|empty|failed|cannot/i.test(note) ? 'alert' : 'status' }, busy ? e(ActivityDots, null) : null, note) : null,
    collecting ? null : e('ol', { className: 'export-chapters' }, preview.chapters.map((chapter, index) => e('li', { key: chapter.path },
      e('span', null, `${index + 1}. ${chapter.path}`),
      e('small', null, `${t('export.chapterMeta', { chars: chapter.chars })}${chapter.empty ? t('export.chapterEmpty') : ''}`),
    ))),
    collecting ? null : e('footer', null,
      e(Button, { ref: cancel, disabled: busy, onClick: props.onCancel }, t('common.cancel')),
      e(Button, { variant: 'primary', className: 'primary-action', disabled: busy || !preview.chapters.length, onClick: () => props.onExport('markdown') }, t('export.markdown')),
      e(Button, { disabled: busy || !preview.chapters.length, onClick: () => props.onExport('text') }, t('export.txt')),
      e(Button, { disabled: busy || !preview.chapters.length, onClick: () => { void exportPacked('docx') } }, packing === 'docx' ? e(Fragment, null, e(ActivityDots, null), t('workspace.exporting')) : t('export.docx')),
      e(Button, { disabled: busy || !preview.chapters.length, onClick: () => { void exportPacked('epub') } }, packing === 'epub' ? e(Fragment, null, e(ActivityDots, null), t('workspace.exporting')) : t('export.epub')),
    ),
  )
}

export { ExportPreviewDialog }
