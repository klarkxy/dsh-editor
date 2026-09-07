import { AlignmentType, Document, HeadingLevel, LineRuleType, Packer, Paragraph, SectionType, TextRun, type IFontAttributesProperties } from 'docx'
import type { BookParagraph, ExportBook } from './export-book.ts'

export type DocxExportOptions = {
  fontFamily?: string
  fontSizePt?: number
  firstLineIndent?: boolean
  pageBreakBetweenChapters?: boolean
}

export type DocxParagraphModel = {
  text: string
  style: 'Title' | 'Heading1' | 'Normal'
  bold?: boolean
  pageBreakBefore?: boolean
  firstLineIndent?: boolean
}

export type DocxDocumentModel = {
  title: string
  author?: string
  fontFamily: string
  eastAsiaFont: string
  fontSizePt: number
  lineSpacing: 1.5
  firstLineIndent: boolean
  pageBreakBetweenChapters: boolean
  sections: { paragraphs: DocxParagraphModel[] }[]
}

const DEFAULT_LATIN_FONT = 'Noto Serif CJK SC'
const DEFAULT_EAST_ASIA_FONT = '宋体'
const DEFAULT_FONT_SIZE_PT = 12

function resolveFonts(fontFamily?: string): { latin: string; eastAsia: string } {
  const named = fontFamily?.trim()
  if (!named) return { latin: DEFAULT_LATIN_FONT, eastAsia: DEFAULT_EAST_ASIA_FONT }
  if (named === DEFAULT_EAST_ASIA_FONT || named === DEFAULT_LATIN_FONT) {
    return { latin: DEFAULT_LATIN_FONT, eastAsia: DEFAULT_EAST_ASIA_FONT }
  }
  return { latin: named, eastAsia: named }
}

function fontAttrs(latin: string, eastAsia: string): IFontAttributesProperties {
  return { ascii: latin, hAnsi: latin, eastAsia, cs: eastAsia, hint: 'eastAsia' }
}

export function buildDocxModel(book: ExportBook, options: DocxExportOptions = {}): DocxDocumentModel {
  const fonts = resolveFonts(options.fontFamily)
  const fontSizePt = options.fontSizePt ?? DEFAULT_FONT_SIZE_PT
  const firstLineIndent = options.firstLineIndent !== false
  const pageBreakBetweenChapters = options.pageBreakBetweenChapters !== false
  const titlePage: DocxParagraphModel[] = [
    { text: book.title, style: 'Title' },
    ...(book.author ? [{ text: book.author, style: 'Normal' as const }] : []),
  ]
  const chapterBlocks: DocxParagraphModel[][] = book.chapters.map((chapter) => [
    { text: chapter.title, style: 'Heading1' },
    ...chapter.paragraphs.map((paragraph: BookParagraph): DocxParagraphModel => (
      paragraph.heading
        ? { text: paragraph.text, style: 'Normal', bold: true }
        : { text: paragraph.text, style: 'Normal', firstLineIndent }
    )),
  ])
  const sections = pageBreakBetweenChapters
    ? [{ paragraphs: titlePage }, ...chapterBlocks.map((paragraphs) => ({ paragraphs }))]
    : [{ paragraphs: [...titlePage, ...chapterBlocks.flat()] }]
  return {
    title: book.title,
    author: book.author,
    fontFamily: fonts.latin,
    eastAsiaFont: fonts.eastAsia,
    fontSizePt,
    lineSpacing: 1.5,
    firstLineIndent,
    pageBreakBetweenChapters,
    sections,
  }
}

function runFor(model: DocxDocumentModel, text: string, extra?: { bold?: boolean; sizePt?: number }) {
  return new TextRun({
    text,
    bold: extra?.bold,
    size: Math.round((extra?.sizePt ?? model.fontSizePt) * 2),
    font: fontAttrs(model.fontFamily, model.eastAsiaFont),
  })
}

export function buildDocxDocument(book: ExportBook, options?: DocxExportOptions): Document {
  const model = buildDocxModel(book, options)
  const size = model.fontSizePt * 2
  const font = fontAttrs(model.fontFamily, model.eastAsiaFont)
  return new Document({
    title: model.title,
    creator: model.author,
    styles: {
      default: {
        document: {
          run: { font, size },
          paragraph: { spacing: { line: 360, lineRule: LineRuleType.AUTO } },
        },
        title: {
          paragraph: { alignment: AlignmentType.CENTER, spacing: { after: 240 } },
          run: { font, size: Math.round(model.fontSizePt * 2 * 2), bold: true },
        },
        heading1: {
          paragraph: { spacing: { before: 240, after: 160 } },
          run: { font, size: Math.round(model.fontSizePt * 2 * 1.3), bold: true },
        },
      },
    },
    sections: model.sections.map((section, index) => ({
      properties: index > 0 && model.pageBreakBetweenChapters ? { type: SectionType.NEXT_PAGE } : undefined,
      children: section.paragraphs.map((paragraph) => new Paragraph({
        heading: paragraph.style === 'Title' ? HeadingLevel.TITLE
          : paragraph.style === 'Heading1' ? HeadingLevel.HEADING_1
            : undefined,
        alignment: paragraph.style === 'Title' ? AlignmentType.CENTER : undefined,
        pageBreakBefore: paragraph.pageBreakBefore || undefined,
        indent: paragraph.firstLineIndent ? { firstLineChars: 200 } : undefined,
        children: [runFor(model, paragraph.text, {
          bold: paragraph.bold,
          sizePt: paragraph.style === 'Title' ? model.fontSizePt * 2 : paragraph.style === 'Heading1' ? model.fontSizePt * 1.3 : undefined,
        })],
      })),
    })),
  })
}

export async function buildDocxBlob(book: ExportBook, options?: DocxExportOptions): Promise<Blob> {
  return Packer.toBlob(buildDocxDocument(book, options))
}
