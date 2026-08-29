import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-editor-shell'
export const inject = [] as const

/** Private product Host entry retained only so DSH can load the root client. */
export function apply(_ctx: Context): void {}
