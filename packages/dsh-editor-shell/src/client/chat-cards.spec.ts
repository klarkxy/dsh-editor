import type { ReactElement, ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import {
  ChatProcessBlock,
  ChatStepFromRow,
  ChatStepHead,
  ChatStepItem,
} from './chat-cards.tsx'
import { Disclosure } from '../ui/disclosure.tsx'
import { collectStyles } from '../design-system/layers.ts'
import '../app/assistant/assistant.styles.ts'
import {
  clusterChatRows,
  isChatStepRow,
  processDetailRows,
  stepPreview,
  toolStepTitle,
  turnProcessLabel,
} from '../model/chat-cards.ts'
import { ActivityDots } from './ui/index.ts'
import { redesignedStyles } from '../styles.ts'
import type { ChatRow } from '../adapter.ts'

type El = ReactElement & { props: Record<string, unknown> & { children?: ReactNode } }

function kids(node: ReactNode): El[] {
  if (node == null || node === false) return []
  if (Array.isArray(node)) return node.flatMap(kids)
  if (typeof node === 'object' && node !== null && 'props' in node) return [node as El]
  return []
}

function findClass(node: ReactNode, className: string): El | undefined {
  for (const child of kids(node)) {
    const cls = String(child.props.className ?? '')
    if (cls.split(/\s+/).includes(className)) return child
    const nested = findClass(child.props.children, className)
    if (nested) return nested
  }
  return undefined
}

function row(partial: Partial<ChatRow> & Pick<ChatRow, 'id' | 'role' | 'text'>): ChatRow {
  return partial
}

describe('ChatStepHead', () => {
  it('keeps the mark column for state; the row itself is Disclosure summary content (§5)', () => {
    const thinking = ChatStepHead({ label: '思考' }) as El
    const failed = ChatStepHead({ tone: 'error', label: 'read' }) as El
    expect(String(thinking.props.className)).toContain('chat-step-head')
    expect(findClass(thinking, 'chat-step-mark')?.props['aria-hidden']).toBe('true')
    expect(String(findClass(thinking, 'chat-step-status')?.props.className)).toContain('is-muted')
    expect(findClass(failed, 'chat-step-label')?.props.children).toBe('read')
    expect(findClass(failed, 'chat-step-error-dot')).toBeDefined()
    expect(String(findClass(failed, 'chat-step-status')?.props.className)).toContain('is-error')
    const ok = ChatStepHead({ tone: 'ok', label: '操作已完成' }) as El
    expect(String(findClass(ok, 'chat-step-status')?.props.className)).toContain('is-ok')
    expect(String(findClass(failed, 'chat-step-label')?.props.children)).not.toContain('⚠')
    /* 可展开行交给 Disclosure：chevron 由 Disclosure 提供，样式移到行尾。 */
    const item = ChatStepItem({ className: 'tool', expandable: true, label: 'read' }) as El
    expect(kids(item.props.children).some((child) => child.type === Disclosure)).toBe(true)
  })

  it('keeps a mark slot for running tools so the label still lines up', () => {
    const running = ChatStepHead({ busy: true, label: 'read' }) as El
    expect(running.props.className).toContain('chat-step-head')
    expect(kids(findClass(running, 'chat-step-mark')?.props.children)[0]?.type).toBe(ActivityDots)
  })
})

describe('DSH compact process copy', () => {
  it('uses the first settled line and the last streaming line', () => {
    expect(stepPreview('first\nsecond\nthird')).toBe('first')
    expect(stepPreview('first\nsecond\nthird', true)).toBe('third')
    expect(stepPreview('**bold** line')).toBe('bold line')
  })

  it('matches DSH turn-process labels: tools win, else thought', () => {
    expect(turnProcessLabel({ tools: 0 })).toBe('已思考')
    expect(turnProcessLabel({ tools: 1 })).toBe('1 次工具调用')
    expect(turnProcessLabel({ tools: 3 })).toBe('3 次工具调用')
    expect(turnProcessLabel({ tools: 0, running: true })).toBe('正在思考…')
    expect(turnProcessLabel({ tools: 2, running: true })).toBe('2 次工具调用')
  })
})

describe('clusterChatRows', () => {
  it('folds consecutive thinking and tool steps into one process group', () => {
    const user = row({ id: 'u', role: 'user', text: '清理废稿' })
    const think = row({ id: 't', role: 'thinking', text: '先看目录' })
    const done = row({ id: 'd', role: 'tool', text: '操作已完成', content: 'ok' })
    const fail = row({ id: 'f', role: 'tool', text: '这项操作没有执行', error: true, content: 'denied' })
    const notice = row({ id: 'n', role: 'notice', text: '请重试' })
    expect(clusterChatRows([user, think, done, fail, notice])).toEqual([
      { kind: 'item', row: user },
      { kind: 'steps', rows: [think, done, fail] },
      { kind: 'item', row: notice },
    ])
  })

  it('keeps proposals out of the process stack', () => {
    const proposal = row({ id: 'p', role: 'tool', text: '提案', proposal: { marker: 'dsh-editor.proposal' } as ChatRow['proposal'] })
    const think = row({ id: 't', role: 'thinking', text: '想' })
    expect(isChatStepRow(proposal)).toBe(false)
    expect(clusterChatRows([proposal, think])).toEqual([
      { kind: 'item', row: proposal },
      { kind: 'steps', rows: [think] },
    ])
  })
})

describe('ChatStepFromRow', () => {
  it('keeps thinking as a title and folds the full text into the body', () => {
    const tree = ChatStepFromRow({
      row: row({ id: 't', role: 'thinking', text: '先看目录\n再动手' }),
    }) as El
    expect(tree.type).toBe(ChatStepItem)
    expect(tree.props.label).toBe('思考')
    expect(tree.props.tone).toBe('muted')
    expect(tree.props.preview).toBeUndefined()
    expect(tree.props.expandable).toBe(true)
    expect(tree.props.children).toBe('先看目录\n再动手')
  })

  it('keeps tool and error titles, and folds the reason into the body', () => {
    const tree = ChatStepFromRow({
      row: row({
        id: 'f',
        role: 'tool',
        text: '这项操作没有执行',
        toolName: 'read',
        detail: 'read',
        error: true,
        reason: '「read」不在允许范围',
        content: 'Error: DSH Editor only allows project search',
      }),
    }) as El
    expect(tree.type).toBe(ChatStepItem)
    expect(tree.props.label).toBe('这项操作没有执行')
    expect(tree.props.tone).toBe('error')
    expect(tree.props.preview).toBeUndefined()
    expect(kids(tree.props.children).some((child) => child.props.className === 'tool-error-reason')).toBe(true)
    expect(kids(tree.props.children).some((child) => child.props.className === 'chat-step-code' || child.type === 'pre')).toBe(true)
    expect(findClass(tree, 'rt-CalloutRoot')).toBeUndefined()
  })

  it('marks successful tools as ok so the head can show a green dot', () => {
    const tree = ChatStepFromRow({
      row: row({ id: 'd', role: 'tool', text: '操作已完成', toolName: 'pwsh', content: 'ok' }),
    }) as El
    expect(tree.props.tone).toBe('ok')
    expect(tree.props.label).toBe('操作已完成')
  })

  it('prefers the friendly outcome over the raw tool name', () => {
    expect(toolStepTitle(row({ id: 'd', role: 'tool', text: '已阅读作品资料', toolName: 'read', detail: 'read' }))).toBe('已阅读作品资料')
  })

  it('keeps thinking, tool use, and errors in the expanded process list', () => {
    const think = row({ id: 't', role: 'thinking', text: '先看目录' })
    const shell = row({ id: 's', role: 'tool', text: '操作已完成', toolName: 'pwsh', content: 'ok' })
    const fail = row({ id: 'f', role: 'tool', text: '这项操作没有执行', toolName: 'read', error: true, reason: '拦下了' })
    expect(processDetailRows([think, shell, fail])).toEqual([think, shell, fail])
  })
})

describe('execution record disclosure (§5)', () => {
  it('expands a failed step row by default and keeps done steps collapsed', () => {
    const fail = ChatStepFromRow({
      row: row({ id: 'f', role: 'tool', text: '这项操作没有执行', error: true, reason: '拦下了' }),
    }) as El
    expect(fail.props.defaultOpen).toBe(true)
    const done = ChatStepFromRow({
      row: row({ id: 'd', role: 'tool', text: '操作已完成', content: 'ok' }),
    }) as El
    expect(done.props.defaultOpen).toBe(false)
  })

  it('expands a settled process block by default only when a row failed', () => {
    const fail = row({ id: 'f', role: 'tool', text: '这项操作没有执行', error: true, reason: '拦下了' })
    const ok = row({ id: 'd', role: 'tool', text: '操作已完成', content: 'ok' })
    const failedBlock = ChatProcessBlock({ rows: [ok, fail] }) as El
    const disclosure = kids(failedBlock.props.children).find((child) => child.type === Disclosure)!
    expect(disclosure.props.defaultOpen).toBe(true)
    const okBlock = ChatProcessBlock({ rows: [ok] }) as El
    expect(kids(okBlock.props.children).find((child) => child.type === Disclosure)!.props.defaultOpen).toBe(false)
  })
})

describe('chat process CSS', () => {
  it('uses Disclosure rows instead of the old toggle/details chrome (§5)', () => {
    expect(redesignedStyles).not.toContain('.chat-process-toggle')
    expect(redesignedStyles).not.toContain('.chat-step-summary')
    expect(redesignedStyles).toContain('.chat-step-preview')
    expect(redesignedStyles).not.toContain('.chat-step-card')
    const layered = collectStyles()
    /* 单行执行记录：Disclosure 头行 + 箭头移到行尾 + 内容缩进对齐标题。 */
    expect(layered).toContain('.chat-step .dsh-disclosure__summary')
    expect(layered).toContain('order: 2')
    expect(layered).toContain('.chat-process .dsh-disclosure__summary')
  })

  it('keeps collapsed process rows to one ellipsized line and wraps only the opened body', () => {
    expect(redesignedStyles).toMatch(/\.chat-step-preview \{[^}]*white-space: nowrap/)
    expect(redesignedStyles).toMatch(/\.chat-step-preview \{[^}]*text-overflow: ellipsis/)
    expect(redesignedStyles).toMatch(/\.chat-step-body \{[^}]*white-space: pre-wrap/)
    expect(redesignedStyles).toContain('.panel-resizer::before')
    // The grab strip is a named control: the hit area is at least the small
    // control height even though the drawn rule stays hairline-thin.
    expect(redesignedStyles).toMatch(/\.panel-resizer \{[^}]*width: 12px/)
    expect(redesignedStyles).toMatch(/\.panel-resizer::before \{[^}]*width: 1px/)
  })

  it('colors process-row status dots green for success and red for failure', () => {
    expect(redesignedStyles).toContain('.chat-step-status.is-ok { background: var(--dsh-ui-success); }')
    expect(redesignedStyles).toContain('.chat-step-status.is-error')
    expect(redesignedStyles).toContain('background: var(--dsh-ui-danger)')
  })
})
