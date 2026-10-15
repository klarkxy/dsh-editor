import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ScrollArea, Text } from '../ui/index.ts'
import { ChatHistory } from './chat-history.tsx'
import { ChatEntry, ChatProcessStack, ChatRowView, ChatStepItem, PendingCard } from './chat-cards.tsx'
import { clusterChatRows } from '../model/chat-cards.ts'
import { createProposalBoard } from '../model/proposal-board.ts'
import { PluginChatEvents } from './plugin-surfaces.tsx'
import type { SessionFace } from '../dsh-compat.ts'
import type { ShellContext } from './shared.ts'

type Element = ReactElement<Record<string, unknown> & { children?: ReactNode }>
type Props = Parameters<typeof ChatHistory>[0]

function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement(node)) return []
  const element = node as Element
  return [element, ...elements(element.props.children)]
}

function props(overrides: Partial<Props> = {}): Props {
  return {
    ctx: {} as ShellContext,
    session: { sessionId: 'session-1' } as SessionFace,
    locale: 'zh', hidden: false,
    snapshot: { sessionId: 'session-1', running: false, pendingSubmissions: [], openState: 'open', promptError: null },
    historyRef: { current: null }, bottomPinnedRef: { current: true },
    historyBlocks: [], messageCardTick: 0,
    messageCardContext: { sessionId: 'session-1', locale: 'zh', onApplied: vi.fn(), refresh: vi.fn(), note: vi.fn() },
    handleApplied: vi.fn(), isNewMessage: () => false,
    partial: { text: '', thinking: '' }, hasPartial: false,
    visibleCalls: [], queuedSubmissions: [], pendingItems: [],
    outgoing: null, outgoingIsCanonical: false, hasTurnError: false, initGuide: null,
    board: createProposalBoard(), proposalTurnKeys: new Map(),
    ...overrides,
  }
}

describe('ChatHistory boundary', () => {
  it('attaches live process steps once to the final process group and retains row identity', () => {
    const row = { id: 'user:1', role: 'user' as const, text: '继续' }
    const input = props({
      snapshot: { ...props().snapshot, running: true },
      historyBlocks: clusterChatRows([row, { id: 'thinking:2', role: 'thinking', text: '先整理' }]),
      visibleCalls: [{ callId: 'read-live', name: 'read' }],
      partial: { text: '', thinking: '继续思考' },
    })
    const tree = elements(ChatHistory(input))
    expect(tree.filter((element) => element.type === ChatProcessStack)).toHaveLength(1)
    expect(tree.filter((element) => element.type === ChatStepItem)).toHaveLength(2)
    const renderedRow = tree.find((element) => element.type === ChatRowView)!
    expect(renderedRow.key).toBe(row.id)
    expect(renderedRow.props.row).toBe(row)
    expect(renderedRow.props.messageCardContext).toBe(input.messageCardContext)
    expect(renderedRow.props.onApplied).toBe(input.handleApplied)
  })

  it('keeps native pending requests and plugin visibility attached to their original lifetime', () => {
    const pending = {
      kind: 'approval' as const, key: 'approval-1', sessionId: 'session-1',
      payload: { approvalId: 'approval-1' }, respond: vi.fn(),
    }
    const input = props({ pendingItems: [pending], hidden: true })
    const tree = elements(ChatHistory(input))
    const renderedPending = tree.find((element) => element.type === PendingCard)!
    expect(renderedPending.key).toBe(pending.key)
    expect(renderedPending.props.item).toBe(pending)
    const plugin = tree.find((element) => element.type === PluginChatEvents)!
    expect(plugin.props.hidden).toBe(true)
    expect(plugin.props.onApplied).toBe(input.handleApplied)
  })

  it('shows failed local sends and removes local echoes once native history contains them', () => {
    const input = props({ outgoing: { text: '保留这段草稿', state: 'failed', afterRows: 0 } })
    const failed = elements(ChatHistory(input))
    expect(failed.find((element) => element.type === ChatEntry)?.key).toBe('local-outgoing')
    expect(failed.some((element) => element.type === Text && element.props.role === 'alert')).toBe(true)
    expect(elements(ChatHistory({ ...input, outgoingIsCanonical: true }))
      .filter((element) => element.type === ChatEntry)).toHaveLength(0)
  })

  it('lets author scroll release and resume the existing follow ref without hiding empty streams', () => {
    const input = props({ hasPartial: true })
    const tree = elements(ChatHistory(input))
    expect(tree.find((element) => element.type === ChatEntry)?.key).toBe('partial-replying')
    const scroll = tree.find((element) => element.type === ScrollArea)!
    const onScroll = scroll.props.onScroll as (event: { currentTarget: { scrollHeight: number; scrollTop: number; clientHeight: number } }) => void
    onScroll({ currentTarget: { scrollHeight: 1000, scrollTop: 400, clientHeight: 300 } })
    expect(input.bottomPinnedRef.current).toBe(false)
    onScroll({ currentTarget: { scrollHeight: 1000, scrollTop: 670, clientHeight: 300 } })
    expect(input.bottomPinnedRef.current).toBe(true)
  })
})
