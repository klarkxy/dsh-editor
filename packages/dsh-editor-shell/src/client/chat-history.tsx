import { Fragment, type MutableRefObject, type ReactNode, type RefObject } from 'react'
import { Box, Button, Callout, Card, Flex, ScrollArea, Text } from '@radix-ui/themes'
import { loadOlder, WRITING_PROPOSE_TOOL_NAME, type PendingInteraction, type partialView } from '../adapter.ts'
import type { ChatTranscript, SessionFace, SessionLifecycle } from '../dsh-compat.ts'
import type { ProjectContextReceiptBundle } from 'dsh-editor-workbench/contracts'
import type { ShellMessageCardContext, ShellMessageCardRegistry } from '../seats.ts'
import { t, type Locale } from '../i18n/index.ts'
import type { ShellContext } from './shared.ts'
import { Markdown } from './markdown.tsx'
import { ActivityDots, SuccessMark } from './ui/index.ts'
import { PluginChatEvents } from './plugin-surfaces.tsx'
import type { SettingsRenderSlot } from './settings-plugins.tsx'
import {
  ChatEntry, ChatProcessBlock, ChatProcessStack, ChatRowView, ChatStepFromRow, ChatStepItem,
  PendingCard, ProjectContextReceiptView,
} from './chat-cards.tsx'
import { clusterChatRows, processDetailRows } from '../model/chat-cards.ts'


import type { ChatOutgoing } from '../model/chat-history.ts'

type ChatHistoryProps = {
  ctx: ShellContext
  session: SessionFace
  locale: Locale
  hidden: boolean
  renderSlot?: SettingsRenderSlot
  snapshot: SessionLifecycle & { hasMore?: boolean; loadingOlder?: boolean }
  historyRef: RefObject<HTMLDivElement>
  bottomPinnedRef: MutableRefObject<boolean>
  historyBlocks: ReturnType<typeof clusterChatRows>
  messageCards?: ShellMessageCardRegistry
  messageCardTick: number
  messageCardContext: ShellMessageCardContext
  handleApplied(path: string): void
  isNewMessage(id: string): boolean
  partial: ReturnType<typeof partialView>
  hasPartial: boolean
  visibleCalls: NonNullable<ChatTranscript['runningCalls']>
  queuedSubmissions: SessionLifecycle['pendingSubmissions']
  pendingItems: PendingInteraction[]
  outgoing: ChatOutgoing | null
  outgoingIsCanonical: boolean
  hasTurnError: boolean
  initGuide: ReactNode
}

/** Render the transcript without owning its subscription or scroll-follow lifetime. */
export function ChatHistory({
  ctx, session, locale, hidden, renderSlot, snapshot, historyRef, bottomPinnedRef, historyBlocks,
  messageCards, messageCardTick, messageCardContext, handleApplied, isNewMessage, partial,
  hasPartial, visibleCalls, queuedSubmissions, pendingItems, outgoing, outgoingIsCanonical,
  hasTurnError, initGuide,
}: ChatHistoryProps) {
  const liveOpen = snapshot.running
  const liveSteps = <Fragment>
    {visibleCalls.map((call) => <ChatStepItem
      key={`running:${call.callId}`}
      className="tool"
      busy
      label={call.name === 'glob' || call.name === 'grep' ? t('chat.searchingNotes') : call.name === 'read' ? t('chat.readingNotes') : call.name === 'novel_propose' || call.name === WRITING_PROPOSE_TOOL_NAME ? t('chat.preparingProposal') : t('chat.processing')} />)}
    {partial.thinking ? <ChatStepItem
      key="partial-thinking"
      className="thinking"
      expandable
      live
      busy
      label={t('chat.think')}>
      {partial.thinking}
    </ChatStepItem> : null}
  </Fragment>
  return (
    <Box className="chat-history" data-running={snapshot.running ? 'true' : 'false'} minWidth="0" minHeight="0" height="100%">
      <ScrollArea
        ref={historyRef}
        type="hover"
        scrollbars="vertical"
        size="1"
        style={{ height: '100%' }}
        onScroll={(event: { currentTarget: HTMLDivElement }) => {
          const el = event.currentTarget
          bottomPinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
        }}>
        <Flex direction="column" gap="3" p="3" minWidth="0" width="100%">
          {initGuide}
          {snapshot.hasMore ? <Button
            type="button"
            variant="soft"
            color="gray"
            size="1"
            onClick={() => void loadOlder(session)}
            disabled={snapshot.loadingOlder}>
            {snapshot.loadingOlder ? <Fragment>
              <ActivityDots />
              {t('chat.loadingMore')}
            </Fragment> : t('chat.loadOlder')}
          </Button> : null}
          {historyBlocks.map((block, index) => {
            if (block.kind === 'item') return (
              <ChatRowView
                key={block.row.id}
                row={block.row}
                ctx={ctx}
                sessionId={session.sessionId}
                locale={locale}
                cardTick={messageCardTick}
                enter={isNewMessage(block.row.id)}
                messageCards={messageCards}
                messageCardContext={messageCardContext}
                onApplied={handleApplied} />
            )
            const attachLive = liveOpen && index === historyBlocks.length - 1
            if (attachLive) return (
              <ChatProcessStack
                key={block.rows[0]!.id}
                enter={block.rows.some((row) => isNewMessage(row.id)) || visibleCalls.some((call) => isNewMessage(`running:${call.callId}`)) || isNewMessage('partial-thinking')}>
                {processDetailRows(block.rows).map((row) => <ChatStepFromRow key={row.id} row={row} running />)}
                {liveSteps}
              </ChatProcessStack>
            )
            return (
              <ChatProcessBlock
                key={block.rows[0]!.id}
                rows={block.rows}
                enter={block.rows.some((row) => isNewMessage(row.id))} />
            )
          })}
          {liveOpen && (visibleCalls.length > 0 || Boolean(partial.thinking)) && historyBlocks.at(-1)?.kind !== 'steps' ? <ChatProcessStack
            enter={visibleCalls.some((call) => isNewMessage(`running:${call.callId}`)) || isNewMessage('partial-thinking')}>
            {liveSteps}
          </ChatProcessStack> : null}
          {outgoing && !outgoingIsCanonical ? <ChatEntry
            className="chat-row user"
            key="local-outgoing"
            enter={isNewMessage('local-outgoing')}>
            <Card size="2">
              <Text size="2" as="p">
                {outgoing.text}
              </Text>
              {outgoing.projectContextReceipt ? <ProjectContextReceiptView receipt={outgoing.projectContextReceipt} /> : null}
              <Text size="1" color="gray" mt="1" role={outgoing.state === 'failed' ? 'alert' : 'status'}>
                {outgoing.state === 'sending'
                  ? <Fragment>
                  <ActivityDots />
                  {t('chat.sending')}
                </Fragment>
                  : outgoing.state === 'accepted'
                    ? <Fragment>
                  <SuccessMark />
                  {' '}
                  {t('chat.sent')}
                </Fragment>
                    : t('chat.sendFailed')}
              </Text>
            </Card>
          </ChatEntry> : null}
          {outgoing?.state === 'accepted' && !outgoingIsCanonical
            ? <ChatEntry
            className="chat-row assistant"
            key="local-replying"
            aria-live="polite"
            enter={isNewMessage('local-replying')}>
            <Text size="2">
              <ActivityDots variant="typing" />
              {t('chat.replying')}
            </Text>
          </ChatEntry>
            : null}
          {queuedSubmissions.map((item) => <ChatEntry
            className="chat-row notice"
            key={`queue:${item.requestId}`}
            enter={isNewMessage(`queue:${item.requestId}`)}>
            <Text size="2" as="p">
              {item.text}
            </Text>
            <Text size="1" color="gray">
              {item.placement === 'queued' ? t('chat.queued') : t('chat.steering')}
            </Text>
          </ChatEntry>)}
          {partial.text ? <ChatEntry
            className="chat-row assistant"
            key="partial-text"
            enter={isNewMessage('partial-text')}>
            <Text size="2" as="div">
              <Markdown text={partial.text} />
            </Text>
          </ChatEntry> : hasPartial && !partial.thinking ? <ChatEntry
            className="chat-row assistant"
            key="partial-replying"
            aria-live="polite"
            enter={isNewMessage('partial-replying')}>
            <Text size="2">
              <ActivityDots variant="typing" />
              {t('chat.replying')}
            </Text>
          </ChatEntry> : null}
          {pendingItems.map((item) => <PendingCard key={item.key} item={item} />)}
          <PluginChatEvents ctx={ctx} renderSlot={renderSlot} sessionId={session.sessionId} locale={locale} hidden={hidden} onApplied={handleApplied} />
          {snapshot.openState === 'error' ? <Callout.Root color="red" className="warning">
            <Callout.Text>
              {t('chat.connectionInterrupted')}
            </Callout.Text>
          </Callout.Root> : null}
          {snapshot.promptError && !hasTurnError ? <Callout.Root color="red" className="warning">
            <Callout.Text>
              {t('chat.requestFailed')}
            </Callout.Text>
          </Callout.Root> : null}
        </Flex>
      </ScrollArea>
    </Box>
  )
}
