import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-editor-memory-panel'
export const inject = [] as const

/** Client-only feature; workbench owns `memory.*`. */
export function apply(_ctx: Context): void {}
