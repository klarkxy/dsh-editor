import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { asHost, type GrillHost, type PreToolDecision, type ToolExecLike } from './host.ts'
import { scaffoldNovel } from './scaffold.ts'

export const name = 'dsh-grill-tools'
export const inject = ['tools'] as const

export const SCAFFOLD_TOOL_NAME = 'scaffold_novel'

const TOOL_DESCRIPTION =
  'Create a small novel workspace (正文/大纲/人物卡/世界书 and stub markdown files) under the current session cwd. Existing paths are skipped and never overwritten. Does not create files outside the workspace.'

const SCAFFOLD_PARAMETERS = {
  target: {
    type: 'string' as const,
    description: 'Relative directory under the session workspace. Defaults to ".".',
  },
}

function requireCwd(exec: ToolExecLike): string {
  const cwd = exec.agent?.session?.header?.cwd
  if (!cwd) throw new Error(`${SCAFFOLD_TOOL_NAME} requires a live agent session workspace`)
  return cwd
}

function resolveSandbox(ctx: GrillHost, exec: ToolExecLike) {
  const policy = ctx.get?.('sandboxPolicy') as GrillHost['sandboxPolicy']
  return policy?.resolve?.({ session: exec.agent?.session })
}

export function createScaffoldTool(ctx: GrillHost) {
  return defineTool({
    name: SCAFFOLD_TOOL_NAME,
    description: TOOL_DESCRIPTION,
    parameters: SCAFFOLD_PARAMETERS,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          root: { type: 'string' },
          created: { type: 'array', items: { type: 'string' } },
          skipped: { type: 'array', items: { type: 'string' } },
        },
      },
      render(_args, value) {
        return [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }]
      },
    },
    timeoutMs: 30_000,
    isConcurrencySafe() {
      return false
    },
    async execute(args, exec) {
      const cwd = requireCwd(exec)
      const resolved = resolveSandbox(ctx, exec)
      const target = typeof args.target === 'string' && args.target.trim() ? args.target : '.'
      return scaffoldNovel({
        cwd,
        target,
        mode: resolved?.mode,
        workspaceRoot: resolved?.workspaceRoot || cwd,
        signal: exec.signal,
      })
    },
  })
}

export function scaffoldPreExecute(exec: ToolExecLike, next: () => Promise<PreToolDecision>): Promise<PreToolDecision> {
  if (exec.name !== SCAFFOLD_TOOL_NAME) return next()
  if (!exec.agent?.session?.header?.cwd) {
    return Promise.resolve({
      kind: 'deny',
      reason: 'scaffold_novel requires a live agent session workspace',
    })
  }
  return Promise.resolve({
    kind: 'ask',
    reason: 'Create novel directories and stub files in the session workspace. Existing files are not overwritten.',
  })
}

export function apply(ctx: Context): void {
  const host = asHost(ctx)
  host.tools.register(createScaffoldTool(host))
  ctx.on('tools/pre-execute' as never, ((exec: ToolExecLike, next: () => Promise<PreToolDecision>) =>
    scaffoldPreExecute(exec, next)) as never)
}
