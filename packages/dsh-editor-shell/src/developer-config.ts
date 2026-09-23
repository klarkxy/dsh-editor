import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

export const name = 'dsh-editor-developer-settings'
export const Config = Schema.object({ developerMode: Schema.boolean().default(false).volatile() })
export function apply(_ctx: Context): void {}
