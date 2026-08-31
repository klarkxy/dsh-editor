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

function projectTitle(value: string): string {
  return value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '') || '未命名作品'
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

export function prepareExport(chapters: readonly ChapterExport[], title: string, format: ExportFormat): PreparedExport {
  const byPath = new Map(chapters
    .filter((item) => /^正文\/.*\.(?:md|txt)$/i.test(item.path))
    .map((item) => [item.path, item] as const))
  const sorted = sortChapterPaths([...byPath.keys()]).map((path) => byPath.get(path)!)
  if (!sorted.length) throw new Error('正文为空，无法导出。请先创建正文章节。')
  const name = projectTitle(title)
  const preview = sorted.map((item) => ({ path: item.path, chars: chapterExportChars(item.text), empty: chapterExportEmpty(item.text) }))
  const totalChars = preview.reduce((sum, item) => sum + item.chars, 0)
  if (format === 'markdown') {
    return { filename: `${name}-全文.md`, content: `# ${name}\n\n${sorted.map((item) => item.text.trim()).join('\n\n---\n\n')}\n`, format, chapters: preview, totalChars }
  }
  const content = sorted.map((item) => item.text
    .replace(/^#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*-{3,}[ \t]*$/gm, '')
    .trim())
    .join('\n\n')
  return { filename: `${name}-全文.txt`, content: `${content}\n`, format, chapters: preview, totalChars }
}

export function buildExport(chapters: readonly ChapterExport[], title: string, format: ExportFormat): { filename: string; content: string } {
  const prepared = prepareExport(chapters, title, format)
  return { filename: prepared.filename, content: prepared.content }
}
