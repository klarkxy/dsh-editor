import type { Context } from '@deepseek-ai/cordis'
import { createElement as e } from 'react'
import {
  COMMANDS_SERVICE,
  MESSAGE_CARDS_SERVICE,
  SIDEBAR_TOOLS_SLOT,
  type ShellCommand,
  type ShellCommandRegistry,
  type ShellMessageCardRegistry,
  type ShellToolSeatContext,
} from 'dsh-editor-seats'
import { renderMemoryUpdateMessageCard } from './card.ts'
import { MemorySeat, type RpcCaller } from './panel.ts'
import { requestMemoryOpen } from './requests.ts'
import { memoryPanelStyles } from './styles.ts'
import { message } from './messages.ts'

export const name = 'dsh-editor-memory-panel-client'
export const inject = ['slots', 'connection', COMMANDS_SERVICE, MESSAGE_CARDS_SERVICE] as const

type SlotHandle = {
  inject: (key: string, callback: () => unknown) => () => void
  register: (spec: { name: string; id?: string; order?: number; label?: string }, render: unknown) => () => void
}

type MemoryClientContext = Context & {
  slots: SlotHandle
  connection: { rpc: RpcCaller }
  [COMMANDS_SERVICE]: ShellCommandRegistry
  [MESSAGE_CARDS_SERVICE]: ShellMessageCardRegistry
}

function injectStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  const style = document.createElement('style')
  style.setAttribute('data-dsh-memory-panel-styles', '')
  style.textContent = memoryPanelStyles
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

function memoryCommands(): ShellCommand[] {
  return [
    {
      id: 'memory-open',
      group: 'writing',
      label: { zh: message('zh', 'command.memoryOpen'), en: message('en', 'command.memoryOpen') },
      hint: { zh: message('zh', 'command.memoryOpenHint'), en: message('en', 'command.memoryOpenHint') },
      when: 'workspace',
      run() {
        requestMemoryOpen()
      },
    },
  ]
}

export function apply(ctx: Context): void {
  const client = ctx as MemoryClientContext
  if (typeof document !== 'undefined') ctx.effect(() => injectStyles(), 'dsh-editor-memory-panel-client.styles')
  const render = (props: unknown) => {
    const seat = seatFromRenderProps(props)
    if (!seat) return null
    return e(MemorySeat, { ...seat, rpc: client.connection.rpc })
  }
  ctx.effect(() => client.slots.inject(SIDEBAR_TOOLS_SLOT, () =>
    client.slots.register({ name: SIDEBAR_TOOLS_SLOT, id: 'memory', order: 200, label: '记忆' }, render)),
  'dsh-editor-memory-panel-client.slot')
  for (const command of memoryCommands()) {
    ctx.effect(() => client[COMMANDS_SERVICE].register(command), `dsh-editor-memory-panel-client.command.${command.id}`)
  }
  ctx.effect(() => client[MESSAGE_CARDS_SERVICE].register({
    toolName: 'novel_memory_update',
    render: ({ result, context }) => renderMemoryUpdateMessageCard({ result, context, rpc: client.connection.rpc }),
  }), 'dsh-editor-memory-panel-client.message-card')
}
