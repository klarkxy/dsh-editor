const pathCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

export function normalizeProjectDirectory(directory: string | null | undefined): string {
  const value = (directory ?? '').replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '')
  return !value || value === '.' ? '' : value
}

export function isHiddenProjectPath(path: string): boolean {
  return normalizeProjectDirectory(path).split('/').some((part) => part.startsWith('.'))
}

export function isVisibleTextPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/')
  return /\.(?:md|txt)$/i.test(normalized) && !isHiddenProjectPath(normalized)
}

const GENERATED_DIRECTORIES = new Set(['build', 'coverage', 'dist', 'node_modules', 'out', 'target'])

export function isChapterDocumentPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/')
  if (!isVisibleTextPath(normalized)) return false
  return !normalized.split('/').some((part) => GENERATED_DIRECTORIES.has(part.toLocaleLowerCase()))
}

export function documentDirectory(path: string | null | undefined): string {
  const normalized = normalizeProjectDirectory(path)
  const index = normalized.lastIndexOf('/')
  return index < 0 ? '' : normalized.slice(0, index)
}

/** Tree selection first (including project root), then the open document's folder, then the project root. */
export function defaultCreateDirectory(input: {
  treeDirectory?: string | null
  activePath?: string | null
}): string {
  if (input.treeDirectory !== undefined && input.treeDirectory !== null) {
    return normalizeProjectDirectory(input.treeDirectory)
  }
  if (input.activePath?.trim()) return documentDirectory(input.activePath)
  return ''
}

export function exportDirectoryOf(activePath: string | null | undefined): string {
  return documentDirectory(activePath)
}

export function searchPathInDirectory(path: string, directory: string): boolean {
  const root = normalizeProjectDirectory(directory)
  if (!root) return true
  const normalized = path.replace(/\\/g, '/')
  return normalized === root || normalized.startsWith(`${root}/`)
}

export function isAutoOpenDocumentPath(path: string): boolean {
  if (!isVisibleTextPath(path)) return false
  const base = path.split('/').pop() ?? path
  return !/^agents\.md$/i.test(base)
}

export function sortDocumentPaths(paths: readonly string[]): string[] {
  return paths
    .filter((path) => isVisibleTextPath(path))
    .sort((left, right) => pathCollator.compare(left, right))
}

/** Novel chapter ops still walk 正文/ in natural order. */
export function isManuscriptChapterPath(path: string): boolean {
  return /^正文\/.+\.(?:md|txt)$/i.test(path.replace(/\\/g, '/'))
}

export function sortChapterPaths(paths: readonly string[]): string[] {
  return sortDocumentPaths(paths).filter((path) => isManuscriptChapterPath(path))
}

export function firstOpenDocumentPath(paths: readonly string[]): string | undefined {
  return sortDocumentPaths(paths).find((path) => isAutoOpenDocumentPath(path))
}
