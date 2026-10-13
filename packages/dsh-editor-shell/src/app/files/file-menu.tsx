import type { MouseEvent as ReactMouseEvent } from 'react';
import { canPinPath } from '../../pinned-pane-view.ts'
import { fileMenuObjectKind, type FileMenuKind } from '../../project-files.ts'
import { t } from '../../i18n/index.ts'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../../ui/index.ts'

/*
 * 文件树右键菜单（spec §3）：按对象类型给菜单——正文章节、其他文本文档、
 * 图片与其他资料、目录；菜单固定在右键坐标弹出（隐藏触发器做锚点，
 * 视口边缘向内夹取）。删除统一 tone=danger 并走既有确认流程。
 */
export function FileContextMenu(props: {
  kind: FileMenuKind
  path: string
  x: number
  y: number
  canPaste: boolean
  onCreateFile(): void
  onCreateFolder(): void
  onExportDirectory(): void
  onOpen(): void
  onPreview(): void
  onCopy(): void
  onCut(): void
  onPaste(): void
  onRename(): void
  onDelete(): void
  onClose(): void
  onSplit(): void
  onMergePrevious(): void
  onMergeNext(): void
  canSplit: boolean
  canMergePrevious: boolean
  canMergeNext: boolean
  splitDisabledTitle: string
  mergePreviousDisabledTitle: string
  mergeNextDisabledTitle: string
  onPin(): void
  onUnpin(): void
  isPinned: boolean
  onDismissFocus?(): void
}) {
  const objectKind = fileMenuObjectKind(props.kind, props.path)
  const left = Math.max(8, Math.min(props.x, globalThis.innerWidth - 220))
  const top = Math.max(8, Math.min(props.y, globalThis.innerHeight - 400))
  return (
    <div
      style={{ position: 'fixed', left, top, width: 0, height: 0 }}
      onContextMenu={(event: ReactMouseEvent<HTMLDivElement>) => event.preventDefault()}>
      <Menu
        open={true}
        onOpenChange={(open: boolean) => { if (!open) { props.onClose(); props.onDismissFocus?.() } }}>
        <MenuTrigger>
          <button type="button" className="file-menu-anchor" tabIndex={-1} aria-hidden="true" />
        </MenuTrigger>
        <MenuContent
          className="file-context-menu"
          align="start"
          side="bottom"
          sideOffset={0}
          aria-label={t('sidebar.fileActions')}
          onCloseAutoFocus={(event: Event) => {
            event.preventDefault()
            props.onDismissFocus?.()
          }}>
          {objectKind === 'chapter' || objectKind === 'text' ? <>
            <MenuItem onSelect={() => props.onOpen()}>
              {t('common.open')}
            </MenuItem>
            {canPinPath(props.path) ? <MenuItem onSelect={() => (props.isPinned ? props.onUnpin() : props.onPin())}>
              {props.isPinned ? t('pin.unpin') : t('pin.beside')}
            </MenuItem> : null}
          </> : null}
          {objectKind === 'resource' ? <>
            <MenuItem onSelect={() => props.onPreview()}>
              {t('sidebar.previewResource')}
            </MenuItem>
          </> : null}
          {objectKind === 'directory' ? <>
            <MenuItem onSelect={() => props.onCreateFile()}>
              {t('sidebar.newDocument')}
            </MenuItem>
            <MenuItem onSelect={() => props.onCreateFolder()}>
              {t('sidebar.newFolder')}
            </MenuItem>
            <MenuItem onSelect={() => props.onExportDirectory()}>
              {t('sidebar.exportDirectory')}
            </MenuItem>
          </> : null}
          {objectKind === 'chapter' ? <>
            <MenuSeparator />
            <MenuItem
              disabled={!props.canSplit}
              title={props.canSplit ? undefined : props.splitDisabledTitle}
              onSelect={() => props.onSplit()}>
              {t('chapterOps.split')}
            </MenuItem>
            <MenuItem
              disabled={!props.canMergePrevious}
              title={props.canMergePrevious ? undefined : props.mergePreviousDisabledTitle}
              onSelect={() => props.onMergePrevious()}>
              {t('chapterOps.mergePrevious')}
            </MenuItem>
            <MenuItem
              disabled={!props.canMergeNext}
              title={props.canMergeNext ? undefined : props.mergeNextDisabledTitle}
              onSelect={() => props.onMergeNext()}>
              {t('chapterOps.mergeNext')}
            </MenuItem>
          </> : null}
          {objectKind !== 'resource' ? <MenuSeparator /> : null}
          <MenuItem onSelect={() => props.onRename()}>
            {t('common.rename')}
          </MenuItem>
          {objectKind === 'chapter' || objectKind === 'text' || objectKind === 'resource' ? <>
            <MenuItem onSelect={() => props.onCopy()}>
              {t('common.copy')}
            </MenuItem>
            <MenuItem onSelect={() => props.onCut()}>
              {t('common.cut')}
            </MenuItem>
          </> : null}
          {objectKind !== 'resource' ? <MenuItem
            disabled={!props.canPaste}
            onSelect={() => props.onPaste()}>
            {t('common.paste')}
          </MenuItem> : null}
          <MenuSeparator />
          <MenuItem tone="danger" onSelect={() => props.onDelete()}>
            {t('common.delete')}
          </MenuItem>
        </MenuContent>
      </Menu>
    </div>
  );
}
