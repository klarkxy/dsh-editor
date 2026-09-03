/**
 * workbench 侧注册给 agent 的两个只读 / 元数据工具。
 *
 * 设计说明：
 *   - 工具名字符串在本文件本地常量（与内核 `novel_overview` /
 *     `novel_set_chapter_status` 同名同语义；guard 仍由内核管理）。
 *   - cwd 来自 `exec.agent?.session?.header?.cwd`——与 search-tool /
 *     project-knowledge 的写法一致；缺失则抛错，不静默回退到 process.cwd。
 *   - 解析 cwd→workspace→access 的具体逻辑通过 `resolveAccess` 注入，
 *     单元测试可传 stub。`host.workspaceRegistry.resolveByPath(cwd)` 在
 *     真实 host 上下文里完成，工具层只持有回调，避免与 cordis 强耦合。
 *   - 不写文件：novel_overview 只读；novel_set_chapter_status 走现有
 *     `setChapterStatus`（含 statusRevision 乐观锁）。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { WorkspaceFileContext } from 'dsh-manuscript/host-api'
import { readProjectOverview, setChapterStatus, type OverviewAccess } from './overview.ts'
import type { ChapterStatus, ProjectOverview } from './contracts.ts'

export const NOVEL_OVERVIEW_TOOL_NAME = 'novel_overview'
export const NOVEL_CHAPTER_STATUS_TOOL_NAME = 'novel_set_chapter_status'
export const NOVEL_OVERVIEW_VERSION = 1
export const NOVEL_CHAPTER_STATUS_VERSION = 1
const CHAPTER_STATUS_VALUES: readonly ChapterStatus[] = ['draft', 'revising', 'final']

export class WorkbenchToolError extends Error {
  readonly code: 'INVALID_ARGS' | 'STALE' | 'UNREADABLE' | 'NOT_FOUND'
  constructor(code: WorkbenchToolError['code'], message: string) {
    super(message)
    this.name = 'WorkbenchToolError'
    this.code = code
  }
}

export type OverviewAccessResolver = (cwd: string) => Promise<OverviewAccess>

export type CreateOverviewToolOptions = {
  resolveAccess: OverviewAccessResolver
}

const STATUS_KEYS: ReadonlySet<ChapterStatus> = new Set(CHAPTER_STATUS_VALUES)

function asStatus(value: unknown): ChapterStatus {
  if (typeof value === 'string' && STATUS_KEYS.has(value as ChapterStatus)) return value as ChapterStatus
  throw new WorkbenchToolError('INVALID_ARGS', 'status 必须是 draft / revising / final 之一')
}

function chapterPath(value: unknown): string {
  if (typeof value !== 'string' || !/^正文\/.+\.md$/i.test(value) || value.split('/').includes('..') || value.includes(':')) {
    throw new WorkbenchToolError('INVALID_ARGS', 'path 必须是正文/ 下的 Markdown 路径')
  }
  return value.replace(/\\/g, '/')
}

function readExecCwd(exec: { agent?: { session?: { header?: { cwd?: unknown } } } }): string {
  const cwd = exec.agent?.session?.header?.cwd
  if (typeof cwd !== 'string' || cwd.length === 0) {
    throw new WorkbenchToolError('UNREADABLE', '工具需要当前 agent 会话工作目录')
  }
  return cwd
}

/**
 * 渲染项目总览：总数行 + 章节列表 + 大纲列表。
 * 紧凑不夹空白块，工具结果走 Markdown 卡片时直接展开。
 */
export function renderNovelOverview(overview: ProjectOverview): string {
  const lines: string[] = []
  const status = overview.totals.byStatus
  lines.push(`共 ${overview.totals.chapters} 章 / 总字数 ${overview.totals.chars}（draft ${status.draft} / revising ${status.revising} / final ${status.final}）`)
  for (const chapter of overview.chapters) {
    lines.push(`- ${chapter.path} · ${chapter.status} · ${chapter.chars} 字`)
  }
  if (overview.outlines.length) {
    lines.push('')
    lines.push(`大纲（${overview.outlines.length}）：`)
    for (const outline of overview.outlines) {
      lines.push(`- ${outline.path} · ${outline.chars} 字`)
    }
  }
  if (overview.truncated || overview.skipped > 0) {
    lines.push('')
    lines.push(`⚠ 总览被截断：truncated=${overview.truncated}, skipped=${overview.skipped}`)
  }
  return lines.join('\n')
}

export function renderChapterStatus(input: { path: string; status: ChapterStatus; totals: ProjectOverview['totals'] }): string {
  const { byStatus } = input.totals
  return `${input.path} → ${input.status}（全书 draft ${byStatus.draft} / revising ${byStatus.revising} / final ${byStatus.final}）`
}

export function createNovelOverviewTool(options: CreateOverviewToolOptions) {
  if (typeof options.resolveAccess !== 'function') {
    throw new WorkbenchToolError('UNREADABLE', 'novel_overview 需要 resolveAccess 回调')
  }
  return defineTool({
    name: NOVEL_OVERVIEW_TOOL_NAME,
    description: '读取项目结构总览：章节列表（含状态、字数）、大纲列表与状态计数。只读，不修改文件。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          version: { type: 'integer', required: true },
          statusRevision: { type: 'string' },
          totals: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              chapters: { type: 'integer', required: true },
              chars: { type: 'integer', required: true },
              byStatus: {
                type: 'object',
                required: true,
                additionalProperties: false,
                properties: {
                  draft: { type: 'integer', required: true },
                  revising: { type: 'integer', required: true },
                  final: { type: 'integer', required: true },
                },
              },
            },
          },
          chapters: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                title: { type: 'string', required: true },
                status: { type: 'string', required: true },
                chars: { type: 'integer', required: true },
                empty: { type: 'boolean', required: true },
                excerpt: { type: 'string', required: true },
                modifiedAt: { type: 'string' },
              },
            },
          },
          outlines: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                title: { type: 'string', required: true },
                chars: { type: 'integer', required: true },
                excerpt: { type: 'string', required: true },
                modifiedAt: { type: 'string' },
              },
            },
          },
          truncated: { type: 'boolean', required: true },
          skipped: { type: 'integer', required: true },
        },
      },
      render(_args, value) {
        return [{ type: 'text' as const, text: renderNovelOverview(value as unknown as ProjectOverview) }]
      },
    },
    isConcurrencySafe() { return true },
    async execute(_args, exec) {
      const cwd = readExecCwd(exec)
      const access = await options.resolveAccess(cwd)
      const overview = await readProjectOverview(access)
      return toOverviewResult(overview)
    },
  })
}

/**
 * 投影到 schema 声明的形状：
 *   - `recent` 不在 schema 里，剔除；
 *   - `statusRevision` / `modifiedAt` 在 schema 里是 optional `string`，
 *     `ProjectOverview` 里是 `string | null`，用 `?? undefined` 转回。
 */
function toOverviewResult(overview: ProjectOverview) {
  return {
    version: NOVEL_OVERVIEW_VERSION,
    statusRevision: overview.statusRevision ?? undefined,
    totals: overview.totals,
    chapters: overview.chapters.map((chapter) => ({
      path: chapter.path,
      status: chapter.status,
      title: chapter.title,
      chars: chapter.chars,
      empty: chapter.empty,
      excerpt: chapter.excerpt,
      modifiedAt: chapter.modifiedAt ?? undefined,
    })),
    outlines: overview.outlines.map((outline) => ({
      path: outline.path,
      title: outline.title,
      chars: outline.chars,
      excerpt: outline.excerpt,
      modifiedAt: outline.modifiedAt ?? undefined,
    })),
    truncated: overview.truncated,
    skipped: overview.skipped,
  }
}

export type CreateChapterStatusToolOptions = {
  resolveAccess: OverviewAccessResolver
}

export function createNovelSetChapterStatusTool(options: CreateChapterStatusToolOptions) {
  if (typeof options.resolveAccess !== 'function') {
    throw new WorkbenchToolError('UNREADABLE', 'novel_set_chapter_status 需要 resolveAccess 回调')
  }
  return defineTool({
    name: NOVEL_CHAPTER_STATUS_TOOL_NAME,
    description: '设置单章状态：正文/xxx.md → draft / revising / final。乐观锁比对 statusRevision；不改章节内容。',
    parameters: {
      path: { type: 'string', required: true, description: '正文/ 下的 .md 相对路径。' },
      status: { type: 'string', required: true, description: 'draft / revising / final。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          version: { type: 'integer', required: true },
          path: { type: 'string', required: true },
          status: { type: 'string', required: true },
          statusRevision: { type: 'string' },
          totals: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              chapters: { type: 'integer', required: true },
              chars: { type: 'integer', required: true },
              byStatus: {
                type: 'object',
                required: true,
                additionalProperties: false,
                properties: {
                  draft: { type: 'integer', required: true },
                  revising: { type: 'integer', required: true },
                  final: { type: 'integer', required: true },
                },
              },
            },
          },
        },
      },
      render(args, value) {
        const item = value as { path: string; status: ChapterStatus; totals: ProjectOverview['totals'] }
        return [{ type: 'text' as const, text: renderChapterStatus(item) }]
      },
    },
    isConcurrencySafe() { return false },
    async execute(args, exec) {
      const raw = args as Readonly<Record<string, unknown>>
      const path = chapterPath(raw.path)
      const status = asStatus(raw.status)
      const cwd = readExecCwd(exec)
      const access = await options.resolveAccess(cwd)
      const overview = await readProjectOverview(access)
      const updated = await setChapterStatus({
        access,
        path,
        status,
        expectedStatusRevision: overview.statusRevision,
      })
      const chapter = updated.chapters.find((entry) => entry.path === path)
      return toChapterStatusResult(path, chapter?.status ?? status, updated)
    },
  })
}

/** 投影到 schema 声明的形状：statusRevision 必须是 optional `string`，不是 `string | null`。 */
function toChapterStatusResult(path: string, status: ChapterStatus, overview: ProjectOverview) {
  return {
    version: NOVEL_CHAPTER_STATUS_VERSION,
    path,
    status,
    statusRevision: overview.statusRevision ?? undefined,
    totals: overview.totals,
  }
}

/** 工具工厂集合：便于 apply 一次性注册并交给 host.tools.register。 */
export function createWorkbenchTools(options: { resolveAccess: OverviewAccessResolver }): unknown[] {
  return [createNovelOverviewTool(options), createNovelSetChapterStatusTool(options)]
}

export type WorkbenchFilesContext = WorkspaceFileContext
