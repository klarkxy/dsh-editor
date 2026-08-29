import type { ArchiveResponse } from 'dsh-editor-workbench/contracts'

export type ArchiveView = ArchiveResponse

export function documentName(path: string): string {
  const filename = path.split('/').at(-1) ?? path
  return filename.replace(/\.(md|txt)$/i, '')
}

export function archiveStateText(item: ArchiveView): string {
  if (item.state === 'archived') return '已归档'
  if (item.state === 'pending-archive') return '待继续归档'
  if (item.state === 'pending-restore') return '待继续恢复'
  if (item.state === 'restored') return '已恢复'
  return '需要检查'
}

export function visibleArchives(items: readonly ArchiveView[]): ArchiveView[] {
  return items.filter((item) => item.state !== 'restored')
}
