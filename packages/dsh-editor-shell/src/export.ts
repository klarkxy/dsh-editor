export type ChapterExport = { path: string; text: string }
export type ExportFormat = 'markdown' | 'text'

function pathOrder(a: ChapterExport, b: ChapterExport): number {
  const number = (value: string) => Number(/^正文\/(\d+)/.exec(value)?.[1] ?? Number.MAX_SAFE_INTEGER)
  return number(a.path) - number(b.path) || a.path.localeCompare(b.path, 'zh-CN', { numeric: true })
}

function projectTitle(value: string): string {
  return value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '') || '未命名作品'
}

export function buildExport(chapters: readonly ChapterExport[], title: string, format: ExportFormat): { filename: string; content: string } {
  const sorted = [...chapters].filter((item) => /^正文\/.*\.md$/i.test(item.path)).sort(pathOrder)
  if (!sorted.length) throw new Error('正文为空，暂时无法导出。')
  const name = projectTitle(title)
  if (format === 'markdown') {
    return { filename: `${name}-全文.md`, content: `# ${name}\n\n${sorted.map((item) => item.text.trim()).join('\n\n---\n\n')}\n` }
  }
  const content = sorted.map((item) => item.text
    .replace(/^#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*-{3,}[ \t]*$/gm, '')
    .trim())
    .join('\n\n')
  return { filename: `${name}-全文.txt`, content: `${content}\n` }
}
