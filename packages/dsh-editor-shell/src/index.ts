import type { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import type { SettingsForms } from '@deepseek-ai/dsh-settings'
import { importWritingModels } from './writing-ai-migration.ts'
import type { Context } from '@deepseek-ai/cordis'
import { registerHostRpc, type HostRpcContext } from '@klarkxy/dsh-plugin-kit/host-rpc'
import { SHELL_RPC_CHANNEL, resolveShellCapabilities, type ShellFeatureConfig } from './capabilities.ts'
import Schema from '@deepseek-ai/schemastery'
import type { EditorWritingPreferences, WritingModelMigrationStatus } from './writing-settings-contract.ts'

export const name = 'dsh-editor-shell'
export const inject = ['editorWritingPreferences', 'settings', 'storageDomain', 'connection', 'webServer', 'loader'] as const
export const Config: Schema<ShellFeatureConfig> = Schema.object({
  features: Schema.dict(Schema.string()).default({}),
  featureEntries: Schema.dict(Schema.array(Schema.string())).default({}),
})

/** Host owns the editor's one durable writing-preference namespace. */
export async function apply(ctx: Context, config: ShellFeatureConfig = {}): Promise<void> {
  const loader = ctx.get('loader') as { await(): Promise<void>; entries(): Iterable<{ id: string; disabled: boolean }> }
  const preferences = ctx.get('editorWritingPreferences') as EditorWritingPreferences
  const loaderReady = Promise.resolve().then(() => loader.await())
  let disposed = false
  let migrationError: string | undefined
  let migrating: Promise<void> | undefined
  const migrate = () => migrating ??= loaderReady.then(() => {
    if (disposed) return
    return importWritingModels(ctx.get('storageDomain') as DomainFacility, ctx.get('settings') as SettingsForms)
  })
    .then(() => { migrationError = undefined })
    .catch((error) => { migrationError = `旧写作模型配置迁移失败：${error instanceof Error ? error.message : String(error)} 请重试。` })
    .finally(() => { migrating = undefined })
  // Loader must finish applying this plugin before native settings writes may reload it.
  // Never await this promise from apply: settings.mutate also waits for Loader readiness.
  const initialMigration = migrate()
  const waitMigration = async () => {
    await initialMigration
    if (migrating) await migrating
  }
  const modelsReady = async () => {
    await waitMigration()
    if (disposed) throw new Error('模型配置服务已关闭。')
    if (migrationError) throw new Error(migrationError)
  }
  ctx.effect(() => {
    const hadPrevious = Object.hasOwn(preferences, 'modelsReady')
    const previous = preferences.modelsReady
    preferences.modelsReady = modelsReady
    return () => {
      disposed = true
      if (preferences.modelsReady !== modelsReady) return
      if (hadPrevious) preferences.modelsReady = previous
      else delete preferences.modelsReady
    }
  }, 'shell.writing-model-readiness')
  ctx.effect(() => registerHostRpc(ctx as Context & HostRpcContext, SHELL_RPC_CHANNEL, async (endpoint) => {
    if (endpoint === 'models.migration.status' || endpoint === 'models.migrate') {
      await waitMigration()
      if (disposed) return { ok: false, error: { code: 'internal', message: '模型配置服务已关闭。', details: {} } }
      if (endpoint === 'models.migrate') await migrate()
      if (disposed) return { ok: false, error: { code: 'internal', message: '模型配置服务已关闭。', details: {} } }
      const selected = preferences.read().chatModel
      const value: WritingModelMigrationStatus = {
        ...(migrationError ? { error: migrationError } : {}),
        ...(selected === undefined ? {} : { chatModel: {
          provider: selected.provider,
          model: selected.model,
          ...(selected.reasoningEffort === undefined ? {} : { reasoningEffort: selected.reasoningEffort }),
        } }),
      }
      return { ok: true, value }
    }
    if (endpoint !== 'capabilities.get') return { ok: false, error: { code: 'bad-request', message: '不支持的界面操作', details: {} } }
    const disabled = new Set([...loader.entries()].filter(entry => entry.disabled).map(entry => entry.id.replace(/^include:/, '')))
    return resolveShellCapabilities(config, (name) => ctx.get(name, true), id => disabled.has(id))
  }))
}
