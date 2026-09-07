import { orderedExportChapters, type ChapterExport } from './export.ts'
import { t } from './i18n/index.ts'

export type BookParagraph = { text: string; heading?: boolean }
export type BookChapter = { title: string; paragraphs: BookParagraph[] }
export type ExportBook = { title: string; author?: string; chapters: BookChapter[] }

function filenameTitle(path: string): string {
  const filename = path.split('/').at(-1) ?? path
  return filename.replace(/\.(md|txt)$/i, '') || filename
}

export function stripYamlFrontmatter(text: string): string {
  return text.replace(/^\uFEFF/, '').replace(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, '')
}

export function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
}

function headingText(line: string): { level: number; text: string } | undefined {
  const match = /^(#{1,6})[ \t]+(\S.*)$/.exec(line)
  if (!match) return
  return { level: match[1].length, text: stripInlineMarkdown(match[2].replace(/[ \t]+#+\s*$/, '').trim()) }
}

export function chapterToBookChapter(path: string, text: string): BookChapter {
  const lines = stripYamlFrontmatter(text).split(/\r?\n/)
  let title = ''
  const paragraphs: BookParagraph[] = []
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || /^-{3,}$/.test(line)) continue
    const heading = headingText(line)
    if (heading) {
      if (!title && heading.level === 1) {
        title = heading.text
        continue
      }
      if (heading.text) paragraphs.push({ text: heading.text, heading: true })
      continue
    }
    const plain = stripInlineMarkdown(line)
    if (plain) paragraphs.push({ text: plain })
  }
  return { title: title || filenameTitle(path), paragraphs }
}

export function buildBook(chapters: readonly ChapterExport[], workName: string, author?: string): ExportBook {
  const title = workName.trim() || t('export.untitled')
  const book: ExportBook = {
    title,
    chapters: orderedExportChapters(chapters).map((item) => chapterToBookChapter(item.path, item.text)),
  }
  if (author?.trim()) book.author = author.trim()
  return book
}
