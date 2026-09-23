import type { AiServices } from '@klarkxy/dsh-ai-services/contracts'
import { importWritingModels } from './writing-ai-migration.ts'
import type { Context } from '@deepseek-ai/cordis'
import { registerHostRpc, type HostRpcContext } from 'dsh-manuscript/host-api'
import { SHELL_RPC_CHANNEL, resolveShellCapabilities, type ShellFeatureConfig } from './capabilities.ts'
import Schema from '@deepseek-ai/schemastery'

export const name = 'dsh-editor-shell'
export const inject = ['aiServices', 'agentDefaultModel', 'editorWritingPreferences', 'connection', 'webServer'] as const
export const Config: Schema<ShellFeatureConfig> = Schema.object({
  features: Schema.dict(Schema.string()).default({}),
})

/** Host owns the editor's one durable writing-preference namespace. */
export async function apply(ctx: Context, config: ShellFeatureConfig = {}): Promise<void> {
  const migration: { ready?: Promise<void>; error?: string } = {}
  ctx.provide('writingAiMigration', migration)
  migration.ready = importWritingModels(ctx.get('aiServices') as AiServices, (ctx.get('editorWritingPreferences') as { read(): unknown }).read(),
    (ctx.get('agentDefaultModel') as { currentSelection?(): import('@klarkxy/dsh-ai-services/contracts').ModelRoute } | undefined)?.currentSelection?.())
    .catch(() => { migration.error = '旧写作模型配置迁移失败。请在模型设置中重新选择补全和改写模型，然后重新加载界面。' })
  await migration.ready
  ctx.effect(() => {
    const scope = (ctx.get('aiServices') as AiServices).activate(name)
    scope.registerPurpose({ id: 'chat', label: '新对话', defaultTarget: { kind: 'role', role: 'normal' } })
    return () => scope.dispose()
  }, 'shell.chat-model')
  ctx.effect(() => registerHostRpc(ctx as Context & HostRpcContext, SHELL_RPC_CHANNEL, async (endpoint) => {
    if (endpoint !== 'capabilities.get') return { ok: false, error: { code: 'bad-request', message: '不支持的界面操作', details: {} } }
    return resolveShellCapabilities(config, (name) => ctx.get(name))
  }))
}
