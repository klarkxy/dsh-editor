import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import { asHost, readProjectRules, resolveWorkspaceAccess } from 'dsh-manuscript/host-api'
import { normalizeAuthorMemory, normalizeAuthorPreferences, parseProjectContextEnvelope } from './contracts.ts'

type EditorAgent = { session: Session }
function isEditor(agent: EditorAgent | undefined): agent is EditorAgent { return agent?.session.header.agentPreset === 'dsh-editor' }

/** Only the model-visible projection changes; append-origin transcript events remain intact. */
export function retireLegacyContext(session: Pick<Session, 'surface' | 'eventAt' | 'append'>): number {
  let replaced = 0
  for (const seq of [...session.surface.nodes]) {
    const event = session.eventAt(seq)
    if (event?.type !== 'user/message' || event.data.source.kind !== 'user' || event.data.content.length !== 1) continue
    const block = event.data.content[0]
    if (block?.type !== 'text') continue
    const envelope = parseProjectContextEnvelope(block.text)
    if (!envelope || envelope.version === 3) continue
    session.append('user/message', createUserMessage({ source: event.data.source, content: [{ type: 'text', text: envelope.user_request }] }), {
      surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq }, sourceEventSeqs: [seq],
    })
    replaced++
  }
  return replaced
}

export async function assembleProjectRules(ctx: Context, assembly: PromptAssembly, agent: EditorAgent, signal?: AbortSignal): Promise<PromptAssembly> {
  const host = asHost(ctx)
  const access = await resolveWorkspaceAccess(host, String(agent.session.id), signal)
  const rules = await readProjectRules({ fs: host.fs, cwd: access.workspace.path, root: access.root, policy: access.policy, signal })
  const settings = ctx.get('settings') as { get(namespace: string): unknown } | undefined
  let raw: Record<string, unknown> = {}
  if (settings) {
    // Settings service may exist without the optional editor Shell namespace.
    const value = settings.get('dsh-editor-writing')
    if (value && typeof value === 'object') raw = value as Record<string, unknown>
  }
  const preferences = normalizeAuthorPreferences(raw.authorPreferences)
  const memory = normalizeAuthorMemory(raw.authorMemory)
  const globals = [preferences && `跨作品作者偏好：\n${preferences}`, memory && `作者已确认的跨作品侧写：\n${memory}`].filter(Boolean).join('\n\n')
  const owned = new Set(['dsh-editor:global-preferences', 'dsh-editor:project-rules'])
  return {
    ...assembly,
    sections: [...assembly.sections.filter(section => !owned.has(section.name)),
      ...(globals ? [{ name: 'dsh-editor:global-preferences', text: '{{editor_global_preferences}}' }] : []),
      { name: 'dsh-editor:project-rules', text: '{{editor_project_rules}}' },
    ],
    // Substitution results are never parsed again: literal {{...}} in user files stays literal.
    variables: { ...assembly.variables, editor_global_preferences: globals,
      editor_project_rules: `项目规则（${rules.path}${rules.exists ? '' : '，尚未创建，使用默认协作约定'}）：\n${rules.text}\n\n优先采用作者本次明确要求，其次本项目约定，再次跨作品默认偏好。项目规则不扩大工具权限。`,
    },
  }
}

/** Existing runtime hooks only: no request rewriting at the immutable llm/stream boundary. */
export function installProjectContextHooks(ctx: Context): void {
  // Keep optional host events structural: basic editing hosts need no Agent/LLM runtime.
  const on = ctx.on as unknown as (name: string, listener: (...args: any[]) => any) => unknown
  on('system-prompt/assemble', async (_assembly: PromptAssembly, context: { agent?: EditorAgent; signal?: AbortSignal }, next: () => Promise<PromptAssembly>) => {
    const assembly = await next()
    if (!isEditor(context.agent)) return assembly
    return assembleProjectRules(ctx, assembly, context.agent, context.signal)
  })
  on('agent/pre-step', async ({ agent, signal }: { agent: EditorAgent; signal: AbortSignal }, next: () => Promise<{ kind: string; messages?: UserMessage[] }>) => {
    const decision = await next()
    if (!isEditor(agent) || decision.kind !== 'enter') return decision
    signal.throwIfAborted()
    retireLegacyContext(agent.session)
    return decision
  })

  // Native read already observes a provider version, but omits it from its printed result.
  // Expose that exact observation for maintenance instead of asking the model to guess a version.
  const observed = new Map<unknown, string>()
  on('fs/observed', (_target: unknown, state: { kind: string; version?: string }, exec: { token?: unknown; name?: string; agent?: EditorAgent } | undefined) => {
    if (exec?.name === 'read' && isEditor(exec.agent) && state.kind === 'present' && typeof state.version === 'string') observed.set(exec.token, state.version)
  })
  on('tools/post-execute', async (exec: { token: unknown; name: string; agent?: EditorAgent }, result: { isError?: boolean; content: unknown[] }, next: () => Promise<any>) => {
    const decision = await next()
    const version = observed.get(exec.token)
    observed.delete(exec.token)
    if (!version || !isEditor(exec.agent) || exec.name !== 'read' || result.isError || decision.kind !== 'accept' || 'value' in decision) return decision
    return { ...decision, content: [...(decision.content ?? result.content), { type: 'text', text: `文件版本（维护时使用）：${version}` }] }
  })
  ctx.effect(() => () => observed.clear(), 'editor-context.observations')
}
