import type { Context } from '@deepseek-ai/cordis'
import type { RootOwnerProps } from '@deepseek-ai/dsh-client-runtime/client'

export const ROOT_ID = 'dsh-editor-shell-root'
export type RootSlots = { register: (spec: { name: 'root'; id: string; priority: number; label: string }, render: unknown) => unknown }

/** The package deliberately wins the public root slot; no layout/conversation internals are imported. */
export function registerRoot(ctx: Context & { slots: RootSlots }, render: (props: RootOwnerProps) => unknown): unknown {
  return ctx.slots.register({ name: 'root', id: ROOT_ID, priority: -100, label: 'DSH 编辑器' }, render)
}
