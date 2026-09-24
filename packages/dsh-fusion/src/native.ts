import { randomUUID } from 'node:crypto'
import type {} from '@klarkxy/dsh-ai-services/contracts'
import type { Agent, AgentOptions, AgentRegistry } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { MessageId, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import type { FusionActor, FusionNative, FusionPair } from './contracts.ts'
import { isOwnedChildNotice } from './presentation.ts'
import { requireFusion } from './validation.ts'

export interface NativeBindings {
  agents: Pick<AgentRegistry, 'get'>
  subagents: Pick<SubagentRuntime, 'getProvider' | 'startContinuable' | 'sendMessage' | 'interrupt' | 'drainContinuableChildren'>
}
export interface NativeComposition {
  /** The production agent/created hook installs report only on the owned child. */
  scopedReport?: boolean
  verifyContinuation?(pair: FusionPair, signal: AbortSignal): Promise<void>
  /** Names come from the actual composed tool registry, not a guessed global deny list. */
  tools(parent: Agent, pair: FusionPair): string[]
  persona(pair: FusionPair): string
}
const sid = (id: string): SessionId => id as SessionId

/** Identity is derived from the exact live Agent, never a model-supplied role or label. */
export function nativeActor(bindings: NativeBindings, agent: Agent | undefined): FusionActor {
  requireFusion(agent && bindings.agents.get(agent.id) === agent, 'UNAUTHORIZED', 'A current live Agent is required.')
  const header = agent.session.header
  requireFusion(typeof header.cwd === 'string' && header.cwd.length > 0, 'NO_WORKSPACE', 'Fusion requires a session workspace.')
  return { sessionId: String(agent.id), project: header.cwd,
    ...(header.parentSession ? { parentSessionId: String(header.parentSession) } : {}) }
}
function leadOf(bindings: NativeBindings, pair: FusionPair): Agent {
  const lead = bindings.agents.get(sid(pair.leadSessionId))
  const actor = nativeActor(bindings, lead)
  requireFusion(actor.project === pair.project && !actor.parentSessionId, 'UNAUTHORIZED', 'The stored Fusion parent does not match this live workspace.')
  return lead!
}
function ownedChild(bindings: NativeBindings, pair: FusionPair): Agent | undefined {
  const child = bindings.agents.get(sid(pair.childSessionId))
  if (!child) return undefined
  const actor = nativeActor(bindings, child)
  requireFusion(actor.parentSessionId === pair.leadSessionId && actor.project === pair.project, 'UNAUTHORIZED', 'The live child does not belong to this Fusion pair.')
  return child
}

/** Adapter only: the pinned native continuation manager owns creation, inboxes and cold resume. */
export function createNativeBridge(bindings: NativeBindings, composition: NativeComposition): FusionNative {
  return {
    async dispatch({ pair, prompt, signal }) {
      signal.throwIfAborted()
      const lead = leadOf(bindings, pair)
      if (pair.established) {
        await composition.verifyContinuation?.(pair, signal)
        signal.throwIfAborted()
        // sendMessage, not another spawn, is the native cold-resume entry point.
        const messageId = await bindings.subagents.sendMessage(lead, sid(pair.childSessionId), [{ type: 'text', text: prompt }], { signal })
        return { messageId: String(messageId) }
      }
      const provider = bindings.subagents.getProvider('spawn')
      requireFusion(provider?.prepareContinuable && provider.capabilities.agentOptions
        && provider.capabilities.persona && provider.capabilities.toolFilter,
      'UNSUPPORTED_CAPABILITY', 'Fusion requires the native spawn provider with continuable, model, persona and tool-filter support.')
      requireFusion(!provider.inheritsParentContext, 'CONTEXT_NOT_ISOLATED', 'The Fusion provider must not copy the parent transcript.')
      requireFusion(!bindings.agents.get(sid(pair.childSessionId)), 'IDENTITY_CONFLICT', 'The reserved child identity is already live.')
      const tools = [...new Set(composition.tools(lead, pair))]
      requireFusion(tools.includes('fusion_report'), 'INVALID_COMPOSITION', 'The child must have its report tool.')
      requireFusion(!tools.includes('fusion_delegate') && !tools.includes('fusion_review'), 'INVALID_COMPOSITION', 'The child cannot own Lead controls.')
      // Generic production children inherit native capabilities and their native permissions.
      // The owned-child execution guard rejects Fusion Lead controls; native policy governs further delegation.
      // Restriction names must be inherited capabilities, not model-visible child-local aliases.
      const toolFilter = pair.profile === 'generic' && composition.scopedReport ? undefined
        : { allow: composition.scopedReport ? tools.filter(name => name !== 'fusion_report') : tools }
      const agentOptions: AgentOptions = {
        provider: pair.route.provider, model: pair.route.model,
        reasoningEffort: pair.route.reasoningEffort as ReasoningEffortId | undefined,
      }
      const started = await bindings.subagents.startContinuable({
        provider: 'spawn', label: pair.profile === 'writing' ? '执笔' : 'Fusion Sidekick', childId: sid(pair.childSessionId),
        request: { parent: lead, prompt: [{ type: 'text', text: prompt }], agentOptions,
          persona: composition.persona(pair), ...(toolFilter ? { toolFilter } : {}), maxDepth: 1 },
        signal,
      })
      requireFusion(String(started.childId) === pair.childSessionId, 'IDENTITY_CONFLICT', 'The native provider returned another child identity.')
      return { messageId: String(started.messageId) }
    },
    async notify({ pair, task, actor, text, signal }) {
      signal.throwIfAborted()
      const lead = leadOf(bindings, pair)
      const marker = `[fusion:${pair.id}:${task.id}:${task.revision}]`
      const content = [{ type: 'text' as const, text: `${marker}\n${text}` }]
      let messageId: MessageId
      if (actor.sessionId === pair.leadSessionId && !actor.parentSessionId && actor.project === pair.project) {
        // Explicit Host recovery uses saved records, with honest producer attribution.
        // A cold Writer must not be reactivated merely to send its old report.
        messageId = randomUUID() as MessageId
        lead.followup({ id: messageId, role: 'user', source: { kind: 'plugin:@klarkxy/dsh-fusion', plugin: '@klarkxy/dsh-fusion' }, content })
      } else {
        const child = ownedChild(bindings, pair)
        requireFusion(child && String(child.id) === actor.sessionId && actor.parentSessionId === pair.leadSessionId,
          'UNAUTHORIZED', 'Only the current bound child can report to the Lead.')
        messageId = await bindings.subagents.sendMessage(child, sid(pair.leadSessionId), content, { signal })
      }
      if (signal.aborted) { lead.inbox.remove?.(messageId); signal.throwIfAborted() }
    },
    async stop(pair, stopLead) {
      const child = ownedChild(bindings, pair)
      const lead = bindings.agents.get(sid(pair.leadSessionId))
      if (lead) {
        leadOf(bindings, pair)
        // Remove only this pair's pending notices; leave unrelated user and child work intact.
        const marker = `[fusion:${pair.id}:`
        for (const message of [...(lead.inbox.nextStep ?? []), ...(lead.inbox.nextTurn ?? [])]) {
          if (isOwnedChildNotice(message.source, pair.childSessionId) || (message.source.kind === 'plugin:@klarkxy/dsh-fusion' && message.content.some(block => block.type === 'text' && block.text.includes(marker)))) lead.inbox.remove(message.id)
        }
      }
      // The business service invalidates the task first. Native interrupt alone preserves the inbox.
      child?.inbox.clear()
      if (stopLead && lead) lead.cancel({ kind: 'user' }, { keepInbox: true })
      if (lead) {
        await bindings.subagents.drainContinuableChildren(lead, [sid(pair.childSessionId)])
      } else if (child) {
        // A detached parent cannot authorize drain. Stop work, but never pretend ownership release succeeded.
        bindings.subagents.interrupt(sid(pair.childSessionId), { kind: 'user', parentSessionId: sid(pair.leadSessionId) })
        await child.whenIdle()
        requireFusion(false, 'PARENT_UNAVAILABLE', 'Child execution stopped, but its parent must be restored before ownership cleanup can be confirmed.')
      }
    },
  }
}
