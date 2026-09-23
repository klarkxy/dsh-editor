import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  AUTHOR_OBSERVE_MAX_CHARS,
  AUTHOR_OBSERVE_TOOL_NAME,
  authorMemoryMarker,
} from './author-memory.ts'

export {
  AUTHOR_MEMORY_MARKER,
  AUTHOR_OBSERVE_MAX_CHARS,
  AUTHOR_OBSERVE_TOOL_NAME,
  authorMemoryMarker,
  type AuthorMemoryMarker,
} from './author-memory.ts'

/**
 * author_observe：助手在协作中观察作者稳定偏好或雷点时，把"一条偏好/雷点"
 * 追加进 authorMemory。本工具只产出 marker 走 workbench contracts 的严格解析，
 * 不写任何 Host 文件；Shell 客户端解析 marker 后静默追加到本机 authorMemory，
 * 不再向作者展示确认卡片。
 */
export function createAuthorObserveTool() {
  return defineTool({
    name: AUTHOR_OBSERVE_TOOL_NAME,
    description: '把一条稳定的作者偏好或雷点追加到本机"作者侧写"。每次只追加一条，宁缺毋滥；观察到的偏好会直接记住，无需作者确认。',
    parameters: {
      observation: { type: 'string', required: true, description: `稳定、跨作品可复用的偏好或雷点（≤ ${AUTHOR_OBSERVE_MAX_CHARS} 字）。` },
      reason: { type: 'string', required: true, description: '为什么这是稳定、重复的偏好，而不是单次要求或作品设定。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          marker: { type: 'string', required: true },
          version: { type: 'integer', required: true },
          observation: { type: 'string', required: true },
          reason: { type: 'string', required: true },
        },
      },
      render(_args, value) {
        return [{ type: 'text' as const, text: JSON.stringify(value) }]
      },
    },
    isConcurrencySafe() { return true },
    async execute(args) { return authorMemoryMarker(args as Record<string, unknown>) },
  })
}
