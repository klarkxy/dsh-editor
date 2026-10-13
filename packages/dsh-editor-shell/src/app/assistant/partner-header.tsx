import type { ReactNode } from 'react'
import type { ConversationFilter } from '../../native-conversation-state.ts'
import type { ConversationPresetChoice } from '../../conversation-presets.ts'
import { t } from '../../i18n/index.ts'
import { Popover } from '../../ui/popover.tsx'
import { SplitButton, type SplitButtonItem } from '../../ui/split-button.tsx'
import { SegmentedControl } from '../../ui/segmented-control.tsx'
import { ListRow } from '../../ui/list-row.tsx'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../../ui/menu.tsx'
import { IconButton } from '../../ui/icon-button.tsx'
import { ChevronDownIcon, DotsIcon, PinIcon } from '../../ui/icons.tsx'
import './assistant.styles.ts'

/* 搭档页头与对话列表（shell-rewrite-spec §5）：左侧标题+箭头打开 Popover，
   行内重命名/置顶/归档/恢复；右侧「新对话」SplitButton，主按钮用上次模式。 */

export type PartnerConversationRow = {
  id: string
  title: string
  pinned: boolean
  archived: boolean
  current: boolean
}

export function ConversationListView(props: {
  filter: ConversationFilter
  onFilterChange(filter: ConversationFilter): void
  rows: PartnerConversationRow[]
  busy: boolean
  /** 归档当前对话仍需另一条可见对话兜底（chat.archiveNeedAnother 规则不变）。 */
  canArchiveCurrent: boolean
  onSelect(id: string): void
  onRename(id: string): void
  onTogglePin(id: string): void
  onArchive(id: string): void
  onRestore(id: string): void
}) {
  return (
    <div className="dsh-partner__list">
      <SegmentedControl
        className="dsh-partner__filter"
        aria-label={t('chat.conversationActions')}
        value={props.filter}
        onValueChange={(value) => props.onFilterChange(value as ConversationFilter)}
        options={[
          { value: 'active', label: t('chat.showActiveConversations') },
          { value: 'all', label: t('chat.showAllConversations') },
          { value: 'archived', label: t('chat.showArchivedConversations') },
        ]} />
      <div className="dsh-partner__rows" role="list">
        {props.rows.length === 0
          ? <p className="dsh-partner__list-empty">{t('chat.noConversations')}</p>
          : props.rows.map((row) => <ListRow
            key={row.id}
            density="compact"
            selected={row.current}
            leading={row.pinned ? <PinIcon size="sm" /> : undefined}
            label={row.title}
            meta={row.archived ? t('chat.archivedConversations') : undefined}
            onSelect={() => props.onSelect(row.id)}
            trailing={/* 行内操作菜单：点击不触发整行切换。 */ <span
              className="dsh-partner__row-menu"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}>
              <Menu>
                <MenuTrigger>
                  <IconButton label={t('chat.conversationActions')} size="sm" disabled={props.busy}>
                    <DotsIcon size="sm" />
                  </IconButton>
                </MenuTrigger>
                <MenuContent align="end" aria-label={t('chat.conversationActions')}>
                  <MenuItem onSelect={() => props.onRename(row.id)}>
                    {t('chat.renameConversation')}
                  </MenuItem>
                  {row.archived ? <MenuItem
                    onSelect={() => props.onRestore(row.id)}>
                    {t('common.restore')}
                  </MenuItem> : <MenuItem
                    onSelect={() => props.onTogglePin(row.id)}>
                    {row.pinned ? t('chat.unpinConversation') : t('chat.pinConversation')}
                  </MenuItem>}
                  {!row.archived ? <MenuSeparator /> : null}
                  {!row.archived ? <MenuItem
                    disabled={row.current && !props.canArchiveCurrent}
                    title={row.current && !props.canArchiveCurrent ? t('chat.archiveNeedAnother') : undefined}
                    onSelect={() => props.onArchive(row.id)}>
                    {t('common.archive')}
                  </MenuItem> : null}
                </MenuContent>
              </Menu>
            </span>} />)}
      </div>
    </div>
  )
}

export function PartnerHeader(props: {
  title: string
  busy: boolean
  listOpen: boolean
  onListOpenChange(open: boolean): void
  list: ReactNode
  presets: ConversationPresetChoice[]
  presetsLoading: boolean
  newDisabled?: boolean
  onNew(presetId?: string): void
  status?: ReactNode
  trailing?: ReactNode
  titleRef?: (node: HTMLButtonElement | null) => void
}) {
  const items: SplitButtonItem[] = props.presets.length
    ? props.presets.map((preset) => ({
      label: preset.name,
      title: preset.available ? preset.description : preset.reason,
      disabled: !preset.available,
      onSelect: () => props.onNew(preset.id),
    }))
    : [{ label: t('chat.presetLoading'), disabled: true }]
  return (
    <header className="chat-header dsh-partner__head">
      <Popover
        open={props.listOpen}
        onOpenChange={props.onListOpenChange}
        aria-label={t('chat.switchConversation')}
        trigger={<button
          ref={props.titleRef}
          type="button"
          className="dsh-partner__title"
          aria-label={t('chat.switchConversation')}
          title={props.title}
          disabled={props.busy}>
          <span className="dsh-partner__title-text">{props.title}</span>
          <ChevronDownIcon size="sm" />
        </button>}
        content={props.list} />
      {props.status}
      <span className="dsh-partner__actions">
        <SplitButton
          className="dsh-partner__new"
          label={t('chat.newConversation')}
          menuLabel={t('chat.newConversationMode')}
          items={items}
          disabled={props.busy || props.newDisabled || props.presetsLoading}
          onClick={() => props.onNew()} />
        {props.trailing}
      </span>
    </header>
  )
}
