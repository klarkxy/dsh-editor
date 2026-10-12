import { prepareExport, type ChapterExport, type ExportFormat, type PreparedExport } from '../export.ts'

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
