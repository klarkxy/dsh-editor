/**
 * 作品索引直写工具。
 *
 * 设计说明：
 *   - 作品索引（.dsh-editor/作品索引.md）是产品内部状态，不是作者内容：
 *     它可以从工作区扫描随时再生，预览确认没有价值，反而曾把索引回合
 *     锁死在"stub 丢失 → edit 提案永远 expired"的状态。因此这个工具
 *     直接落盘，不形成提案、不在聊天里出卡片（Shell 按工具名隐藏结果行）。
 *   - 路径固定为 NOVEL_INDEX_PATH，模型只给全文 text；没有路径参数，
 *     从根上杜绝写错位置。守卫（proposal-tool.ts 的 editorToolGuard）
 *     也只放行 text 一个参数。
 *   - 与 project-knowledge 同一注入模式：工厂接收 writer({ text, signal, cwd, session })，
 *     由 index.ts 把 ctx.fs 的 resolve + writeText（带会话沙箱策略）适配成这个签名，
 *     单元测试传内存 stub。
 *   - cwd 来自 exec.agent?.session?.header?.cwd，缺失即抛错，不静默回退。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { NOVEL_INDEX_PATH, NOVEL_INDEX_WRITE_TOOL_NAME } from './contracts.ts'

export { NOVEL_INDEX_PATH, NOVEL_INDEX_WRITE_TOOL_NAME } from './contracts.ts'

export const NOVEL_INDEX_WRITE_VERSION = 1
export const NOVEL_INDEX_WRITE_MAX_CHARS = 200_000

export type IndexWriteResult = {
  version: typeof NOVEL_INDEX_WRITE_VERSION
  path: typeof NOVEL_INDEX_PATH
  chars: number
}

export type IndexWriter = (args: { text: string; signal: AbortSignal; cwd: string; session: unknown }) => Promise<unknown>

export class IndexWriteError extends Error {
  readonly code: 'INVALID_ARGS' | 'UNWRITABLE'
  constructor(code: IndexWriteError['code'], message: string) {
    super(message)
    this.name = 'IndexWriteError'
    this.code = code
  }
}

export function normalizeIndexWriteArguments(args: Readonly<Record<string, unknown>>): string {
  if (Object.keys(args).length !== 1 || typeof args.text !== 'string') {
    throw new IndexWriteError('INVALID_ARGS', 'novel_index_write 只接受 text 一个参数')
  }
  const text = args.text.trim()
  if (!text) throw new IndexWriteError('INVALID_ARGS', 'novel_index_write 的 text 不能为空')
  if (text.length > NOVEL_INDEX_WRITE_MAX_CHARS) {
    throw new IndexWriteError('INVALID_ARGS', `novel_index_write 的 text 不能超过 ${NOVEL_INDEX_WRITE_MAX_CHARS} 字符`)
  }
  return args.text
}

export function createIndexWriteTool(options: { writer: IndexWriter }) {
  if (!options.writer) throw new IndexWriteError('INVALID_ARGS', 'novel_index_write 需要注入 writer')
  return defineTool({
    name: NOVEL_INDEX_WRITE_TOOL_NAME,
    description: 'Write the full content of the internal work index (.dsh-editor/作品索引.md), creating or replacing it directly. Internal product state: never use novel_propose for this file.',
    parameters: {
      text: { type: 'string', required: true, description: 'Complete Markdown content of the work index.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          version: { type: 'integer', required: true },
          path: { type: 'string', required: true },
          chars: { type: 'integer', required: true },
        },
      },
      render(_args, value) {
        const result = value as IndexWriteResult
        /* 不带完整点路径：窗口截断导致 call 名丢失时，结果行降级为通用行也不泄露内部路径。 */
        return [{ type: 'text' as const, text: `作品索引已写入（${result.chars} 字符）。` }]
      },
    },
    isConcurrencySafe() { return false },
    async execute(args, exec) {
      const text = normalizeIndexWriteArguments(args as Readonly<Record<string, unknown>>)
      const session = exec.agent?.session
      const cwd = session?.header?.cwd
      if (typeof cwd !== 'string' || cwd.length === 0) {
        throw new IndexWriteError('UNWRITABLE', 'novel_index_write 需要当前 agent 会话工作目录')
      }
      /* 必须带上会话沙箱策略：不带时 fs 回退到宿主进程 cwd 作为可写根，
         工作区内的索引文件反而会被 workspace-write 拒绝（本次事故的实测）。 */
      await options.writer({ text, signal: exec.signal, cwd, session })
      return { version: NOVEL_INDEX_WRITE_VERSION, path: NOVEL_INDEX_PATH, chars: text.length } satisfies IndexWriteResult
    },
  })
}
