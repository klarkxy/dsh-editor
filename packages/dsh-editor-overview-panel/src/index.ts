import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-editor-overview-panel'
export const inject = [] as const

/** Client-only feature; workbench owns `project.overview` / `chapter.statusSet`. */
export function apply(_ctx: Context): void {}
