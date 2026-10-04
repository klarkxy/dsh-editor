/*
 * 破限模式的宿主半侧：把设置命名空间 ui-limit-break 变成一个布尔开关，
 * 开启时向系统提示词追加 agents-spec.md。
 *
 * 为什么是"常驻注册 + 动态文本"：SystemPrompt.section 的 text 允许传一个在
 * 每次组装时求值的 provider（见 DSH 系统提示词文档），config 字段又是 volatile，
 * 因此开关一改下一次组装就生效，不需要重载插件。关闭时返回空串，该段不贡献任何文本。
 *
 * 段落排在 novel-kernel（order 90）之后：破限规约是最后一条生效指令。
 * 不使用 complete: true —— 那会把宿主自己的脾气、工具与写作工作流整段顶掉。
 */

import { readFileSync } from 'node:fs'
import type { Context, Volatile } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

export const name = 'dsh-editor-limit-break-settings'
/** apply 在 systemPrompt 就绪后才跑；不然注册段落时会拿到 undefined。 */
export const inject = ['systemPrompt'] as const

export const LIMIT_BREAK_SECTION_NAME = 'dsh-editor:limit-break'
export const LIMIT_BREAK_SECTION_ORDER = 95

/** 仓库根 AGENTS.md 的逐字副本；提示词按原样注入，不加包装。 */
const AGENT_SPEC = readFileSync(new URL('../resources/limit-break/agents-spec.md', import.meta.url), 'utf8').trim()

export const Config = Schema.object({ limitBreakMode: Schema.boolean().default(false).volatile() })

type LimitBreakHost = {
  systemPrompt: {
    section(section: { name: string; order: number; text: string | ((context: unknown) => string) }): () => void
  }
}

/** 未开启时返回空串，不贡献段落；读取的是 volatile 字段的当前值。 */
export function limitBreakPrompt(config: { limitBreakMode: Volatile<boolean> }): string {
  return config.limitBreakMode.get() === true ? AGENT_SPEC : ''
}

export function apply(ctx: Context, config: { limitBreakMode: Volatile<boolean> }): void {
  const host = ctx as Context & LimitBreakHost
  ctx.effect(() => host.systemPrompt.section({
    name: LIMIT_BREAK_SECTION_NAME,
    order: LIMIT_BREAK_SECTION_ORDER,
    text: () => limitBreakPrompt(config),
  }))
}
