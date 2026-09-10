import type { Context } from '@deepseek-ai/cordis'
import { createElement as e } from 'react'
import {
  COMMANDS_SERVICE,
  SIDEBAR_TOOLS_SLOT,
  type ShellCommand,
  type ShellCommandRegistry,
  type ShellToolSeatContext,
} from 'dsh-editor-seats'
import { ProofreadSeat, type RpcCaller } from './panel.ts'
import { requestProofread } from './requests.ts'
import { proofreadPanelStyles } from './styles.ts'
import { message } from './messages.ts'

export const name = 'dsh-editor-proofread-panel-client'
export const inject = ['slots', 'connection', COMMANDS_SERVICE] as const

type SlotHandle = {
  inject: (key: string, callback: () => unknown) => () => void
  register: (spec: { name: string; id?: string; order?: number; label?: string }, render: unknown) => () => void
}

type ProofreadClientContext = Context & {
  slots: SlotHandle
  connection: { rpc: RpcCaller }
  [COMMANDS_SERVICE]: ShellCommandRegistry
}

function injectStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  const style = document.createElement('style')
  style.setAttribute('data-dsh-proofread-panel-styles', '')
  style.textContent = proofreadPanelStyles
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

function proofreadCommands(): ShellCommand[] {
  return [
    {
      id: 'proofread-document',
      group: 'writing',
      label: { zh: message('zh', 'command.proofreadDoc'), en: message('en', 'command.proofreadDoc') },
      hint: { zh: message('zh', 'command.proofreadDocHint'), en: message('en', 'command.proofreadDocHint') },
      shortcut: { key: 'l', ctrl: true, shift: true },
      when: 'workspace',
      enabled: (context) => Boolean(context.activePath),
      run(context) {
        requestProofread(context.activePath ? 'document' : 'manuscript')
      },
    },
    {
      id: 'proofread-manuscript',
      group: 'writing',
      label: { zh: message('zh', 'command.proofreadBook'), en: message('en', 'command.proofreadBook') },
      hint: { zh: message('zh', 'command.proofreadBookHint'), en: message('en', 'command.proofreadBookHint') },
      when: 'workspace',
      run() {
        requestProofread('manuscript')
      },
    },
  ]
}

export function apply(ctx: Context): void {
  const client = ctx as ProofreadClientContext
  if (typeof document !== 'undefined') ctx.effect(() => injectStyles(), 'dsh-editor-proofread-panel-client.styles')
  const render = (props: unknown) => {
    const seat = seatFromRenderProps(props)
    if (!seat) return null
    return e(ProofreadSeat, { ...seat, rpc: client.connection.rpc })
  }
  ctx.effect(() => client.slots.inject(SIDEBAR_TOOLS_SLOT, () =>
    client.slots.register({ name: SIDEBAR_TOOLS_SLOT, id: 'proofread', order: 100, label: '校对' }, render)),
  'dsh-editor-proofread-panel-client.slot')
  for (const command of proofreadCommands()) {
    ctx.effect(() => client[COMMANDS_SERVICE].register(command), `dsh-editor-proofread-panel-client.command.${command.id}`)
  }
}
