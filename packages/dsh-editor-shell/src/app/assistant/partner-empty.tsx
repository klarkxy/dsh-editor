import { EmptyState } from '../../ui/empty-state.tsx'
import { t } from '../../i18n/index.ts'
import { partnerSuggestions } from '../../client/chat-empty.ts'

/* 空对话起步建议（§5）：三条建议只填入输入框并聚焦，不发送（由 onPick 保证）。 */
export function PartnerEmptyState(props: { title: string; onPick(text: string): void }) {
  return (
    <EmptyState
      className="dsh-partner__empty"
      title={t('chat.emptyTitle')}
      actions={<div className="dsh-partner__suggestions">
        {partnerSuggestions(props.title).map((text) => (
          <button
            key={text}
            type="button"
            className="dsh-partner__suggest"
            onClick={() => props.onPick(text)}>
            {text}
          </button>
        ))}
      </div>} />
  )
}
