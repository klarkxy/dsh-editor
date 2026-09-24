import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId, UserMessage } from '@deepseek-ai/dsh-session'
import { foldSubagentDescriptor } from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { AiServices } from '@klarkxy/dsh-ai-services/contracts'
import { FUSION_PLUGIN, FUSION_PURPOSE, FUSION_TOOLS, type FusionActor, type FusionCandidateAction, type FusionPair, type FusionProfile, type FusionStatus, type FusionStore } from './contracts.ts'
import type { FusionWritingHost } from './host-contracts.ts'
import { isOwnedChildNotice } from './presentation.ts'
import { FusionService } from './service.ts'
import { createNativeBridge, nativeActor } from './native.ts'
import { fusionTools } from './tools.ts'
import { brief, integer, object, requireFusion, text } from './validation.ts'

export class FusionRuntime {
  readonly service: FusionService
  private readonly ctx: Context
  private readonly ai: AiServices
  private readonly disposers: Array<() => unknown> = []
  private readonly installed = new Map<Agent, Array<() => unknown>>()
  private readonly pendingNoticeClaims = new Set<Promise<void>>()
  private closing?: Promise<void>
  constructor(ctx: Context, store: FusionStore, ai: AiServices) {
    this.ctx = ctx; this.ai = ai
    const native = createNativeBridge({ agents: ctx.agents, subagents: ctx.subagents }, {
      scopedReport: true,
      verifyContinuation: async (pair, signal) => { requireFusion(await this.inspectAdmission(pair, signal) === 'present', 'CHILD_MISSING', 'The persistent Sidekick is missing. Explicitly resume to inspect recovery.') },
      tools: (parent, pair) => this.childTools(parent, pair),
      persona: pair => pair.profile === 'writing'
        ? 'You are the persistent Fusion Writer. Author exact prose candidates for the assigned brief and captured destination. You may inspect allowed context, but must never mutate manuscript files. Report via fusion_report; ask a decision when blocked. Do not delegate, contact the user directly, or treat rejected drafts as story facts. Stop after reporting.'
        : 'You are the persistent Fusion Sidekick. Execute only the assigned bounded task using native permissions. Report exact outcomes and verifiable evidence via fusion_report; report decisions when blocked. Never recursively enable Fusion or take over the Lead. Stop after reporting.',
    })
    this.service = new FusionService({ store, native, inspectAdmission: (pair, signal) => this.inspectAdmission(pair, signal) })
  }
  private async inspectAdmission(pair: FusionPair, signal: AbortSignal): Promise<'present' | 'absent'> {
    signal.throwIfAborted()
    const catalog = await this.ctx.subagents.listChildren(pair.leadSessionId as SessionId, signal)
    const entry = catalog.find(row => String(row.id) === pair.childSessionId)
    let observation
    try { observation = await this.ctx.sessionQuery.observeSession(pair.childSessionId as SessionId, { signal, projectionMode: 'all' }) }
    catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND' && !entry && !this.ctx.agents.get(pair.childSessionId as SessionId)) return 'absent'
      throw error
    }
    try {
      const header = observation.header, descriptor = foldSubagentDescriptor(observation.events)
      requireFusion(String(header.id) === pair.childSessionId && String(header.parentSession) === pair.leadSessionId && header.cwd === pair.project,
        'IDENTITY_CONFLICT', 'The native Sidekick does not match this pair and workspace.')
      requireFusion(descriptor?.mode === 'continuable' && descriptor.provider === 'spawn' && (!entry || entry.mode === 'continuable'), 'UNCERTAIN_ADMISSION', 'The saved child has no supported native continuation descriptor.')
      requireFusion(descriptor.agentProvider === pair.route.provider && descriptor.agentModel === pair.route.model && descriptor.agentReasoningEffort === pair.route.reasoningEffort,
        'ROUTE_CHANGED', 'The native Sidekick route differs from its pinned Fusion route.')
      const selected = observation.projections?.values as { modelSelection?: { next?: { provider: string; model: string; reasoningEffort?: string } | null } } | undefined
      if (selected?.modelSelection?.next) this.checkRoute(pair, selected.modelSelection.next)
      const live = this.ctx.agents.get(pair.childSessionId as SessionId)
      if (live) this.checkRoute(pair, live.options)
      return 'present'
    } finally { observation[Symbol.dispose]() }
  }
  private checkRoute(pair: FusionPair, route: { provider?: string; model?: string; reasoningEffort?: string }): void {
    requireFusion(route.provider === pair.route.provider && route.model === pair.route.model && route.reasoningEffort === pair.route.reasoningEffort,
      'ROUTE_CHANGED', 'The Sidekick model changed outside Fusion. Restore its pinned route before continuing.')
  }
  actor(agent: Agent): FusionActor {
    requireFusion(this.service.active, 'DISABLED', 'Fusion is disabled.')
    return nativeActor({ agents: this.ctx.agents, subagents: this.ctx.subagents }, agent)
  }
  private writing(): FusionWritingHost | undefined { return this.ctx.get('fusionWriting') as FusionWritingHost | undefined }
  private profile(agent: { session: { header: { agentPreset?: unknown } } }, pair?: FusionPair): FusionProfile {
    const domain = this.writing()
    requireFusion(domain || !String(agent.session.header.agentPreset ?? '').startsWith('dsh-editor'), 'DOMAIN_UNAVAILABLE', 'The Editor writing domain is unavailable; delegation is blocked until it is restored.')
    if (pair?.profile === 'writing') {
      requireFusion(domain && domain.matches(agent.session.header as { agentPreset?: string }), 'DOMAIN_UNAVAILABLE', 'The writing domain is unavailable or this conversation changed writing mode.')
      return 'writing'
    }
    return domain?.matches(agent.session.header as { agentPreset?: string }) ? 'writing' : 'generic'
  }
  private childTools(parent: Agent, pair: FusionPair): string[] {
    // Generic children inherit the native preset composition. Model-visible aliases can be
    // child-local registrations, so they cannot be copied into a pre-creation restriction.
    if (pair.profile !== 'writing') return ['fusion_report']
    const available = parent.ctx.tools.schemas(parent).map(tool => tool.name).filter(name => name !== 'run_code' && !FUSION_TOOLS.includes(name as typeof FUSION_TOOLS[number]))
    this.profile(parent, pair)
    const allow = new Set(this.writing()!.writerTools)
    return [...available.filter(name => allow.has(name)), 'fusion_report']
  }
  async start(): Promise<void> {
    await this.service.initialized()
    const scope = this.ai.activate(FUSION_PLUGIN)
    this.disposers.push(() => scope.dispose())
    this.disposers.push(scope.registerPurpose({ id: FUSION_PURPOSE, label: 'Fusion 持久搭档', defaultTarget: { kind: 'role', role: 'normal' } }))
    this.disposers.push(this.ctx.on('agent/created', async ({ agent }) => { await this.install(agent); return undefined }, { global: true }))
    this.disposers.push(this.ctx.on('agent/disposed', ({ agent }) => { this.uninstall(agent) }, { global: true }))
    for (const agent of this.ctx.agents.list()) await this.install(agent)
  }
  private async install(agent: Agent): Promise<void> {
    if (this.installed.has(agent) || !this.service.active) return
    const header = agent.session.header, pair = this.service.pairFor(String(agent.id))
    const sidekick = pair?.childSessionId === String(agent.id)
    const root = !header.parentSession
    const disposers: Array<() => unknown> = []
    this.installed.set(agent, disposers)
    try {
      // Any inherited registration must still execute as the exact bound Agent.
      disposers.push(agent.ctx.tools.guard(exec => {
        if (exec.agent !== agent) return 'Fusion execution identity mismatch.'
        const livePair = this.service.pairFor(String(agent.id))
        if (!this.service.active) return sidekick || FUSION_TOOLS.includes(exec.name as typeof FUSION_TOOLS[number]) ? 'Fusion is disabled.' : undefined
        if (!root && !sidekick) return FUSION_TOOLS.includes(exec.name as typeof FUSION_TOOLS[number]) ? 'Only the owned Fusion Sidekick may report.' : undefined
        if (sidekick) {
          if (!livePair || livePair.childSessionId !== String(agent.id) || String(header.parentSession) !== livePair.leadSessionId || header.cwd !== livePair.project) return 'Fusion child identity changed.'
          const task = livePair.tasks.at(-1)
          if (!task || !['working', 'dispatching'].includes(task.state)) return 'The Fusion task is no longer accepting execution.'
          if (exec.name === 'fusion_report' || exec.name === 'run_code') return undefined
          if (FUSION_TOOLS.includes(exec.name as typeof FUSION_TOOLS[number])) return 'Sidekick cannot control the Lead.'
          if (livePair.profile === 'writing' && !this.writing()?.writerTools.includes(exec.name)) return 'Writer tools are restricted to the writing domain read surface.'
          if (livePair.profile === 'generic') {
            // Native preset inheritance does not inherit arbitrary per-Agent restrictions.
            // Consult the real Lead view at execution, including scoped aliases and later narrowing.
            const lead = this.ctx.agents.get(livePair.leadSessionId as SessionId)
            if (!lead || lead.session.header.parentSession || lead.session.header.cwd !== livePair.project) return 'The Fusion Lead workspace is unavailable or changed.'
            if (!lead.ctx.tools.get(exec.name, lead)) return 'This capability is not available to the Fusion Lead.'
          }
          return undefined
        }
        if (exec.name === 'fusion_report') return 'Only the owned Sidekick may report.'
        if (exec.name === 'run_code') return undefined
        try {
          if (this.profile(agent, livePair) === 'writing' && !FUSION_TOOLS.includes(exec.name as typeof FUSION_TOOLS[number]) && !this.writing()!.allowLeadTool(exec.name, exec.arguments)) return 'Delegate prose to the Fusion Writer; the author adopts the exact candidate.'
        } catch { return 'The Fusion writing domain is unavailable; execution is blocked until restored.' }
        return undefined
      }))
      if (root) {
        // Native claims before awaiting prompt assembly. Retain this narrow gate through
        // disable until each owned claim enters the gate or its native turn ends.
        const claims = new Map<number, () => void>()
        disposers.push(agent.ctx.on('agent/inbox/claimed', ({ message, turn }) => {
          const pair = this.service.pairFor(String(agent.id))
          if (!pair || !isOwnedChildNotice(message.source, pair.childSessionId) || claims.has(turn)) return
          let resolve!: () => void
          const pending = new Promise<void>(done => { resolve = done })
          this.pendingNoticeClaims.add(pending)
          claims.set(turn, () => { claims.delete(turn); this.pendingNoticeClaims.delete(pending); resolve() })
        }))
        disposers.push(agent.ctx.on('session/event', (_session, event) => {
          if (event.type === 'turn/end') claims.get(event.data.turn)?.()
        }))
        disposers.push(() => { for (const finish of [...claims.values()]) finish() })
        const discard = (message: UserMessage): boolean => {
          const pair = this.service.pairFor(String(agent.id))
          if (!pair || !isOwnedChildNotice(message.source, pair.childSessionId)) return false
          // Fusion reports own the wakeup. Native activation settlement is status, not a second task.
          if (message.source.kind === 'subagent-settled') return true
          const task = pair.tasks.at(-1)
          return !this.service.active || !task || !['review', 'decision'].includes(task.state)
            || !message.content.some(block => block.type === 'text' && block.text.includes(`[fusion:${pair.id}:${task.id}:${task.revision}]`))
        }
        // Keep the owned notice until the native pre-step claims it. Removing it during
        // insertion does not cancel native wakeDriver: an empty turn can still run plugin
        // snapshot middleware and inference. The claimed notice is the precise rejection cause.
        disposers.push(agent.ctx.on('agent/pre-step', async (payload, next) => {
          // Only the first step is a new wake. Later steps still belong to the existing
          // user turn (including explicit takeover after fusion_cancel); native turnEnds
          // decides whether an empty filtered continuation needs another model step.
          const newTurn = payload.step === 1
          const rejectOwnedWake = newTurn && payload.messages.length > 0 && payload.messages.every(discard)
          claims.get(payload.turn)?.()
          if (rejectOwnedWake) return { kind: 'reject' }
          const decision = await next()
          if (decision.kind === 'reject') return decision
          const messages = decision.messages.filter(message => !discard(message))
          return newTurn && decision.messages.length > 0 && messages.length === 0 ? { kind: 'reject' } : { ...decision, messages }
        }, { prepend: true }))
      }
      if (!root && !sidekick) return
      if (sidekick) {
        requireFusion(pair && header.cwd === pair.project && String(header.parentSession) === pair.leadSessionId, 'UNAUTHORIZED', 'Stored Writer identity does not match the native child.')
        if (pair.profile === 'writing') {
          const registry = this.ctx.get('workspaceRegistry') as WorkspaceRegistry | undefined
          const parent = this.ctx.sessions.get(pair.leadSessionId as SessionId)
          requireFusion(registry && parent && parent.header.cwd === pair.project && !parent.header.parentSession, 'WORKSPACE_UNAVAILABLE', 'The Writer requires its real Lead workspace.')
          const workspace = await registry.resolveByPath(pair.project)
          requireFusion(workspace && workspace.sessionIds.some(id => String(id) === pair.leadSessionId), 'WORKSPACE_MISMATCH', 'The Lead is not attached to this workspace.')
          await workspace.attachSession(agent.id)
          this.actor(agent)
        }
        const turns = new Map<number, { taskId: string; revision: number }>()
        disposers.push(agent.ctx.on('session/event', (_session, event) => {
          if (event.type === 'turn/start') {
            const task = this.service.pairFor(String(agent.id))?.tasks.at(-1)
            if (task) turns.set(event.data.turn, { taskId: task.id, revision: task.revision })
          }
          if (event.type === 'turn/end') {
            const expected = turns.get(event.data.turn)
            turns.delete(event.data.turn)
            if (!expected || !this.service.active) return
            const reason = event.data.reason.kind === 'error' ? event.data.reason.error.message : `The Sidekick turn ended (${event.data.reason.kind}) without a saved report. Inspect its session before resuming.`
            void this.service.executionInterrupted(this.actor(agent), reason, expected).catch(error => this.ctx.logger.warn('Fusion could not save child settlement', error))
          }
        }))
        this.checkRoute(pair, agent.options)
        disposers.push(agent.ctx.on('agent/request', async (_payload, next) => {
          const config = await next()
          try { this.checkRoute(pair, config) }
          catch (error) { await this.service.executionInterrupted(this.actor(agent), error instanceof Error ? error.message : String(error)); throw error }
          return config
        }, { prepend: true }))
        if (pair.profile === 'writing') requireFusion(this.writing(), 'DOMAIN_UNAVAILABLE', 'Writing domain required for the existing Writer.')
      }
      for (const tool of fusionTools(this, agent, sidekick)) disposers.push(agent.ctx.tools.register(tool))
      if (root) disposers.push(agent.ctx.systemPrompt.section({ name: 'fusion:lead', order: 95,
        text: 'Fusion collaboration is enabled. You are the Lead in the original user conversation. Discuss, plan and review; use fusion_delegate for bounded Sidekick work. Only one task may be active. Read its exact saved candidate with fusion_read before fusion_review. Accept means model review, never author file adoption. In writing modes, delegate prose editing/creation with its original read versions; do not rewrite the Writer candidate while forwarding it. Resolve decisions with fusion_decide. For explicit takeover cancel the task first with fusion_cancel. Ordinary generic native tools remain available. Existing model route stays pinned to this pair. Never create another Fusion pair from child sessions.' }))
    } catch (error) { this.uninstall(agent); throw error }
  }
  private uninstall(agent: Agent): void {
    const disposers = this.installed.get(agent)
    this.installed.delete(agent)
    for (const dispose of disposers?.reverse() ?? []) dispose()
  }
  async delegate(agent: Agent, input: unknown, signal: AbortSignal) {
    const actor = this.actor(agent), row = object(input), pair = this.service.pairFor(actor.sessionId)
    requireFusion(!actor.parentSessionId, 'UNAUTHORIZED', 'Only root sessions delegate.')
    const profile = this.profile(agent, pair)
    const route = pair?.route ?? await this.ai.resolve(FUSION_PURPOSE, actor.sessionId)
    signal.throwIfAborted(); this.actor(agent)
    const target = profile === 'writing' ? await this.writing()!.capture(actor, row.target, signal) : undefined
    signal.throwIfAborted(); this.actor(agent)
    return this.service.delegate(actor, { profile, route: { provider: route.provider, model: route.model, ...(route.reasoningEffort ? { reasoningEffort: route.reasoningEffort } : {}) }, brief: brief(row), ...(target ? { target } : {}), signal })
  }
  private rpcActor(sessionId: string): { actor: FusionActor; session: NonNullable<ReturnType<Context['sessions']['get']>> } {
    const session = this.ctx.sessions.get(sessionId as SessionId)
    requireFusion(session && String(session.id) === sessionId, 'SESSION_NOT_FOUND', 'The native session is not loaded.')
    requireFusion(!session.header.parentSession && this.service.role(sessionId) !== 'sidekick', 'UNAUTHORIZED', 'A child session cannot act as the Lead.')
    const project = text(session.header.cwd, 'session workspace', 8192)
    const pair = this.service.pairFor(sessionId)
    requireFusion(!pair || pair.project === project, 'CONTEXT_CHANGED', 'The session workspace differs from the Fusion pair.')
    return { actor: { sessionId, project }, session }
  }
  async rpc(endpoint: string, payload: unknown, signal: AbortSignal): Promise<unknown> {
    await this.service.initialized(); signal.throwIfAborted()
    requireFusion(this.service.active, 'DISABLED', 'Fusion is disabled.')
    const row = object(payload), sessionId = text(row.sessionId, 'session id', 200)
    const { actor, session } = this.rpcActor(sessionId)
    const pair = this.service.pairFor(sessionId), profile = this.profile({ session }, pair)
    const domain = profile === 'writing' ? this.writing()! : undefined
    if (domain) await this.service.reconcile(actor, domain, signal)
    signal.throwIfAborted(); this.rpcActor(sessionId)
    if (endpoint === 'status') {
      let error: string | undefined
      if (!pair) { try { await this.ai.resolve(FUSION_PURPOSE, sessionId) } catch (cause) { error = cause instanceof Error ? cause.message : String(cause) } }
      const current = this.service.pairFor(sessionId)
      const status: FusionStatus = { available: true, configured: !error, profile, revision: this.service.snapshot().revision,
        ...(error ? { error } : {}), ...(current ? { pair: current } : {}), usage: { leadTokens: null, sidekickTokens: null, cost: null },
        activity: { lead: this.ctx.agents.get(sessionId as SessionId)?.status ?? 'idle', sidekick: current ? this.ctx.agents.get(current.childSessionId as SessionId)?.status ?? 'idle' : 'idle' } }
      return status
    }
    const taskId = text(row.taskId, 'task id', 200), taskRevision = integer(row.taskRevision, 'task revision')
    if (endpoint === 'cancel') { await this.service.cancel(actor, taskId, taskRevision, true); return null }
    if (endpoint === 'resume') return this.service.decide(actor, { taskId, taskRevision, feedback: text(row.feedback, 'feedback', 16_000), signal })
    if (endpoint === 'recover') return this.service.recover(actor, taskId, taskRevision, signal)
    requireFusion(domain, 'DOMAIN_UNAVAILABLE', 'File adoption requires a writing domain.')
    const action: FusionCandidateAction = { sessionId, taskId, taskRevision, candidateId: text(row.candidateId, 'candidate id', 200), hash: text(row.hash, 'candidate hash', 64) }
    if (endpoint === 'preview') return this.service.preview(actor, action, domain, signal)
    if (endpoint === 'apply') return this.service.applyCandidate(actor, { ...action, expectedVersion: text(row.expectedVersion, 'expected version', 8192, true) }, domain, signal)
    if (endpoint === 'dismiss') return this.service.dismiss(actor, action)
    requireFusion(false, 'NOT_FOUND', 'Unknown Fusion endpoint.')
  }
  dispose(): Promise<void> {
    if (this.closing) return this.closing
    this.closing = (async () => {
      try { await this.service.dispose() }
      finally {
        // Drain may queue a settlement behind an unrelated running Lead request. Native
        // delivery is now finished: remove only still-pending owned notices before the
        // gate is uninstalled. An idle driver's synchronous claim is covered below.
        for (const agent of this.installed.keys()) {
          const pair = this.service.pairFor(String(agent.id))
          if (!pair || pair.leadSessionId !== String(agent.id) || this.ctx.agents.get(agent.id) !== agent) continue
          for (const message of [...agent.inbox.nextStep, ...agent.inbox.nextTurn]) {
            if (isOwnedChildNotice(message.source, pair.childSessionId)) agent.inbox.remove(message.id)
          }
        }
        // Wait only for already-claimed owned notices, never for an entire Lead turn,
        // unrelated input, or a middleware approval after this gate has been entered.
        while (this.pendingNoticeClaims.size) await Promise.all([...this.pendingNoticeClaims])
        for (const agent of [...this.installed.keys()]) this.uninstall(agent)
        for (const dispose of this.disposers.reverse()) dispose()
      }
    })()
    return this.closing
  }
}
