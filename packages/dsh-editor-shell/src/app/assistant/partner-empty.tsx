import { Button } from '../../ui/button.tsx'
import { EmptyState } from '../../ui/empty-state.tsx'
import { t } from '../../i18n/index.ts'
import { partnerSuggestions, type PartnerSuggestionKind } from '../../client/chat-empty.ts'

/* 空对话起步建议（§5）：三条建议只填入输入框并聚焦，不发送（由 onPick 保证）。
   锚在历史列底部、贴住 composer，左对齐。 */
export function PartnerEmptyState(props: { title: string; kind?: PartnerSuggestionKind; onPick(text: string): void }) {
  return (
    <EmptyState
      className="dsh-partner__empty"
      title={t('chat.emptyTitle')}
      actions={<div className="dsh-partner__suggestions">
        {partnerSuggestions(props.title, props.kind).map((text) => (
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

/* 没有可用模型时，空对话的主消息换成接入引导：先设置接口或重试目录。 */
export function PartnerSetupState(props: { unavailable?: boolean; onConfigure(): void; onRetry(): void }) {
  return (
    <div className="dsh-partner__setup" data-testid="dsh-partner-setup">
      <EmptyState
        title={t('chat.setupTitle')}
        body={props.unavailable ? t('chat.apiUnavailable') : t('chat.setupBody')}
        actions={<>
          <Button variant="primary" onClick={props.onConfigure}>{t('chat.setApi')}</Button>
          <Button variant="secondary" onClick={props.onRetry}>{t('common.retry')}</Button>
        </>} />
    </div>
  )
}
