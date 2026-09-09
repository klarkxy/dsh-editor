import type { Context } from '@deepseek-ai/cordis'
import { SHELL_RPC_CHANNEL, type ShellFeatureConfig, type ShellCapabilityResult } from './capabilities.ts'
import Schema from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { AUTHOR_MEMORY_MAX_CHARS, AUTHOR_PREFERENCES_MAX_CHARS, normalizeAuthorMemory, normalizeAuthorPreferences } from './author-preferences.ts'
import { WRITING_SETTINGS_NAMESPACE, type WritingPreferences } from './writing-settings-contract.ts'

export const name = 'dsh-editor-shell'
export const inject = ['settings', 'connection'] as const
export const Config = Schema.object({ assistant: Schema.boolean().default(true), zhihu: Schema.boolean().default(true) })

const WritingPreferencesSchema = Schema.object({
  completion: Schema.union(['manual', 'pause']).default('manual'),
  authorPreferences: Schema.transform(Schema.string().max(AUTHOR_PREFERENCES_MAX_CHARS), normalizeAuthorPreferences).default(''),
  authorMemory: Schema.transform(Schema.string().max(AUTHOR_MEMORY_MAX_CHARS), normalizeAuthorMemory).default(''),
  typewriter: Schema.boolean().default(false),
  focusParagraph: Schema.boolean().default(false),
  fontSize: Schema.number().min(14).max(28).default(17),
  lineHeight: Schema.number().min(1.4).max(2.4).default(1.9),
  fontFamily: Schema.union(['serif', 'sans', 'mono']).default('serif'),
  paragraphSpacing: Schema.number().min(0).max(1.5).default(0),
  paperWidth: Schema.union(['narrow', 'medium', 'wide']).default('wide'),
})

/** Host owns the editor's one durable writing-preference namespace. */
export function apply(ctx: Context, config: ShellFeatureConfig = {}): void {
  ctx.settings.register<WritingPreferences>(settingsNamespace(WRITING_SETTINGS_NAMESPACE), WritingPreferencesSchema)
  const connection = (ctx as Context & { connection?: { rpc: { handle: (channel: string, handler: (endpoint: string) => Promise<ShellCapabilityResult>, options: { authority: 'loopback' }) => () => unknown } } }).connection
  if (connection) ctx.effect(() => connection.rpc.handle(SHELL_RPC_CHANNEL, async endpoint => {
    if (endpoint !== 'capabilities.get') return { ok: false, error: { code: 'bad-request', message: '不支持的界面操作', details: {} } }
    const assistant = config.assistant !== false
    const zhihu = config.zhihu !== false
    const completion = Boolean(ctx.get('manuscriptAssist'))
    const missing = [assistant && !completion ? 'manuscript-assist' : '', assistant && !ctx.get('novelKernel') ? 'editor-novel-kernel' : '', zhihu && !ctx.get('zhihu') ? 'zhihu' : ''].filter(Boolean)
    if (missing.length) return { ok: false, error: { code: 'internal', message: '所选组合缺少已启用的插件', details: { missing } } }
    return { ok: true, value: { assistant, completion: assistant && completion, zhihu } }
  }, { authority: 'loopback' }) as () => void)

}
