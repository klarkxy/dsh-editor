import type { Context } from '@deepseek-ai/cordis'
import { createElement as e } from 'react'
import {
  CENTER_OVERLAYS_SLOT,
  COMMANDS_SERVICE,
  SIDEBAR_TOOLS_SLOT,
  type ShellCommand,
  type ShellCommandRegistry,
  type ShellToolSeatContext,
} from 'dsh-editor-seats'
import { CardsDetailSeat } from './client/detail.ts'
import { CardsPanelSeat, type RpcCaller } from './client/panel.ts'
import { requestCardsOpen } from './client/requests.ts'
import { cardsPanelStyles } from './client/styles.ts'
import { message } from './client/messages.ts'

export const name = 'dsh-editor-cards-client'
export const inject = ['slots', 'connection', COMMANDS_SERVICE] as const

type SlotHandle = {
  inject: (key: string, callback: () => unknown) => () => void
  register: (spec: { name: string; id?: string; order?: number; label?: string }, render: unknown) => () => void
}

type CardsClientContext = Context & {
  slots: SlotHandle
  connection: { rpc: RpcCaller }
  [COMMANDS_SERVICE]: ShellCommandRegistry
}

function injectStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  const style = document.createElement('style')
  style.setAttribute('data-dsh-cards-styles', '')
  style.textContent = cardsPanelStyles
  document.head.appendChild(style)
  return () => style.remove()
}

function seatFromRenderProps(props: unknown): ShellToolSeatContext | undefined {
  if (!props || typeof props !== 'object') return undefined
  const record = props as Record<string, unknown>
  if (typeof record.openDocument === 'function' && typeof record.sessionId === 'string') {
    return record as ShellToolSeatContext
  }
  const nested = record.owner
  if (nested && typeof nested === 'object' && typeof (nested as ShellToolSeatContext).openDocument === 'function') {
    return nested as ShellToolSeatContext
  }
  return undefined
}

function cardsCommands(): ShellCommand[] {
  return [
    {
      id: 'cards-character',
      group: 'writing',
      label: { zh: message('zh', 'command.cardsCharacter'), en: message('en', 'command.cardsCharacter') },
      hint: { zh: message('zh', 'command.cardsCharacterHint'), en: message('en', 'command.cardsCharacterHint') },
      keywords: ['character', '人物', '人物卡', '角色'],
      shortcut: { key: 'c', ctrl: true, shift: true },
      when: 'workspace',
      run() {
        requestCardsOpen('character')
      },
    },
    {
      id: 'cards-worldbook',
      group: 'writing',
      label: { zh: message('zh', 'command.cardsWorldbook'), en: message('en', 'command.cardsWorldbook') },
      hint: { zh: message('zh', 'command.cardsWorldbookHint'), en: message('en', 'command.cardsWorldbookHint') },
      keywords: ['worldbook', '世界书', '设定', 'Lore', '触发词'],
      shortcut: { key: 'w', ctrl: true, shift: true },
      when: 'workspace',
      run() {
        requestCardsOpen('worldbook')
      },
    },
  ]
}

export function apply(ctx: Context): void {
  const client = ctx as CardsClientContext
  if (typeof document !== 'undefined') ctx.effect(() => injectStyles(), 'dsh-editor-cards-client.styles')
  const renderPanel = (props: unknown) => {
    const seat = seatFromRenderProps(props)
    if (!seat) return null
    return e(CardsPanelSeat, { ...seat, rpc: client.connection.rpc })
  }
  const renderDetail = (props: unknown) => {
    const seat = seatFromRenderProps(props)
    if (!seat) return null
    return e(CardsDetailSeat, { ...seat, rpc: client.connection.rpc })
  }
  ctx.effect(() => client.slots.inject(SIDEBAR_TOOLS_SLOT, () =>
    client.slots.register({ name: SIDEBAR_TOOLS_SLOT, id: 'cards', order: 150, label: '卡片' }, renderPanel)),
  'dsh-editor-cards-client.sidebar')
  ctx.effect(() => client.slots.inject(CENTER_OVERLAYS_SLOT, () =>
    client.slots.register({ name: CENTER_OVERLAYS_SLOT, id: 'cards-detail', order: 150 }, renderDetail)),
  'dsh-editor-cards-client.overlay')
  for (const command of cardsCommands()) {
    ctx.effect(() => client[COMMANDS_SERVICE].register(command), `dsh-editor-cards-client.command.${command.id}`)
  }
}
