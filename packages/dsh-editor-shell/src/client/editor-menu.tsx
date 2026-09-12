import type { EditorCommandState } from 'dsh-manuscript/client/editor-core'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { t } from '../i18n/index.ts'
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from './ui/index.ts'

export type EditorMenuAction =
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'selectAll'
  | 'save'
  | 'find'
  | 'replace'
  | 'complete'
  | 'rewrite'
  | 'proofread'
  | 'chapterMeta'

export type EditorMenuModel = {
  state: EditorCommandState
  canChapterMeta: boolean
  canRewritePath: boolean
}

const ITEM = 'editor-menu-item'

export function EditorActionMenuItems(props: {
  model: EditorMenuModel
  onAction(action: EditorMenuAction): void
}) {
  const { state } = props.model
  const rewriteDisabled = !state.canRewrite || !props.model.canRewritePath
  return (
    <>
      <MenuLabel className="editor-menu-label">{t('editor.groupEdit')}</MenuLabel>
      <MenuItem className={ITEM} disabled={!state.canUndo} data-testid="editor-menu-undo" onSelect={() => props.onAction('undo')}>{t('editor.undo')}</MenuItem>
      <MenuItem className={ITEM} disabled={!state.canRedo} data-testid="editor-menu-redo" onSelect={() => props.onAction('redo')}>{t('editor.redo')}</MenuItem>
      <MenuItem className={ITEM} disabled={!state.canCut} data-testid="editor-menu-cut" onSelect={() => props.onAction('cut')}>{t('common.cut')}</MenuItem>
      <MenuItem className={ITEM} disabled={!state.canCopy} data-testid="editor-menu-copy" onSelect={() => props.onAction('copy')}>{t('common.copy')}</MenuItem>
      <MenuItem className={ITEM} disabled={!state.canPaste} data-testid="editor-menu-paste" onSelect={() => props.onAction('paste')}>{t('common.paste')}</MenuItem>
      <MenuItem className={ITEM} disabled={!state.canSelectAll} data-testid="editor-menu-select-all" onSelect={() => props.onAction('selectAll')}>{t('editor.selectAll')}</MenuItem>
      <MenuSeparator className="editor-menu-separator" aria-hidden="true" />
      <MenuLabel className="editor-menu-label">{t('editor.groupDocument')}</MenuLabel>
      <MenuItem className={ITEM} disabled={!state.canSave} data-testid="editor-menu-save" onSelect={() => props.onAction('save')}>{t('common.save')}</MenuItem>
      <MenuItem className={ITEM} disabled={!state.canFind} data-testid="editor-menu-find" onSelect={() => props.onAction('find')}>{t('editor.find')}</MenuItem>
      <MenuItem className={ITEM} disabled={!state.canReplace} data-testid="editor-menu-replace" onSelect={() => props.onAction('replace')}>{t('editor.replace')}</MenuItem>
      <MenuSeparator className="editor-menu-separator" aria-hidden="true" />
      <MenuLabel className="editor-menu-label">{t('editor.groupAssist')}</MenuLabel>
      <MenuItem className={ITEM} disabled={!state.canComplete} data-testid="editor-menu-complete" onSelect={() => props.onAction('complete')}>{t('editor.complete')}</MenuItem>
      <MenuItem className={ITEM} disabled={rewriteDisabled} data-testid="editor-menu-rewrite" onSelect={() => props.onAction('rewrite')}>{t('editor.rewrite')}</MenuItem>
      <MenuSeparator className="editor-menu-separator" aria-hidden="true" />
      <MenuItem className={ITEM} disabled={!props.model.canChapterMeta} data-testid="editor-menu-chapter-meta" onSelect={() => props.onAction('chapterMeta')}>{t('chapterMeta.title')}</MenuItem>
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
      <MenuTrigger
        className="editor-menu-trigger"
        title={t('editor.menu')}
        aria-label={t('editor.menu')}
        data-testid="paper-editor-menu-trigger"
      >
        ⋯
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
        <MenuTrigger className="sr-only" tabIndex={-1}>{t('editor.menu')}</MenuTrigger>
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
