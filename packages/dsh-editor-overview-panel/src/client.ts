import type { Context } from '@deepseek-ai/cordis'
import { createElement as e } from 'react'
import {
  CENTER_OVERLAYS_SLOT,
  COMMANDS_SERVICE,
  type ShellCommand,
  type ShellCommandRegistry,
  type ShellToolSeatContext,
} from 'dsh-editor-seats'
import { OverviewSeat, type RpcCaller } from './panel.ts'
import { requestOverview } from './requests.ts'
import { overviewPanelStyles } from './styles.ts'
import { message } from './messages.ts'

export const name = 'dsh-editor-overview-panel-client'
export const inject = ['slots', 'connection', COMMANDS_SERVICE] as const

type SlotHandle = {
  inject: (key: string, callback: () => unknown) => () => void
  register: (spec: { name: string; id?: string; order?: number; label?: string }, render: unknown) => () => void
}

type OverviewClientContext = Context & {
  slots: SlotHandle
  connection: { rpc: RpcCaller }
  [COMMANDS_SERVICE]: ShellCommandRegistry
}

function injectStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  const style = document.createElement('style')
  style.setAttribute('data-dsh-overview-panel-styles', '')
  style.textContent = overviewPanelStyles
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

function overviewCommands(): ShellCommand[] {
  return [
    {
      id: 'overview',
      group: 'writing',
      label: { zh: message('zh', 'command.overview'), en: message('en', 'command.overview') },
      hint: { zh: message('zh', 'command.overviewHint'), en: message('en', 'command.overviewHint') },
      shortcut: { key: 'o', ctrl: true, shift: true },
      when: 'always',
      enabled: (context) => Boolean(context.sessionId),
      run() {
        requestOverview()
      },
    },
  ]
}

export function apply(ctx: Context): void {
  const client = ctx as OverviewClientContext
  if (typeof document !== 'undefined') ctx.effect(() => injectStyles(), 'dsh-editor-overview-panel-client.styles')
  const render = (props: unknown) => {
    const seat = seatFromRenderProps(props)
    if (!seat) return null
    return e(OverviewSeat, { ...seat, rpc: client.connection.rpc })
  }
  ctx.effect(() => client.slots.inject(CENTER_OVERLAYS_SLOT, () =>
    client.slots.register({ name: CENTER_OVERLAYS_SLOT, id: 'overview', order: 100, label: '概览' }, render)),
  'dsh-editor-overview-panel-client.slot')
  for (const command of overviewCommands()) {
    ctx.effect(() => client[COMMANDS_SERVICE].register(command), `dsh-editor-overview-panel-client.command.${command.id}`)
  }
}
