import { isAuxiliaryAuthorFile } from '../auxiliary-files.ts'
import { orderTreeEntries, type TreeEntry } from './shared.ts'

/** Same visibility rule as the manuscript tree: hide dotfiles and assistant config. */
export function visibleManuscriptEntries(entries: readonly TreeEntry[]): TreeEntry[] {
  return orderTreeEntries(entries).filter((item) => {
    if (item.name.startsWith('.')) return false
    return !isAuxiliaryAuthorFile(item.name)
  })
}

/** One real file at the workspace root does not need a navigation column. */
export function isSingleManuscriptRoot(entries: readonly TreeEntry[]): boolean {
  const visible = visibleManuscriptEntries(entries)
  return visible.length === 1 && visible[0]?.type === 'file'
}

export type SingleSidebarChoice = 'open' | 'closed' | null

export function singleSidebarStorageKey(workspaceId: string): string {
  return `dsh-editor.layout.sidebar-single.${workspaceId}`
}

export function readSingleSidebarChoice(workspaceId: string | undefined): SingleSidebarChoice {
  if (!workspaceId) return null
  try {
    const raw = globalThis.localStorage?.getItem(singleSidebarStorageKey(workspaceId))
    return raw === 'open' || raw === 'closed' ? raw : null
  } catch {
    return null
  }
}

export function writeSingleSidebarChoice(workspaceId: string | undefined, choice: 'open' | 'closed'): void {
  if (!workspaceId) return
  try { globalThis.localStorage?.setItem(singleSidebarStorageKey(workspaceId), choice) } catch { /* View preferences remain optional. */ }
}

/**
 * Collapse the file column only for a single root file, and only until the
 * author opens or closes it. Adding a second file restores a column that
 * this pass closed.
 */
export function sidebarAfterManuscriptCensus(input: {
  open: boolean
  autoCollapsed: boolean
  single: boolean
  explicit: SingleSidebarChoice
}): { open: boolean; autoCollapsed: boolean } {
  if (!input.single) {
    if (input.autoCollapsed) return { open: true, autoCollapsed: false }
    return { open: input.open, autoCollapsed: false }
  }
  if (input.explicit === 'open') return { open: true, autoCollapsed: false }
  if (input.explicit === 'closed') return { open: false, autoCollapsed: false }
  return { open: false, autoCollapsed: true }
}
