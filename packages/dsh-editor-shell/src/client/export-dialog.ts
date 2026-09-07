import { createElement as e, useState } from 'react'
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
  chapters: readonly ChapterExport[]
  title: string
  busy: boolean
  note?: string
  onCancel(): void
  onExport(format: ExportFormat): void
}) {
  const [packing, setPacking] = useState<'docx' | 'epub' | null>(null)
  const [packNote, setPackNote] = useState<string>()
  const preview = props.chapters.length ? previewExport(props.chapters, props.title) : { chapters: [], totalChars: 0 }
  const empty = preview.chapters.filter((item) => item.empty)
  const busy = props.busy || packing !== null
  const note = packNote ?? props.note
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
  return e('div', { className: 'file-dialog-overlay', role: 'presentation' },
    e('section', { className: 'file-dialog export-preview-dialog', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'export-preview-title' },
      e('header', null, e('div', null, e('small', null, t('export.title')), e('h2', { id: 'export-preview-title' }, t('export.fullText')))),
      e('dl', { className: 'export-summary' },
        e('div', null, e('dt', null, t('export.chapters')), e('dd', null, preview.chapters.length)),
        e('div', null, e('dt', null, t('export.totalChars')), e('dd', null, preview.totalChars)),
      ),
      empty.length ? e('p', { className: 'warning', role: 'alert' }, t('export.emptyWarning', { count: empty.length })) : null,
      note ? e('p', { className: /无法|失败|为空|empty|failed|cannot/i.test(note) ? 'warning' : 'muted', role: /无法|失败|为空|empty|failed|cannot/i.test(note) ? 'alert' : 'status' }, note) : null,
      e('ol', { className: 'export-chapters' }, preview.chapters.map((chapter, index) => e('li', { key: chapter.path },
        e('span', null, `${index + 1}. ${chapter.path}`),
        e('small', null, `${t('export.chapterMeta', { chars: chapter.chars })}${chapter.empty ? t('export.chapterEmpty') : ''}`),
      ))),
      e('footer', null,
        e('button', { type: 'button', disabled: busy, onClick: props.onCancel }, t('common.cancel')),
        e('button', { className: 'primary-action', type: 'button', disabled: busy || !preview.chapters.length, onClick: () => props.onExport('markdown') }, props.busy ? t('workspace.exporting') : t('export.markdown')),
        e('button', { type: 'button', disabled: busy || !preview.chapters.length, onClick: () => props.onExport('text') }, t('export.txt')),
        e('button', { type: 'button', disabled: busy || !preview.chapters.length, onClick: () => { void exportPacked('docx') } }, packing === 'docx' ? t('workspace.exporting') : t('export.docx')),
        e('button', { type: 'button', disabled: busy || !preview.chapters.length, onClick: () => { void exportPacked('epub') } }, packing === 'epub' ? t('workspace.exporting') : t('export.epub')),
      ),
    ),
  )
}

export { ExportPreviewDialog }
