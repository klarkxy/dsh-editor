/**
 * 按需读取项目文档的工具。
 *
 * 设计说明：
 *   - 不直接耦合 host fs：在工厂参数里接收 `reader({ path, signal, cwd })`，
 *     由 `index.ts` 负责把 ctx.fs 适配成这个签名，单元测试传内存 stub。
 *   - cwd 来自 `exec.agent?.session?.header?.cwd`（与 dsh-grill 的
 *     scaffold_novel 一致），缺则抛 ProjectKnowledgeError；不静默回退到
 *     process.cwd，避免越权读取工作区外的文件。
 *   - 路径必须是工作区相对，禁止绝对路径、`..`、隐藏目录；只接受
 *     .md / .txt。`safeRelativeProjectPath` 与 proposal-tool 里的检查保持一致。
 *   - 每份文件单独截断 6000 字符并标注 [截断]；文件不存在仅让该条
 *     目标记"未找到"，整体不报错。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { PROJECT_KNOWLEDGE_TOOL_NAME } from './contracts.ts'

export { PROJECT_KNOWLEDGE_TOOL_NAME } from './contracts.ts'
export const PROJECT_KNOWLEDGE_VERSION = 1
export const PROJECT_KNOWLEDGE_MAX_PATHS = 3
export const PROJECT_KNOWLEDGE_MIN_PATHS = 1
export const PROJECT_KNOWLEDGE_MAX_CHARS = 6_000
const ALLOWED_EXTENSIONS = ['.md', '.txt'] as const

export type ProjectKnowledgeFile =
  | { path: string; ok: true; content: string; truncated: boolean; bytes: number }
  | { path: string; ok: false; reason: string }

export type ProjectKnowledgeResult = {
  version: typeof PROJECT_KNOWLEDGE_VERSION
  files: ProjectKnowledgeFile[]
}

export type ProjectKnowledgeReader = (args: { path: string; signal: AbortSignal; cwd: string }) => Promise<string>

export class ProjectKnowledgeError extends Error {
  readonly code: 'INVALID_ARGS' | 'TOO_LARGE' | 'UNREADABLE'
  constructor(code: ProjectKnowledgeError['code'], message: string) {
    super(message)
    this.name = 'ProjectKnowledgeError'
    this.code = code
  }
}

export function normalizeProjectKnowledgeArguments(args: Readonly<Record<string, unknown>>): string[] {
  if (Object.keys(args).length !== 1 || args.paths === undefined || !Array.isArray(args.paths)) {
    throw new ProjectKnowledgeError('INVALID_ARGS', 'project_knowledge 只接受 paths 数组')
  }
  const raw = args.paths
  if (raw.length < PROJECT_KNOWLEDGE_MIN_PATHS || raw.length > PROJECT_KNOWLEDGE_MAX_PATHS) {
    throw new ProjectKnowledgeError('INVALID_ARGS', `paths 需要 ${PROJECT_KNOWLEDGE_MIN_PATHS}-${PROJECT_KNOWLEDGE_MAX_PATHS} 项`)
  }
  const seen = new Set<string>()
  const out: string[] = []
  for (const entry of raw) {
    if (typeof entry !== 'string' || entry.length === 0) {
      throw new ProjectKnowledgeError('INVALID_ARGS', 'paths 必须是字符串')
    }
    if (!safeRelativeProjectPath(entry)) {
      throw new ProjectKnowledgeError('INVALID_ARGS', `非法路径：${entry}`)
    }
    if (seen.has(entry)) {
      throw new ProjectKnowledgeError('INVALID_ARGS', `重复路径：${entry}`)
    }
    seen.add(entry)
    out.push(entry)
  }
  return out
}

export function isProjectKnowledgeArguments(args: Readonly<Record<string, unknown>>): boolean {
  try {
    normalizeProjectKnowledgeArguments(args)
    return true
  } catch {
    return false
  }
}

function safeRelativeProjectPath(value: string): boolean {
  if (typeof value !== 'string' || value.includes('\0')) return false
  const path = value.replace(/\\/g, '/')
  if (path.startsWith('/') || /^[a-z]:/i.test(path) || path.includes(':') || path.split('/').includes('..')) return false
  if (path.split('/').some((part) => part.startsWith('.'))) return false
  const lower = path.toLowerCase()
  return ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

function truncate(text: string, limit: number): { content: string; truncated: boolean } {
  if (text.length <= limit) return { content: text, truncated: false }
  return { content: `${text.slice(0, limit)}\n\n[截断：原文共 ${text.length} 字符，已截到 ${limit} 字符]`, truncated: true }
}

export type LoadProjectKnowledgeOptions = {
  signal: AbortSignal
  cwd: string
}

export async function loadProjectKnowledge(
  paths: readonly string[],
  reader: ProjectKnowledgeReader,
  options: LoadProjectKnowledgeOptions,
): Promise<ProjectKnowledgeResult> {
  const files: ProjectKnowledgeFile[] = []
  for (const path of paths) {
    try {
      const raw = await reader({ path, signal: options.signal, cwd: options.cwd })
      const { content, truncated } = truncate(raw, PROJECT_KNOWLEDGE_MAX_CHARS)
      files.push({ path, ok: true, content, truncated, bytes: raw.length })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      files.push({ path, ok: false, reason: `未找到（${reason || '读取失败'}）` })
    }
  }
  return { version: PROJECT_KNOWLEDGE_VERSION, files }
}

export function renderProjectKnowledge(result: ProjectKnowledgeResult): string {
  const lines: string[] = [`项目资料（${result.files.length} 个文件）：`, '']
  result.files.forEach((file) => {
    if (file.ok) {
      lines.push(`### ${file.path}`)
      if (file.truncated) lines.push('（已截断）')
      lines.push('')
      lines.push(file.content)
    } else {
      lines.push(`### ${file.path}`)
      lines.push(file.reason)
    }
    lines.push('')
  })
  return lines.join('\n').trimEnd()
}

export type CreateProjectKnowledgeToolOptions = {
  reader: ProjectKnowledgeReader
}

export function createProjectKnowledgeTool(options: CreateProjectKnowledgeToolOptions) {
  if (!options.reader) throw new ProjectKnowledgeError('INVALID_ARGS', 'project_knowledge 需要注入 reader')
  return defineTool({
    name: PROJECT_KNOWLEDGE_TOOL_NAME,
    description: '按需读取 1-3 份项目 Markdown/纯文本材料（每份上限 6000 字符）。仅返回项目事实材料，优先级高于网络结果但仍非 canon。',
    parameters: {
      paths: {
        type: 'array',
        required: true,
        description: '1-3 个工作区相对路径，仅 .md / .txt，禁止 .. 与隐藏目录。',
        items: { type: 'string' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          version: { type: 'integer', required: true },
          files: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                ok: { type: 'boolean', required: true },
                content: { type: 'string' },
                truncated: { type: 'boolean' },
                bytes: { type: 'integer' },
                reason: { type: 'string' },
              },
            },
          },
        },
      },
      render(_args, value) {
        return [{ type: 'text' as const, text: renderProjectKnowledge(value as ProjectKnowledgeResult) }]
      },
    },
    isConcurrencySafe() { return true },
    async execute(args, exec) {
      const paths = normalizeProjectKnowledgeArguments(args as Readonly<Record<string, unknown>>)
      const cwd = exec.agent?.session?.header?.cwd
      if (typeof cwd !== 'string' || cwd.length === 0) {
        throw new ProjectKnowledgeError('UNREADABLE', 'project_knowledge 需要当前 agent 会话工作目录')
      }
      return await loadProjectKnowledge(paths, options.reader, { signal: exec.signal, cwd })
    },
  })
}
