/*
 * 搭档对话的宿主设置半侧：命名空间 ui-bot 记录闲置回顾与缓存有效期，
 * 客户端经设置 scope 读取；当前只注册与解码，不驱动行为。
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

export const name = 'dsh-editor-bot-settings'

export const Config = Schema.object({
  idleRecapMinutes: Schema.number().min(1).max(240).default(15).volatile(),
  cacheTtlMinutes: Schema.number().min(0).max(1440).default(60).volatile(),
})

export function apply(_ctx: Context, _config: unknown): void {
  /* Namespace registration is the contribution; the client reads it through settings scopes. */
}
