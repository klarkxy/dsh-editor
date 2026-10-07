function fileTitle(path: string): string {
  return (path.split('/').at(-1) ?? path).replace(/\.(md|txt)$/i, '')
}

export function readableDocumentTitle(path: string, text: string): string {
  const paper = text.replace(/^\uFEFF/, '')
  const closed = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(paper)
  const body = closed ? paper.slice(closed[0].length) : paper
  const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*$/m.exec(body)
  const name = heading?.[1]?.replace(/\s+/g, ' ').trim()
  return name || fileTitle(path)
}

export function rewriteSelectionExcerpt(text: string, limit = 72): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (compact.length <= limit) return compact
  return `${compact.slice(0, limit).trimEnd()}…`
}

export { saveOpenEditor, type EditorSaveBlockReason, type EditorSaveHandle as WrapUpHandle } from 'dsh-manuscript/client/editor-core'
