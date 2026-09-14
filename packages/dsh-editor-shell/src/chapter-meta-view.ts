export function isChapterMetaPath(path: string): boolean {
  return /^正文\/.+\.md$/i.test(path)
}
