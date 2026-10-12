import type { PanelSize } from 'react-resizable-panels'

export type FileMenuKind = 'file' | 'directory'

export type SidebarFileMenuProps = {
  onOpen(path: string): void
  onPreviewImage(path: string): void
  onFileMenu(kind: FileMenuKind, path: string, position: { x: number; y: number }, trigger?: HTMLElement | null): void
  onCreateFile(directory: string): void
  onCreateFolder(directory: string): void
  onMove(source: { kind: FileMenuKind; path: string }, targetDir: string): void
}

export const panelPixels = (size: PanelSize): number => Math.round(size.inPixels)
