import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  AUTHOR_MEMORY_MARKER,
  AUTHOR_OBSERVE_MAX_CHARS,
  AUTHOR_OBSERVE_TOOL_NAME,
  authorMemoryMarker,
  type AuthorMemoryMarker,
} from './contracts.ts'

export { AUTHOR_MEMORY_MARKER, AUTHOR_OBSERVE_MAX_CHARS, AUTHOR_OBSERVE_TOOL_NAME, authorMemoryMarker, type AuthorMemoryMarker } from './contracts.ts'

/**
 * author_observe：助手在协作中观察作者稳定偏好或雷点时，提议把"一条偏好/雷点"
 * 追加进 authorMemory。本工具只产出 marker 走 dsh-editor-novel-kernel/contracts
 * 的严格解析，不写任何 Host 文件；作者必须确认才由 Shell 追加到本机 authorMemory。
 *
 * 与 novel_propose 的信任模型完全一致：execute 只返回 marker JSON，确认权在作者手里。
 */
export function createAuthorObserveTool() {
  return defineTool({
    name: AUTHOR_OBSERVE_TOOL_NAME,
    description: '提议把一条稳定的作者偏好或雷点追加到本机"作者侧写"。每次只追加一条，宁缺毋滥；未经作者确认不会写入。',
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
