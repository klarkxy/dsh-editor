export type DocumentKind = 'chapter' | 'outline' | 'character' | 'world'

const chapterCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

export function sortChapterPaths(paths: readonly string[]): string[] {
  return paths
    .filter((path) => /^\u6b63\u6587\/.+\.(md|txt)$/i.test(path) && !path.split('/').some((part) => part.startsWith('.')))
    .sort((left, right) => chapterCollator.compare(left, right))
}

export function nextChapterPath(paths: readonly string[]): string {
  const next = paths.reduce((max, path) => {
    const match = /^正文\/(\d+)\.md$/i.exec(path)
    return match ? Math.max(max, Number(match[1])) : max
  }, 0) + 1
  return `正文/${String(next).padStart(3, '0')}.md`
}

function safeStem(title: string): string {
  const cleaned = title.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '').slice(0, 80)
  return cleaned || '未命名'
}

export function nextDocumentPath(kind: Exclude<DocumentKind, 'chapter'>, title: string, paths: readonly string[]): string {
  const directory = kind === 'outline' ? '大纲' : kind === 'character' ? '人物卡' : '世界书'
  const stem = safeStem(title)
  const taken = new Set(paths.map((path) => path.toLocaleLowerCase()))
  let suffix = 1
  let candidate = `${directory}/${stem}.md`
  while (taken.has(candidate.toLocaleLowerCase())) candidate = `${directory}/${stem}-${++suffix}.md`
  return candidate
}

export function documentTemplate(kind: DocumentKind, title: string): string {
  const heading = title.trim() || (kind === 'chapter' ? '新章节' : '未命名')
  if (kind === 'chapter') return `# ${heading}\n\n`
  if (kind === 'outline') return `# ${heading}\n\n## 目标\n\n## 关键事件\n\n## 待确认\n\n`
  if (kind === 'character') return `# ${heading}\n\n## 身份\n\n## 欲望与矛盾\n\n## 人物关系\n\n## 知情边界\n\n`
  return `# ${heading}\n\n## 已确认\n\n## 暂定\n\n## 连续性提醒\n\n`
}
