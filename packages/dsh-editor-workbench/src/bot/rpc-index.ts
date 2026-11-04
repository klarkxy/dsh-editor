import type { Context } from '@deepseek-ai/cordis'
import type { WorkbenchHandlers } from '../rpc/types.ts'
import { botHandlers, type BotRpcDeps } from './rpc.ts'
import { createBotRpcDeps } from './deps.ts'

let runtime: { ctx: Context; deps: BotRpcDeps; handlers: WorkbenchHandlers } | undefined

/** Called once from workbench apply(); handlers resolve lazily so the static map stays declarative. */
export function installBotRuntime(ctx: Context): void {
  const deps = createBotRpcDeps(ctx)
  runtime = { ctx, deps, handlers: botHandlers(ctx, deps) }
}

function endpoint(name: string) {
  return {
    run(request: Parameters<NonNullable<WorkbenchHandlers[string]>['run']>[0]) {
      if (!runtime) throw new Error(`bot runtime not installed for ${name}`)
      return runtime.handlers[name]!.run(request)
    },
  }
}

export const botHandlersForIndex: Record<'bot.state' | 'bot.check' | 'bot.prepareHandoff' | 'bot.attach' | 'bot.history' | 'bot.initialize', WorkbenchHandlers[string]> = {
  'bot.state': endpoint('bot.state'),
  'bot.check': endpoint('bot.check'),
  'bot.prepareHandoff': endpoint('bot.prepareHandoff'),
  'bot.attach': endpoint('bot.attach'),
  'bot.history': endpoint('bot.history'),
  'bot.initialize': { ...endpoint('bot.initialize'), mutation: true },
}
