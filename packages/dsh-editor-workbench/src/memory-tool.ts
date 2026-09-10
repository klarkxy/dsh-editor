import { defineTool } from '@deepseek-ai/dsh-tools'
import { withWorkspaceWrite } from 'dsh-manuscript/host-api'
import { updateMemory, type MemoryAccess } from './memory.ts'

export const MEMORY_UPDATE_TOOL_NAME = 'novel_memory_update'
export function createMemoryUpdateTool(resolve: (sessionId: string, signal: AbortSignal) => Promise<MemoryAccess>) {
  return defineTool({
    name: MEMORY_UPDATE_TOOL_NAME,
    description: '协作中维护项目规则、世界书或人物卡。先 read 目标与来源，使用回执中的文件版本。明确长期要求、无冲突新事实可自动创建或追加；推断、歧义、修订已有内容必须 certainty=uncertain 或 operation=edit，形成待确认提案。正文对话/谎言不自动当成事实，事件注明章节。只在当前任务自然发现内容时使用，不必每轮维护。',
    parameters: {
      path: { type: 'string', required: true, description: '根 AGENTS.md（沿用已有大小写）或 世界书/、人物卡/ 下的 Markdown。' },
      operation: { type: 'string', enum: ['create', 'append', 'edit'], required: true },
      summary: { type: 'string', required: true, description: '向作者说明为什么需要这项更新。' },
      category: { type: 'string', enum: ['rule', 'fact'], required: true },
      certainty: { type: 'string', enum: ['explicit', 'uncertain'], required: true, description: '只有明确长期要求或已核实、无冲突的新事实使用 explicit；不确定就 uncertain。' },
      expectedVersion: { type: 'string', description: 'read 回执的文件版本；新建文件省略。不得猜测版本。' },
      text: { type: 'string', description: 'create 完整内容或 append 新增内容。' },
      oldText: { type: 'string', description: 'edit 的唯一原文片段。' },
      newText: { type: 'string', description: 'edit 的替换片段。' },
      evidence: {
        type: 'array', required: true,
        items: { type: 'object', additionalProperties: false, properties: {
          kind: { type: 'string', enum: ['file', 'user'], required: true },
          path: { type: 'string', description: 'file 来源的项目相对路径。' },
          version: { type: 'string', description: 'file 来源 read 回执的版本。' },
          messageId: { type: 'string', description: 'user 来源消息标识，current 表示当前作者消息。' },
          quote: { type: 'string', required: true, description: '来源中逐字存在的原文，不能引用模型推测。' },
        } },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        marker: { type: 'string', required: true }, version: { type: 'integer', required: true }, id: { type: 'string', required: true },
        path: { type: 'string', required: true }, summary: { type: 'string', required: true }, status: { type: 'string', required: true }, createdAt: { type: 'string', required: true }, message: { type: 'string' },
      } },
      render: (_args, value) => [{ type: 'text' as const, text: JSON.stringify(value) }],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const sessionId = exec.agent?.session?.id
      if (!sessionId) throw new Error('维护工具需要当前执行会话。')
      const access = await resolve(String(sessionId), exec.signal)
      return withWorkspaceWrite(access.rootKey, () => updateMemory(access, { ...args, expectedVersion: args.expectedVersion ?? null }))
    },
  })
}
