import type { Context } from '@deepseek-ai/cordis'
import type { ZhihuService } from './index.ts'
import { createZhihuSearchTool, createZhihuGlobalSearchTool, createZhihuHotListTool, createZhihuAskTool, createZhihuKnowledgeSearchTool } from './tool-definitions.ts'
export const name = 'dsh-zhihu-tools'
export const inject = ['zhihu', 'tools'] as const
export function apply(ctx: Context): void {
  const host = ctx as Context & { zhihu: ZhihuService; tools: { register: (tool: unknown) => unknown } }
  const options = host.zhihu.toolOptions
  for (const create of [createZhihuSearchTool, createZhihuGlobalSearchTool, createZhihuHotListTool, createZhihuAskTool, createZhihuKnowledgeSearchTool]) {
    const tool = create(options)
    const execute = tool.execute as unknown as (args: unknown, exec: { signal: AbortSignal }) => Promise<unknown>
    host.tools.register({ ...tool, execute: (args: unknown, exec: { signal: AbortSignal }) =>
      host.zhihu.run(signal => execute(args, { ...exec, signal }), exec.signal) })
  }
}
