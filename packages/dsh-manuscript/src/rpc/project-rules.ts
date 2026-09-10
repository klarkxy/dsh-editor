import { createTextFile, FileOpError, listDirStrict, readTextFile, type WorkspaceFileContext } from './files.ts'
import { PathConfineError } from './paths.ts'

/** Canonical basename; discovery is case-insensitive but never walks nested directories. */
const CANONICAL_RULES_PATH = 'AGENTS.md'

export const PROJECT_RULES_TEMPLATE = `# 项目协作规则

本文件只写本项目长期有效的协作与写作规则，不写一次性任务说明。只认工作区根目录这一份；不要做全局规则发现，也不要在子目录叠放需继承的 AGENTS.md。

## 事实与计划
已经发生、并写进正文或设定的内容是事实。尚未发生、只存在于大纲或讨论中的内容是计划。两者分开，不要混写。

## 读写既有材料
当前任务要引用或改写已有正文、设定、人物卡、世界书时，先按任务用 grep / glob / read 核对原文再写。纯局部润色（改句、节奏、用词）不必强制全库检索。

## 记忆维护
只在协作对话里通过 novel_memory_update 维护项目记忆。作者明确要求新增、且有原文依据的事实，可以直接写入。有歧义、与既有规则冲突、或要改旧规则时，先提出方案，不要直接覆盖。
`

export class ProjectRulesError extends Error {
  constructor(
    message: string,
    readonly code: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'ProjectRulesError'
  }
}

export type ProjectRulesRead = {
  path: string
  text: string
  version: string | null
  exists: boolean
}

function isAgentsBasename(name: string): boolean {
  return name.toLowerCase() === 'agents.md'
}

function asRulesError(error: unknown, detail?: string): ProjectRulesError {
  if (error instanceof ProjectRulesError) return error
  const where = detail ? `（${detail}）` : ''
  if (error instanceof FileOpError) {
    return new ProjectRulesError(`无法加载项目协作规则${where}：${error.message}`, error.code, { cause: error })
  }
  if (error instanceof PathConfineError) {
    return new ProjectRulesError(`无法加载项目协作规则${where}：${error.message}`, 'PATH_ESCAPE', { cause: error })
  }
  return new ProjectRulesError(
    `无法加载项目协作规则${where}：${error instanceof Error ? error.message : String(error)}`,
    'IO',
    { cause: error },
  )
}

function missingRules(): ProjectRulesRead {
  return { path: CANONICAL_RULES_PATH, text: PROJECT_RULES_TEMPLATE, version: null, exists: false }
}

/** Workspace-root AGENTS.md only. Not a nested or global rules walk. */
export async function readProjectRules(files: WorkspaceFileContext): Promise<ProjectRulesRead> {
  let entries
  try {
    entries = await listDirStrict(files, '.')
  } catch (error) {
    throw asRulesError(error, CANONICAL_RULES_PATH)
  }

  const matches = entries.filter((entry) => isAgentsBasename(entry.name))
  if (matches.length === 0) return missingRules()
  if (matches.length > 1) {
    const names = matches.map((entry) => entry.name).join('、')
    throw new ProjectRulesError(
      `无法加载项目协作规则：工作区根目录存在多个 AGENTS.md（${names}）`,
      'AMBIGUOUS',
    )
  }

  const path = matches[0]!.name
  try {
    const { text, version } = await readTextFile(files, path)
    return { path, text, version, exists: true }
  } catch (error) {
    if (error instanceof FileOpError && error.code === 'NOT_FOUND') return missingRules()
    throw asRulesError(error, path)
  }
}

export async function ensureProjectRules(files: WorkspaceFileContext): Promise<ProjectRulesRead> {
  const current = await readProjectRules(files)
  if (current.exists) return current
  try {
    await createTextFile(files, current.path, PROJECT_RULES_TEMPLATE)
  } catch (error) {
    if (error instanceof FileOpError && error.code === 'EXISTS') return await readProjectRules(files)
    throw asRulesError(error, current.path)
  }
  return await readProjectRules(files)
}

export function composeProjectRules(system: string, text: string): string {
  return `${system}\n\n【本项目协作规则】\n${text}\n\n冲突时优先级：当前请求 > 本项目协作规则 > 作者跨作品约定。`
}
