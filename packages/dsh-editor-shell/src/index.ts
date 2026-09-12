import type { Context } from '@deepseek-ai/cordis'
import { registerHostRpc, type HostRpcContext } from 'dsh-manuscript/host-api'
import { SHELL_RPC_CHANNEL, resolveShellCapabilities, type ShellFeatureConfig } from './capabilities.ts'
import Schema from '@deepseek-ai/schemastery'
import { AUTHOR_MEMORY_MAX_CHARS, AUTHOR_PREFERENCES_MAX_CHARS, normalizeAuthorMemory, normalizeAuthorPreferences } from './author-preferences.ts'
import { WRITING_SETTINGS_NAMESPACE, type WritingPreferences } from './writing-settings-contract.ts'

export const name = 'dsh-editor-shell'
export const inject = ['settings', 'connection', 'webServer'] as const
export const Config: Schema<ShellFeatureConfig> = Schema.object({
  features: Schema.dict(Schema.string()).default({}),
})

const WritingPreferencesSchema = Schema.object({
  completion: Schema.union(['manual', 'pause']).default('manual'),
  completionModel: Schema.object({ provider: Schema.string().default(''), model: Schema.string().default('') }).default({ provider: '', model: '' }),
  rewriteModel: Schema.object({ provider: Schema.string().default(''), model: Schema.string().default('') }).default({ provider: '', model: '' }),
  chatModel: Schema.object({ provider: Schema.string().default(''), model: Schema.string().default('') }).default({ provider: '', model: '' }),

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

type HostSettings = { register<T>(namespace: string, schema: unknown): unknown }

/** Host owns the editor's one durable writing-preference namespace. */
export function apply(ctx: Context, config: ShellFeatureConfig = {}): void {
  ;(ctx as Context & { settings: HostSettings }).settings.register<WritingPreferences>(WRITING_SETTINGS_NAMESPACE, WritingPreferencesSchema)
  ctx.effect(() => registerHostRpc(ctx as Context & HostRpcContext, SHELL_RPC_CHANNEL, async (endpoint) => {
    if (endpoint !== 'capabilities.get') return { ok: false, error: { code: 'bad-request', message: '不支持的界面操作', details: {} } }
    return resolveShellCapabilities(config, (name) => ctx.get(name))
  }))
}
