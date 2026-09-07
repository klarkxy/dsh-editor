import { stripChapterFrontmatter } from 'dsh-editor-workbench/contracts'
import { t } from './i18n/index.ts'
import { sortChapterPaths } from './project-files.ts'

export type ChapterExport = { path: string; text: string }
export type ExportFormat = 'markdown' | 'text'
export type ExportChapterPreview = { path: string; chars: number; empty: boolean }
export type PreparedExport = {
  filename: string
  content: string
  format: ExportFormat
  chapters: ExportChapterPreview[]
  totalChars: number
}

export function sanitizeExportTitle(value: string): string {
  return value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '') || t('export.untitled')
}

export function orderedExportChapters(chapters: readonly ChapterExport[]): ChapterExport[] {
  const byPath = new Map(chapters
    .filter((item) => /^正文\/.*\.(?:md|txt)$/i.test(item.path))
    .map((item) => [item.path, item] as const))
  const sorted = sortChapterPaths([...byPath.keys()]).map((path) => byPath.get(path)!)
  if (!sorted.length) throw new Error(t('export.emptyError'))
  return sorted
}

function withoutLeadingHeading(text: string): string {
  return text.replace(/^\uFEFF/, '').replace(/^\s*#\s+[^\r\n]*(?:\r?\n|$)/, '')
}

export function chapterExportChars(text: string): number {
  return text.replace(/\s/g, '').length
}

export function chapterExportEmpty(text: string): boolean {
  return withoutLeadingHeading(text).trim().length === 0
}

function chapterExportText(path: string, text: string): string {
  return /\.md$/i.test(path) ? stripChapterFrontmatter(text) : text
}

export function prepareExport(chapters: readonly ChapterExport[], title: string, format: ExportFormat): PreparedExport {
  const sorted = orderedExportChapters(chapters).map((item) => ({ ...item, text: chapterExportText(item.path, item.text) }))
  const name = sanitizeExportTitle(title)
  const preview = sorted.map((item) => ({ path: item.path, chars: chapterExportChars(item.text), empty: chapterExportEmpty(item.text) }))
  const totalChars = preview.reduce((sum, item) => sum + item.chars, 0)
  if (format === 'markdown') {
    return { filename: t('export.filenameMarkdown', { name }), content: `# ${name}\n\n${sorted.map((item) => item.text.trim()).join('\n\n---\n\n')}\n`, format, chapters: preview, totalChars }
  }
  const content = sorted.map((item) => item.text
    .replace(/^#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*-{3,}[ \t]*$/gm, '')
    .trim())
    .join('\n\n')
  return { filename: t('export.filenameText', { name }), content: `${content}\n`, format, chapters: preview, totalChars }
}

export function buildExport(chapters: readonly ChapterExport[], title: string, format: ExportFormat): { filename: string; content: string } {
  const prepared = prepareExport(chapters, title, format)
  return { filename: prepared.filename, content: prepared.content }
}
