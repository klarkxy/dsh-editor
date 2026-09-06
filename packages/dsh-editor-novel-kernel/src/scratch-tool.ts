/**
 * agent 临时工作区（scratch）工具族。
 *
 * 设计说明：
 *   - scratch 位于 .dsh-editor/scratch/，是 agent 自己的工作草稿区：分析草稿、
 *     中间笔记等不想给作者看、也不进上下文信封的内容。它不是作品事实来源，
 *     不是 canon；需要长期留存的作品信息仍走提案或作品索引。
 *   - 自由只在目录内：路径参数一律相对 scratch 根，拒绝绝对路径、盘符、
 *     `..` 与隐藏段，拼接后必然落在 scratch 内；只接受 .md/.txt。
 *   - 总量有界：单文件 ≤ SCRATCH_MAX_FILE_CHARS，目录内文件数 ≤ SCRATCH_MAX_FILES，
 *     防止注入内容把它当无限仓库。文件数上限在写入时按实际列表判断（覆盖现有文件不受限）。
 *   - 与 novel_index_write 同一注入模式：工厂接收 ScratchStore 高级操作，
 *     由 index.ts 把 ctx.fs + 会话沙箱策略适配进来，单元测试传内存 stub。
 *     适配层每次写入顺带维护 scratch/.gitignore（内容 `*`），让作者自管的
 *     git 工作区不跟踪草稿；产品自身快照本就排除隐藏目录。
 *   - Shell 按工具名隐藏三个工具的结果行（HIDDEN_TOOL_NAMES）。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  NOVEL_SCRATCH_LIST_TOOL_NAME,
  NOVEL_SCRATCH_READ_TOOL_NAME,
  NOVEL_SCRATCH_WRITE_TOOL_NAME,
  SCRATCH_MAX_FILE_CHARS,
  SCRATCH_MAX_FILES,
} from './contracts.ts'

export {
  NOVEL_SCRATCH_LIST_TOOL_NAME,
  NOVEL_SCRATCH_READ_TOOL_NAME,
  NOVEL_SCRATCH_WRITE_TOOL_NAME,
  SCRATCH_DIRECTORY,
  SCRATCH_MAX_FILE_CHARS,
  SCRATCH_MAX_FILES,
} from './contracts.ts'

export const NOVEL_SCRATCH_VERSION = 1

/** list 递归遍历的兜底上限，远超 SCRATCH_MAX_FILES，只防异常目录拖住回合。 */
const SCRATCH_LIST_SCAN_CAP = 200

export class ScratchError extends Error {
  readonly code: 'INVALID_ARGS' | 'UNREADABLE' | 'UNWRITABLE' | 'LIMIT'
  constructor(code: ScratchError['code'], message: string) {
    super(message)
    this.name = 'ScratchError'
    this.code = code
  }
}

export type ScratchStore = {
  read(args: { path: string; signal: AbortSignal; cwd: string }): Promise<string>
  write(args: { path: string; text: string; signal: AbortSignal; cwd: string; session: unknown }): Promise<void>
  /** scratch 根下的相对路径列表（.md/.txt，不含隐藏项）；目录不存在时返回空表。 */
  list(args: { signal: AbortSignal; cwd: string }): Promise<string[]>
}

/** 纯路径校验，供工具与 editorToolGuard 共用；返回规范化的相对路径。 */
export function isScratchRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.includes('\0')) return false
  const path = value.replace(/\\/g, '/')
  if (!path || path.startsWith('/') || /^[a-z]:/i.test(path) || path.includes(':')) return false
  const parts = path.split('/')
  if (parts.length > 3) return false
  if (parts.some((part) => !part || part === '.' || part === '..' || part.startsWith('.'))) return false
  return /\.(md|txt)$/i.test(path)
}

function normalizeWriteArguments(args: Readonly<Record<string, unknown>>): { path: string; text: string } {
  if (Object.keys(args).length !== 2 || !isScratchRelativePath(args.path)) {
    throw new ScratchError('INVALID_ARGS', 'novel_scratch_write 需要 scratch 相对路径（.md/.txt）与 text')
  }
  if (typeof args.text !== 'string') throw new ScratchError('INVALID_ARGS', 'novel_scratch_write 的 text 必须是字符串')
  if (args.text.length > SCRATCH_MAX_FILE_CHARS) {
    throw new ScratchError('INVALID_ARGS', `novel_scratch_write 的 text 不能超过 ${SCRATCH_MAX_FILE_CHARS} 字符`)
  }
  return { path: args.path.replace(/\\/g, '/'), text: args.text }
}

function normalizeReadArguments(args: Readonly<Record<string, unknown>>): string {
  if (Object.keys(args).length !== 1 || !isScratchRelativePath(args.path)) {
    throw new ScratchError('INVALID_ARGS', 'novel_scratch_read 需要 scratch 相对路径（.md/.txt）')
  }
  return args.path.replace(/\\/g, '/')
}

function scratchCwd(exec: { agent?: { session?: { header?: { cwd?: string } } } }, tool: string): string {
  const cwd = exec.agent?.session?.header?.cwd
  if (typeof cwd !== 'string' || cwd.length === 0) throw new ScratchError('UNREADABLE', `${tool} 需要当前 agent 会话工作目录`)
  return cwd
}

function makeStore(options: { store?: ScratchStore }): ScratchStore {
  if (!options.store) throw new ScratchError('UNWRITABLE', 'scratch 工具需要注入 store')
  return options.store
}

export function createScratchWriteTool(options: { store?: ScratchStore }) {
  const store = makeStore(options)
  return defineTool({
    name: NOVEL_SCRATCH_WRITE_TOOL_NAME,
    description: '写入临时工作区（.dsh-editor/scratch/ 下的相对路径，创建或覆盖）。仅用于工作草稿，不是作品事实；长期留存的作品信息走 novel_propose 或 novel_index_write。',
    parameters: {
      path: { type: 'string', required: true, description: 'scratch 根下的相对路径，仅限 .md/.txt，最多三层。' },
      text: { type: 'string', required: true, description: `完整文件内容，最多 ${SCRATCH_MAX_FILE_CHARS} 字符。` },
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
        const result = value as { path: string; chars: number }
        return [{ type: 'text' as const, text: `临时工作区已写入 ${result.path}（${result.chars} 字符）。` }]
      },
    },
    isConcurrencySafe() { return false },
    async execute(args, exec) {
      const { path, text } = normalizeWriteArguments(args as Readonly<Record<string, unknown>>)
      const cwd = scratchCwd(exec, NOVEL_SCRATCH_WRITE_TOOL_NAME)
      const session = exec.agent?.session
      const files = await store.list({ signal: exec.signal, cwd })
      if (!files.includes(path) && files.length >= SCRATCH_MAX_FILES) {
        throw new ScratchError('LIMIT', `临时工作区最多 ${SCRATCH_MAX_FILES} 个文件，请覆盖现有文件或先清理`)
      }
      await store.write({ path, text, signal: exec.signal, cwd, session })
      return { version: NOVEL_SCRATCH_VERSION, path, chars: text.length }
    },
  })
}

export function createScratchReadTool(options: { store?: ScratchStore }) {
  const store = makeStore(options)
  return defineTool({
    name: NOVEL_SCRATCH_READ_TOOL_NAME,
    description: '读取临时工作区（.dsh-editor/scratch/）中的单个文件全文。',
    parameters: {
      path: { type: 'string', required: true, description: 'scratch 根下的相对路径，仅限 .md/.txt。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          version: { type: 'integer', required: true },
          path: { type: 'string', required: true },
          text: { type: 'string', required: true },
        },
      },
      render(_args, value) {
        const result = value as { path: string; text: string }
        return [{ type: 'text' as const, text: `${result.path}：\n\n${result.text}` }]
      },
    },
    isConcurrencySafe() { return true },
    async execute(args, exec) {
      const path = normalizeReadArguments(args as Readonly<Record<string, unknown>>)
      const cwd = scratchCwd(exec, NOVEL_SCRATCH_READ_TOOL_NAME)
      let text: string
      try {
        text = await store.read({ path, signal: exec.signal, cwd })
      } catch {
        throw new ScratchError('UNREADABLE', `临时工作区文件不存在或不可读：${path}`)
      }
      return { version: NOVEL_SCRATCH_VERSION, path, text }
    },
  })
}

export function createScratchListTool(options: { store?: ScratchStore }) {
  const store = makeStore(options)
  return defineTool({
    name: NOVEL_SCRATCH_LIST_TOOL_NAME,
    description: '列出临时工作区（.dsh-editor/scratch/）中的全部文件。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          version: { type: 'integer', required: true },
          files: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render(_args, value) {
        const result = value as { files: string[] }
        const text = result.files.length === 0 ? '临时工作区为空。' : `临时工作区共 ${result.files.length} 个文件：\n${result.files.map((file) => `- ${file}`).join('\n')}`
        return [{ type: 'text' as const, text }]
      },
    },
    isConcurrencySafe() { return true },
    async execute(_args, exec) {
      const cwd = scratchCwd(exec, NOVEL_SCRATCH_LIST_TOOL_NAME)
      const files = await store.list({ signal: exec.signal, cwd })
      return { version: NOVEL_SCRATCH_VERSION, files }
    },
  })
}

/** 供 index.ts 的 store 适配层复用：递归收集 scratch 内的 .md/.txt 相对路径。 */
export async function collectScratchFiles(
  listDir: (relative: string) => Promise<Array<{ name: string; type: 'file' | 'directory' | 'other' }>>,
): Promise<string[]> {
  const out: string[] = []
  async function visit(scope: string): Promise<void> {
    if (out.length >= SCRATCH_LIST_SCAN_CAP) return
    let entries: Array<{ name: string; type: 'file' | 'directory' | 'other' }>
    try {
      entries = await listDir(scope)
    } catch {
      return
    }
    for (const entry of entries) {
      if (out.length >= SCRATCH_LIST_SCAN_CAP) return
      if (entry.name.startsWith('.')) continue
      const relative = scope ? `${scope}/${entry.name}` : entry.name
      if (entry.type === 'directory') await visit(relative)
      else if (entry.type === 'file' && /\.(md|txt)$/i.test(entry.name)) out.push(relative)
    }
  }
  await visit('')
  return out.sort((left, right) => left.localeCompare(right))
}
