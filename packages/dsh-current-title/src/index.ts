import type { Context } from '@deepseek-ai/cordis'
import type { AiServices } from '@klarkxy/dsh-ai-services/contracts'
import { registerHostRpc, type HostRpcContext } from '@klarkxy/dsh-ai-services/host-rpc'
import { isTitleLocaleMode, PLUGIN_NAME, RPC_CHANNEL, SETTINGS_KEY, type TitleLocaleMode } from './contracts.ts'
import { CurrentTitleService, handleRpc, hostLocalePreference } from './service.ts'
import type { LoaderFace, SessionTitleServiceLike } from './native-slot.ts'
import type { SessionLike } from './messages.ts'
import { parseTitleSettings, titleDomain } from './storage.ts'

export const name = PLUGIN_NAME
export const inject = ['sessionTitle', 'aiServices', 'sessions', 'loader', 'storageDomain', 'connection', 'webServer'] as const
export { CurrentTitleService }
export { selectRecentMessages, frameMessages } from './input.ts'
export { parseModelTitle, formatTitle, resolveTitleLocale } from './output.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { currentTitle: CurrentTitleService }
}

type DomainHandle = {
  table(name: 'settings'): {
    get(key: string): unknown
    put(key: string, value: unknown): Promise<void>
  }
  close(): Promise<void>
}

type Host = Context & HostRpcContext & {
  sessionTitle: SessionTitleServiceLike
  aiServices: AiServices
  sessions: { get(id: string): SessionLike | undefined }
  loader: LoaderFace
  storageDomain: { open: (spec: typeof titleDomain) => Promise<DomainHandle> }
}

export async function apply(ctx: Context, config: { locale?: TitleLocaleMode } = {}): Promise<void> {
  const host = ctx as Host
  const domain = await host.storageDomain.open(titleDomain)
  const table = domain.table('settings')
  const locale = isTitleLocaleMode(config.locale) ? config.locale : 'auto'
  const service = new CurrentTitleService({
    plugin: PLUGIN_NAME,
    ai: host.aiServices,
    sessionTitle: host.sessionTitle,
    loader: host.loader,
    sessions: host.sessions,
    store: {
      load: () => parseTitleSettings(table.get(SETTINGS_KEY)),
      save: settings => table.put(SETTINGS_KEY, settings),
    },
    initialLocale: locale,
    localePreference: () => hostLocalePreference(host),
  })
  await service.start()
  ctx.provide('currentTitle', service)
  ctx.effect(() => async () => { await service.dispose(); await domain.close() }, 'current-title.lifecycle')
  ctx.effect(() => registerHostRpc(host, RPC_CHANNEL, (endpoint, payload, signal) => handleRpc(service, endpoint, payload, signal)), 'current-title.rpc')
}
