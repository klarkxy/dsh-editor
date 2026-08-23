import type { Context } from '@deepseek-ai/cordis'

export type SessionLike = {
  header?: { cwd?: string }
}

export type AgentLike = {
  session?: SessionLike
}

export type ToolExecLike = {
  name: string
  arguments?: unknown
  agent?: AgentLike
  signal: AbortSignal
}

export type PreToolDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string }
  | { kind: 'ask'; reason?: string }

export type SandboxPolicyLike = {
  resolve?: (request?: { session?: SessionLike }) => { mode?: string; workspaceRoot?: string }
}

export type ToolDefinitionLike = {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: {
    schema: Record<string, unknown>
    render: (args: unknown, value: unknown) => { type: 'text'; text: string }[]
  }
  timeoutMs?: number
  isConcurrencySafe?: (args: unknown) => boolean
  execute: (args: Record<string, unknown>, exec: ToolExecLike) => Promise<unknown>
}

export type GrillHost = Context & {
  tools: {
    register: (tool: ToolDefinitionLike) => () => void
  }
  systemPrompt: {
    section: (section: { name: string; order: number; text: string }) => () => void
  }
  sandboxPolicy?: SandboxPolicyLike
}

export function asHost(ctx: Context): GrillHost {
  return ctx as GrillHost
}
