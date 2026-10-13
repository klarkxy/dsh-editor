import { memo, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { ShellContext } from '../../client/shared.ts'
import { isSuccessWorkbenchNote } from '../../client/shared.ts'
import { SearchPanel } from '../../client/search-panel.tsx'
import type { ReplaceOutcome, SearchHit, SearchScope } from '../../model/search-panel.ts'
import type { FileMenuKind } from '../../project-files.ts'
import { t, useLocale } from '../../i18n/index.ts'
import {
  isImeEvent,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Notice,
  SearchField,
  Tab,
  TabList,
  TabPanel,
  Tabs,
} from '../../ui/index.ts'
import { DotsIcon, PlusIcon } from '../../ui/icons.tsx'
import { Tree } from './tree.tsx'
import './files-rail.styles.ts'

/* 文件栏（shell-rewrite-spec §3）：栏头是「文件／搜索」Tabs 加新建与更多两个
   菜单按钮；文件页放提示条与目录树，搜索页放跨文件搜索（独立页签，不把树
   往下推）。树与搜索页都 forceMount，切页不丢展开态与搜索结果。 */

type FilesRailProps = {
  ctx: ShellContext
  sessionId: string
  searchOpen: boolean
  searchQuery: string
  onSearchQueryChange(value: string): void
  searchScope: SearchScope
  onSearchScopeChange(value: SearchScope): void
  replaceOutcome: ReplaceOutcome | null
  onReplaceOutcomeChange(identity: string, outcome: ReplaceOutcome | null): void
  replaceBusy: boolean
  onReplaceBusyChange(busy: boolean): void
  onSearchRequestOpen(): void
  onSearchRequestClose(): void
  onOpenDocument(path: string, hit?: SearchHit): void
  onSearchReplaced(sessionId: string, paths: string[]): void
  activePath: string
  activeDirty: boolean
  fileRevision: number
  historyOpen: boolean
  snapshotBusy: boolean
  onCommitSnapshot(): void
  onOpenHistory(): void
  createNote: string
  workspaceWarning: string | undefined
  workbenchNote: string
  expandPath: string
  highlightPath?: string
  menuTargetPath?: string
  onOpen(path: string): void
  onPreviewImage(path: string): void
  onFileMenu(kind: FileMenuKind, path: string, position: { x: number; y: number }, trigger?: HTMLElement | null): void
  onCreateFile(directory: string): void
  onCreateFolder(directory: string): void
  onMove(source: { kind: FileMenuKind; path: string }, targetDir: string): void
}

export const FilesRail = memo(function FilesRail(props: FilesRailProps) {
  /* Search draft and write lock live in Root so switching narrow/wide rails retains them. */
  const [searchSubmitTick, setSearchSubmitTick] = useState(0)
  const [composing, setComposing] = useState(false)
  const searchInput = useRef<HTMLInputElement | null>(null)
  const mountedDuringReplace = useRef(props.replaceBusy).current
  useEffect(() => { if (props.searchOpen) searchInput.current?.focus() }, [props.searchOpen])
  const closeSearch = () => { if (props.replaceBusy) return; props.onSearchQueryChange(''); props.onSearchRequestClose() }
  const tab = props.searchOpen ? 'search' : 'files'
  useLocale()
  return (
    <section className="dsh-files-rail" aria-label={t('workspace.files')}>
      <Tabs
        className="dsh-files-rail__tabs"
        value={tab}
        onValueChange={(next) => {
          if (next === tab) return
          if (next === 'search') props.onSearchRequestOpen()
          else closeSearch()
        }}>
        <div className="dsh-files-rail__head">
          <TabList aria-label={t('workspace.files')}>
            <Tab value="files">{t('workspace.files')}</Tab>
            <Tab value="search">{t('sidebar.search')}</Tab>
          </TabList>
          <div className="dsh-files-rail__actions">
            <Menu>
              <MenuTrigger>
                <button
                  type="button"
                  className="dsh-icon-button dsh-files-rail__create"
                  data-size="sm"
                  aria-label={t('files.create')}
                  title={t('files.create')}>
                  <PlusIcon size="sm" />
                </button>
              </MenuTrigger>
              <MenuContent align="end" aria-label={t('files.create')}>
                <MenuItem onSelect={() => props.onCreateFile('')}>
                  {t('sidebar.newDocument')}
                </MenuItem>
                <MenuItem onSelect={() => props.onCreateFolder('')}>
                  {t('sidebar.newFolder')}
                </MenuItem>
              </MenuContent>
            </Menu>
            <Menu>
              <MenuTrigger>
                <button
                  type="button"
                  className="dsh-icon-button dsh-files-rail__more"
                  data-size="sm"
                  aria-label={t('files.more')}
                  title={t('files.more')}>
                  <DotsIcon size="sm" />
                </button>
              </MenuTrigger>
              <MenuContent align="end" aria-label={t('files.more')}>
                <MenuItem
                  disabled={props.snapshotBusy}
                  title={t('workspace.commitTitle')}
                  onSelect={() => props.onCommitSnapshot()}>
                  {t('workspace.commit')}
                </MenuItem>
                <MenuItem
                  checked={props.historyOpen}
                  title={t('workspace.commitHistory')}
                  onSelect={() => props.onOpenHistory()}>
                  {t('common.history')}
                </MenuItem>
              </MenuContent>
            </Menu>
          </div>
        </div>
        <TabPanel value="files" forceMount className="dsh-files-rail__panel dsh-files-rail__files">
          {props.workspaceWarning ? <Notice tone="warning" className="dsh-files-rail__notice" role="status">
            {props.workspaceWarning}
          </Notice> : null}
          {props.createNote ? <Notice tone="danger" className="dsh-files-rail__notice">
            {props.createNote}
          </Notice> : null}
          {props.workbenchNote ? <Notice
            tone={isSuccessWorkbenchNote(props.workbenchNote) ? 'success' : 'danger'}
            className="dsh-files-rail__notice">
            {props.workbenchNote}
          </Notice> : null}
          <Tree
            ctx={props.ctx}
            sessionId={props.sessionId}
            active={props.activePath}
            expandPath={props.expandPath}
            highlightPath={props.highlightPath}
            menuTargetPath={props.menuTargetPath}
            onOpen={props.onOpen}
            onPreviewImage={props.onPreviewImage}
            onFileMenu={props.onFileMenu}
            onCreateFile={props.onCreateFile}
            onCreateFolder={props.onCreateFolder}
            onMove={props.onMove}
            revision={props.fileRevision} />
        </TabPanel>
        <TabPanel value="search" forceMount className="dsh-files-rail__panel dsh-files-rail__search">
          <SearchField
            ref={searchInput}
            data-workspace-search=""
            className="dsh-files-rail__search-field"
            size="sm"
            value={props.searchQuery}
            disabled={props.replaceBusy}
            maxLength={120}
            placeholder={t('search.placeholder')}
            aria-label={t('search.aria')}
            title={t('workspace.searchTitle')}
            clearLabel={t('search.close')}
            onClear={closeSearch}
            onChange={(value: string) => {
              if (props.replaceBusy) return
              props.onSearchQueryChange(value)
              if (value.trim()) props.onSearchRequestOpen()
            }}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
            onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
              if (props.replaceBusy) return
              if (event.key === 'Escape') { closeSearch(); return }
              if (event.key !== 'Enter') return
              if (isImeEvent({ isComposing: event.nativeEvent.isComposing, keyCode: event.nativeEvent.keyCode })) {
                event.preventDefault()
                return
              }
              props.onSearchRequestOpen()
              setSearchSubmitTick((tick) => tick + 1)
            }} />
          {props.searchOpen && !(mountedDuringReplace && props.replaceBusy) ? <fieldset disabled={props.replaceBusy} className="dsh-files-rail__search-panel"><SearchPanel
            ctx={props.ctx}
            sessionId={props.sessionId}
            revision={props.fileRevision}
            query={props.searchQuery}
            onQueryChange={props.onSearchQueryChange}
            scope={props.searchScope}
            onScopeChange={props.onSearchScopeChange}
            outcome={props.replaceOutcome}
            onOutcomeChange={props.onReplaceOutcomeChange}
            submitTick={searchSubmitTick}
            composing={composing}
            onReplaceBusyChange={props.onReplaceBusyChange}
            /* 跳转统一走 openDocument 的保存 gate，不再因脏禁用；替换写入仍受 activeDirty 保护。 */
            navigationBlocked={false}
            activePath={props.activePath}
            activeDirty={props.activeDirty}
            onOpen={(hit: SearchHit) => props.onOpenDocument(hit.path, hit)}
            onReplaced={(paths) => props.onSearchReplaced(props.sessionId, paths)} /></fieldset> : null}
        </TabPanel>
      </Tabs>
    </section>
  );
})
