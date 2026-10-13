import type { MouseEvent as ReactMouseEvent } from 'react'
import { t } from '../i18n/index.ts'
import type { EditorMenuAction, EditorMenuModel } from '../model/editor-menu.ts'
import {
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
} from '../ui/index.ts'
import { DotsIcon } from './icons.tsx'


const ITEM = 'editor-menu-item'

/* §4 稿纸菜单：补全/改写/查资料/选中段落/钉在旁边，「编辑」子菜单，查找/替换。 */
export function EditorActionMenuItems(props: {
  model: EditorMenuModel
  onAction(action: EditorMenuAction): void
}) {
  const { state } = props.model
  const rewriteDisabled = !state.canRewrite || !props.model.canRewritePath
  return (
    <>
      <MenuItem className={ITEM} disabled={!state.canComplete} data-testid="editor-menu-complete" shortcut="Ctrl+Enter" onSelect={() => props.onAction('complete')}>{t('editor.complete')}</MenuItem>
      <MenuItem className={ITEM} disabled={rewriteDisabled} data-testid="editor-menu-rewrite" onSelect={() => props.onAction('rewrite')}>{t('editor.rewrite')}</MenuItem>
      <MenuItem className={ITEM} disabled={!props.model.canLookupReferences} data-testid="editor-menu-lookup-references" onSelect={() => props.onAction('lookupReferences')}>{t('reference.title')}</MenuItem>
      <MenuItem className={ITEM} disabled={!props.model.canSelectParagraph} data-testid="editor-menu-select-paragraph" onSelect={() => props.onAction('selectParagraph')}>{t('editor.selectParagraph')}</MenuItem>
      <MenuItem className={ITEM} disabled={!props.model.canPin} data-testid="editor-menu-pin" onSelect={() => props.onAction('pin')}>{t('reference.pin')}</MenuItem>
      <MenuSeparator className="editor-menu-separator" />
      <MenuSub>
        <MenuSubTrigger className={ITEM} data-testid="editor-menu-edit">{t('common.edit')}</MenuSubTrigger>
        <MenuSubContent aria-label={t('common.edit')}>
          <MenuItem className={ITEM} disabled={!state.canUndo} data-testid="editor-menu-undo" shortcut="Ctrl+Z" onSelect={() => props.onAction('undo')}>{t('editor.undo')}</MenuItem>
          <MenuItem className={ITEM} disabled={!state.canRedo} data-testid="editor-menu-redo" shortcut="Ctrl+Y" onSelect={() => props.onAction('redo')}>{t('editor.redo')}</MenuItem>
          <MenuItem className={ITEM} disabled={!state.canCut} data-testid="editor-menu-cut" shortcut="Ctrl+X" onSelect={() => props.onAction('cut')}>{t('common.cut')}</MenuItem>
          <MenuItem className={ITEM} disabled={!state.canCopy} data-testid="editor-menu-copy" shortcut="Ctrl+C" onSelect={() => props.onAction('copy')}>{t('common.copy')}</MenuItem>
          <MenuItem className={ITEM} disabled={!state.canPaste} data-testid="editor-menu-paste" shortcut="Ctrl+V" onSelect={() => props.onAction('paste')}>{t('common.paste')}</MenuItem>
          <MenuItem className={ITEM} disabled={!state.canSelectAll} data-testid="editor-menu-select-all" shortcut="Ctrl+A" onSelect={() => props.onAction('selectAll')}>{t('editor.selectAll')}</MenuItem>
        </MenuSubContent>
      </MenuSub>
      <MenuItem className={ITEM} disabled={!state.canFind} data-testid="editor-menu-find" shortcut="Ctrl+F" onSelect={() => props.onAction('find')}>{t('editor.find')}</MenuItem>
      <MenuItem className={ITEM} disabled={!state.canReplace} data-testid="editor-menu-replace" shortcut="Ctrl+H" onSelect={() => props.onAction('replace')}>{t('editor.replace')}</MenuItem>
    </>
  )
}

export function EditorOverflowMenu(props: {
  open: boolean
  onOpenChange(open: boolean): void
  model: EditorMenuModel
  onAction(action: EditorMenuAction): void
  onCloseAutoFocus?(event: Event): void
}) {
  return (
    <Menu open={props.open} onOpenChange={props.onOpenChange}>
      <MenuTrigger>
        <IconButton
          className="paper-menu-trigger"
          label={t('editor.menu')}
          data-testid="paper-editor-menu-trigger"
        >
          <DotsIcon size={14} />
        </IconButton>
      </MenuTrigger>
      <MenuContent
        className="editor-action-menu"
        align="end"
        side="bottom"
        aria-label={t('editor.menu')}
        onCloseAutoFocus={props.onCloseAutoFocus}
      >
        <EditorActionMenuItems model={props.model} onAction={props.onAction} />
      </MenuContent>
    </Menu>
  )
}

export function EditorContextMenu(props: {
  x: number
  y: number
  model: EditorMenuModel
  onAction(action: EditorMenuAction): void
  onClose(): void
  onCloseAutoFocus?(event: Event): void
}) {
  const left = Math.max(8, Math.min(props.x, (globalThis.innerWidth || 800) - 16))
  const top = Math.max(8, Math.min(props.y, (globalThis.innerHeight || 600) - 16))
  return (
    <div
      style={{ position: 'fixed', left, top, width: 0, height: 0 }}
      onContextMenu={(event: ReactMouseEvent<HTMLDivElement>) => event.preventDefault()}
    >
      <Menu open onOpenChange={(open) => { if (!open) props.onClose() }}>
        <MenuTrigger>
          <button type="button" className="sr-only" tabIndex={-1}>{t('editor.menu')}</button>
        </MenuTrigger>
        <MenuContent
          className="editor-action-menu"
          align="start"
          side="bottom"
          sideOffset={0}
          aria-label={t('editor.menu')}
          onCloseAutoFocus={props.onCloseAutoFocus}
        >
          <EditorActionMenuItems model={props.model} onAction={props.onAction} />
        </MenuContent>
      </Menu>
    </div>
  )
}
