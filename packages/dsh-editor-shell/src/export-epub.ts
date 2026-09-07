import JSZip from 'jszip'
import type { ExportBook } from './export-book.ts'
import { documentLang, t } from './i18n/index.ts'

export type EpubExportOptions = {
  language?: string
  author?: string
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function chapterHref(index: number): string {
  return `chapter-${String(index + 1).padStart(3, '0')}.xhtml`
}

function chapterId(index: number): string {
  return `chap-${index + 1}`
}

const STYLESHEET = `body {
  font-family: "Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", "宋体", serif;
  line-height: 1.7;
}
h1 { font-size: 1.35em; font-weight: 700; text-indent: 0; margin: 1.2em 0 0.8em; }
p { text-indent: 2em; line-height: 1.7; margin: 0.4em 0; }
p.heading { font-weight: 700; text-indent: 0; margin: 1em 0 0.5em; }
`

function chapterXhtml(language: string, title: string, paragraphs: ExportBook['chapters'][number]['paragraphs']): string {
  const body = paragraphs.map((paragraph) => (
    `<p${paragraph.heading ? ' class="heading"' : ''}>${escapeXml(paragraph.text)}</p>`
  )).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXml(language)}" lang="${escapeXml(language)}">
<head>
  <title>${escapeXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
  <h1>${escapeXml(title)}</h1>
${body}
</body>
</html>
`
}

function containerXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`
}

function contentOpf(book: ExportBook, language: string, author: string | undefined, identifier: string): string {
  const manifestChapters = book.chapters.map((_, index) => (
    `    <item id="${chapterId(index)}" href="${chapterHref(index)}" media-type="application/xhtml+xml"/>`
  )).join('\n')
  const spine = book.chapters.map((_, index) => `    <itemref idref="${chapterId(index)}"/>`).join('\n')
  const creator = author ? `\n    <dc:creator>${escapeXml(author)}</dc:creator>` : ''
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id" version="3.0" xml:lang="${escapeXml(language)}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${escapeXml(identifier)}</dc:identifier>
    <dc:title>${escapeXml(book.title)}</dc:title>
    <dc:language>${escapeXml(language)}</dc:language>${creator}
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="styles.css" media-type="text/css"/>
${manifestChapters}
  </manifest>
  <spine toc="ncx">
${spine}
  </spine>
</package>
`
}

function navXhtml(book: ExportBook, language: string): string {
  const items = book.chapters.map((chapter, index) => (
    `      <li><a href="${chapterHref(index)}">${escapeXml(chapter.title)}</a></li>`
  )).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXml(language)}" lang="${escapeXml(language)}">
<head>
  <title>${escapeXml(book.title)}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>${escapeXml(t('export.toc'))}</h1>
    <ol>
${items}
    </ol>
  </nav>
</body>
</html>
`
}

function tocNcx(book: ExportBook, identifier: string): string {
  const points = book.chapters.map((chapter, index) => (
    `    <navPoint id="nav-${index + 1}" playOrder="${index + 1}">
      <navLabel><text>${escapeXml(chapter.title)}</text></navLabel>
      <content src="${chapterHref(index)}"/>
    </navPoint>`
  )).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${escapeXml(identifier)}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeXml(book.title)}</text></docTitle>
  <navMap>
${points}
  </navMap>
</ncx>
`
}

export async function buildEpubBlob(book: ExportBook, options: EpubExportOptions = {}): Promise<Blob> {
  const language = options.language?.trim() || documentLang()
  const author = options.author?.trim() || book.author
  const identifier = `urn:uuid:${globalThis.crypto.randomUUID()}`
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file('META-INF/container.xml', containerXml(), { compression: 'DEFLATE' })
  zip.file('OEBPS/content.opf', contentOpf(book, language, author, identifier), { compression: 'DEFLATE' })
  zip.file('OEBPS/nav.xhtml', navXhtml(book, language), { compression: 'DEFLATE' })
  zip.file('OEBPS/toc.ncx', tocNcx(book, identifier), { compression: 'DEFLATE' })
  zip.file('OEBPS/styles.css', STYLESHEET, { compression: 'DEFLATE' })
  book.chapters.forEach((chapter, index) => {
    zip.file(`OEBPS/${chapterHref(index)}`, chapterXhtml(language, chapter.title, chapter.paragraphs), { compression: 'DEFLATE' })
  })
  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/epub+zip',
    compression: 'DEFLATE',
  })
}
