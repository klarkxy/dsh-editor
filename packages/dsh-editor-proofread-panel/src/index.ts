import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-editor-proofread-panel'
export const inject = [] as const

/** Client-only feature; workbench owns `proofread.scan`. */
export function apply(_ctx: Context): void {}
