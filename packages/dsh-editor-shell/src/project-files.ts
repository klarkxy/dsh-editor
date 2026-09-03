const chapterCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

export function sortChapterPaths(paths: readonly string[]): string[] {
  return paths
    .filter((path) => /^正文\/.+\.(md|txt)$/i.test(path) && !path.split('/').some((part) => part.startsWith('.')))
    .sort((left, right) => chapterCollator.compare(left, right))
}
