import { isAuxiliaryAuthorFile } from './auxiliary-files.ts'
import { compareDocumentPaths } from './model/natural-order.ts'

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

/** Author-facing manuscript: visible text that is not an assistant/config file. */
export function isAuthorFacingDocumentPath(path: string): boolean {
  return isVisibleTextPath(path) && !isAuxiliaryAuthorFile(path)
}

const GENERATED_DIRECTORIES = new Set(['build', 'coverage', 'dist', 'node_modules', 'out', 'target'])

export function isChapterDocumentPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/')
  if (!isAuthorFacingDocumentPath(normalized)) return false
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
  return isAuthorFacingDocumentPath(path)
}

export function sortDocumentPaths(paths: readonly string[]): string[] {
  return paths
    .filter((path) => isVisibleTextPath(path))
    .sort(compareDocumentPaths)
}

/** Novel chapter ops still walk 正文/ in natural order. */
export function isManuscriptChapterPath(path: string): boolean {
  return /^正文\/.+\.(?:md|txt)$/i.test(path.replace(/\\/g, '/'))
}

const IMAGE_PATH_PATTERN = /\.(?:jpe?g|png|gif|webp|avif|svg)$/i
const OFFICE_PATH_PATTERN = /\.(?:docx?|pptx?|xlsx?|csv|tsv)$/i
const PDF_PATH_PATTERN = /\.pdf$/i

/** Tree rows with an image extension open the lightbox preview instead of the text editor. */
export function isImagePath(path: string): boolean {
  return IMAGE_PATH_PATTERN.test(path)
}

/** 图片、PDF、Office 文档走资料栏预览而不是编辑器（与树行的点击分流一致）。 */
export function isPreviewableResourcePath(path: string): boolean {
  return isImagePath(path) || PDF_PATH_PATTERN.test(path) || OFFICE_PATH_PATTERN.test(path)
}

export type FileMenuKind = 'file' | 'directory'

/** 右键菜单按对象类型分（spec §3）：正文章节、其他文本文档、图片与其他资料、目录。 */
export type FileMenuObjectKind = 'chapter' | 'text' | 'resource' | 'directory'

export function fileMenuObjectKind(kind: FileMenuKind, path: string): FileMenuObjectKind {
  if (kind === 'directory') return 'directory'
  if (isManuscriptChapterPath(path)) return 'chapter'
  if (isVisibleTextPath(path)) return 'text'
  return 'resource'
}

/** 树行图标按文件类型分：图片 / PDF / Office / 其他（含文本文档）。 */
export type FileIconKind = 'image' | 'pdf' | 'office' | 'file'

export function fileIconKind(path: string): FileIconKind {
  if (isImagePath(path)) return 'image'
  if (PDF_PATH_PATTERN.test(path)) return 'pdf'
  if (OFFICE_PATH_PATTERN.test(path)) return 'office'
  return 'file'
}

/** .md/.txt 只在显示层去掉扩展名（spec §3），路径与 title 保持原名。 */
export function displayTreeFileName(name: string): string {
  return name.replace(/\.(?:md|txt)$/i, '')
}

export function sortChapterPaths(paths: readonly string[]): string[] {
  return sortDocumentPaths(paths).filter((path) => isManuscriptChapterPath(path))
}

export function firstOpenDocumentPath(paths: readonly string[]): string | undefined {
  return sortDocumentPaths(paths).find((path) => isAutoOpenDocumentPath(path))
}
