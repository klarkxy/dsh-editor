import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { FusionRuntime } from '../src/runtime.ts'
import { emptyFusionState } from '../src/contracts.ts'
const signal = () => new AbortController().signal
function harness({ writing = false, domain = true, scopedAlias = false } = {}) {
  const agents = new Map(), events = new Map(), calls = [], registered = [], scopes = []
  let resolved = 0, saved = emptyFusionState()
  const on = (events, name, fn) => { const rows = events.get(name) ?? []; rows.push(fn); events.set(name, rows); return () => { const i = rows.indexOf(fn); if (i >= 0) rows.splice(i, 1) } }
  const emit = async (events, name, ...args) => { for (const fn of [...(events.get(name) ?? [])]) await fn(...args) }
  const make = (id, parentSession, options = { provider: 'p', model: 'm' }) => {
    const local = new Map(), guards = [], tools = new Map(), hidden = new Set()
    const baseTools = ['read', 'write', 'run_code', ...(scopedAlias ? ['subagent'] : [])].map(name => ({ name }))
    const header = { id, cwd: '/work', ...(writing ? { agentPreset: 'dsh-editor-novel' } : {}), ...(parentSession ? { parentSession } : {}) }
    const agent = { id, options, status: 'idle', session: { id, header }, inbox: { nextTurn: [], nextStep: [], clear() { this.nextTurn.length = 0; this.nextStep.length = 0 }, remove(id) { for (const list of [this.nextTurn, this.nextStep]) { const i = list.findIndex(x => x.id === id); if (i >= 0) { list.splice(i, 1); return true } } return false } },
      cancel() {}, whenIdle: async () => {}, followup(message) { this.inbox.nextTurn.push(message); for (const fn of local.get('agent/inbox/inserted') ?? []) fn({ agent, message }) },
      ctx: { on: (name, fn) => on(local, name, fn), tools: { get: name => hidden.has(name) ? undefined : tools.get(name) ?? baseTools.find(tool => tool.name === name), schemas: () => [...baseTools, ...tools.values()].filter(tool => !hidden.has(tool.name)), register: tool => { tools.set(tool.name, tool); return () => tools.delete(tool.name) }, guard: fn => { guards.push(fn); return () => { const i = guards.indexOf(fn); if (i >= 0) guards.splice(i, 1) } } }, systemPrompt: { section: () => () => {} } },
      guards, tools, local, hidden,
    }
    agents.set(id, agent); return agent
  }
  const lead = make('lead'), unrelated = make('unrelated', 'lead')
  const workspace = { sessionIds: ['lead'], attachSession: async id => { calls.push(['attach', id]); workspace.sessionIds.push(id) } }
  const host = { matches: header => header.agentPreset === 'dsh-editor-novel', writerTools: ['read'], allowLeadTool: name => name === 'read', capture: async (_actor, input) => ({ domain: 'editor', data: input }) }
  const ai = { activate() { const scope = { dispose: () => scopes.push('disposed'), registerPurpose: spec => { registered.push(spec); return () => {} } }; return scope }, resolve: async () => { resolved++; return { provider: 'p', model: 'm', source: 'default' } } }
  const ctx = { agents: { get: id => agents.get(id), list: () => [...agents.values()] }, sessions: { get: id => agents.get(id)?.session }, on: (name, fn) => on(events, name, fn), logger: { warn: (...args) => calls.push(['warn', ...args]) },
    get: key => key === 'fusionWriting' ? (domain ? host : undefined) : key === 'workspaceRegistry' ? { resolveByPath: async () => workspace } : undefined,
    subagents: {
      getProvider: () => ({ prepareContinuable() {}, inheritsParentContext: false, capabilities: { agentOptions: true, persona: true, toolFilter: true } }),
      async startContinuable(spec) { if (spec.request.toolFilter?.allow.includes('subagent')) throw new Error('tools.restrict() names unknown global tool subagent'); calls.push(['start', spec]); const child = make(spec.childId, 'lead', spec.request.agentOptions); await emit(events, 'agent/created', { agent: child }); return { childId: child.id, messageId: 'm1' } },
      async sendMessage(child, parent, content) { calls.push(['send', child.id, parent]); const target = agents.get(parent); if (target) target.followup({ id: `notice-${calls.length}`, role: 'user', source: { kind: 'agent-message', senderSessionId: child.id }, content }); return 'notice' },
      async drainContinuableChildren(_lead, ids) { calls.push(['drain', ids]); for (const id of ids) lead.followup({ id: `settled-${id}`, role: 'user', source: { kind: 'subagent-settled', senderSessionId: id }, content: [{ type: 'text', text: 'Native settlement' }] }) },
      interrupt() {},
    },
  }
  const runtime = new FusionRuntime(ctx, { load: () => saved, save: async next => { saved = structuredClone(next) } }, ai)
  const guard = (agent, name, args = {}) => agent.guards.map(fn => fn({ agent, name, arguments: args })).find(Boolean)
  return { runtime, lead, unrelated, make, emit, events, calls, agents, guard, registered, scopes, get resolved() { return resolved }, ctx }
}
const brief = { title: 'Task', goal: 'Do task', target: { kind: 'create', path: 'scene.md' } }
describe('Fusion runtime boundaries', () => {
  it('automatically installs existing/new root Leads, but no controls or report on arbitrary children', async () => {
    const h = harness(); await h.runtime.start()
    assert.equal(h.lead.tools.has('fusion_delegate'), true); assert.equal(h.lead.tools.has('fusion_report'), false)
    assert.equal(h.unrelated.tools.size, 0); assert.match(h.guard(h.unrelated, 'fusion_delegate'), /Only the owned/)
    const second = h.make('new'); await h.emit(h.events, 'agent/created', { agent: second }); assert.equal(second.tools.has('fusion_delegate'), true)
    assert.equal(h.registered[0].id, 'fusion.sidekick'); assert.deepEqual(h.registered[0].defaultTarget, { kind: 'role', role: 'normal' })
    assert.equal(h.calls.filter(row => row[0] === 'start').length, 0)
  })
  it('uses a child-local report tool and rechecks underlying Writer tools even through PTC', async () => {
    const h = harness({ writing: true }); await h.runtime.start(); await h.runtime.delegate(h.lead, brief, signal())
    const pair = h.runtime.service.pairFor('lead'), child = h.agents.get(pair.childSessionId)
    assert.deepEqual([...child.tools.keys()], ['fusion_report'])
    assert.deepEqual(h.calls.find(row => row[0] === 'start')[1].request.toolFilter, { allow: ['read'] })
    assert.equal(h.guard(child, 'read'), undefined); assert.equal(h.guard(child, 'run_code'), undefined); assert.match(h.guard(child, 'write'), /restricted/)
    assert.equal(h.guard(h.lead, 'run_code'), undefined); assert.match(h.guard(h.lead, 'write'), /Delegate prose/)
    assert.ok(h.calls.findIndex(row => row[0] === 'attach') >= 0)
    await assert.rejects(child.tools.get('fusion_report').execute({ taskId: 'forged', taskRevision: 1, kind: 'candidate', reportId: 'r', text: 'x' }, { agent: h.unrelated, signal: signal() }), /borrowed/)
  })
  it('inherits generic native capabilities without copying scoped aliases into restrictions', async () => {
    const h = harness({ scopedAlias: true }); await h.runtime.start()
    const task = await h.runtime.delegate(h.lead, brief, signal())
    assert.equal(task.state, 'working')
    const spec = h.calls.find(row => row[0] === 'start')[1]
    assert.equal(Object.hasOwn(spec.request, 'toolFilter'), false)
    assert.equal(spec.request.maxDepth, 1)
    const child = h.agents.get(h.runtime.service.pairFor('lead').childSessionId)
    assert.ok(child.ctx.tools.schemas(child).some(tool => tool.name === 'subagent'))
    assert.equal(h.guard(child, 'write'), undefined)
    assert.equal(h.guard(child, 'subagent'), undefined)
    assert.match(h.guard(child, 'fusion_delegate'), /cannot control/)
    assert.deepEqual([...child.tools.keys()], ['fusion_report'])
    assert.equal(h.guard(h.lead, 'write'), undefined)
    h.lead.hidden.add('write')
    assert.ok(child.ctx.tools.schemas(child).some(tool => tool.name === 'write'))
    assert.match(h.guard(child, 'write'), /not available to the Fusion Lead/)
    assert.equal(h.guard(child, 'run_code'), undefined)
    h.lead.session.header.cwd = '/other'
    assert.match(h.guard(child, 'read'), /workspace is unavailable or changed/)
    h.lead.session.header.cwd = '/work'; h.agents.delete('lead')
    assert.match(h.guard(child, 'read'), /workspace is unavailable or changed/)
  })
  it('keeps generic Lead execution tools and does not silently downgrade missing Editor domain', async () => {
    const generic = harness({ domain: false }); await generic.runtime.start(); assert.equal(generic.guard(generic.lead, 'write'), undefined)
    const editor = harness({ writing: true, domain: false }); await editor.runtime.start()
    await assert.rejects(editor.runtime.delegate(editor.lead, brief, signal()), { code: 'DOMAIN_UNAVAILABLE' }); assert.match(editor.guard(editor.lead, 'write'), /unavailable/)
  })
  it('uses the persisted pair route rather than resolving new AI policy per delegation', async () => {
    const h = harness(); await h.runtime.start(); let task = await h.runtime.delegate(h.lead, brief, signal()); assert.equal(h.resolved, 1)
    const pair = h.runtime.service.pairFor('lead'), child = h.agents.get(pair.childSessionId)
    task = await h.runtime.service.report({ sessionId: child.id, parentSessionId: 'lead', project: '/work' }, { taskId: task.id, taskRevision: 1, reportId: 'r', kind: 'candidate', text: 'Evidence', signal: signal() })
    const candidate = task.candidates[0]
    await h.runtime.service.review({ sessionId: 'lead', project: '/work' }, { taskId: task.id, taskRevision: 1, candidateId: candidate.id, hash: candidate.hash, verdict: 'accept', feedback: '', signal: signal() })
    h.ctx.subagents.listChildren = async () => [{ id: child.id, mode: 'continuable' }]
    h.ctx.sessionQuery = { observeSession: async () => ({ header: child.session.header, inheritedEventCount: 0, events: [{ type: 'subagent/descriptor', data: { version: 3, mode: 'continuable', provider: 'spawn', label: 'Fusion Sidekick', agentProvider: 'p', agentModel: 'm' } }], [Symbol.dispose]() {} }) }
    await h.runtime.delegate(h.lead, brief, signal()); assert.equal(h.resolved, 1)
  })
  it('rejects child RPC authority and passive status never creates inference', async () => {
    const h = harness(); await h.runtime.start(); await h.runtime.rpc('status', { sessionId: 'lead' }, signal())
    assert.equal(h.calls.length, 0)
    await assert.rejects(h.runtime.rpc('status', { sessionId: 'unrelated' }, signal()), { code: 'UNAUTHORIZED' })
    await assert.rejects(h.runtime.rpc('status', { sessionId: 'missing' }, signal()), { code: 'SESSION_NOT_FOUND' })
  })
  it('retains owned wake provenance until pre-step and rejects before injected snapshots without losing unrelated work', async () => {
    const h = harness(); await h.runtime.start(); const task = await h.runtime.delegate(h.lead, brief, signal()), childId = h.runtime.service.pairFor('lead').childSessionId
    const user = { id: 'user', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Continue unrelated request' }] }
    const unrelated = { ...user, id: 'other', source: { kind: 'subagent-settled', senderSessionId: 'unrelated' } }
    h.lead.followup(user); h.lead.followup(unrelated)
    await h.runtime.service.cancel({ sessionId: 'lead', project: '/work' }, task.id, 1)
    assert.deepEqual(h.lead.inbox.nextTurn.map(row => row.id), ['user', 'other', `settled-${childId}`])
    assert.equal(h.lead.local.get('agent/inbox/inserted')?.length ?? 0, 0)
    const owned = { ...user, source: { kind: 'subagent-settled', senderSessionId: childId } }, listener = h.lead.local.get('agent/pre-step')[0]
    let nextCalled = false
    assert.deepEqual(await listener({ messages: [owned], step: 1 }, async () => { nextCalled = true; return { kind: 'enter', messages: [owned, user] } }), { kind: 'reject' })
    assert.equal(nextCalled, false)
    const mixed = await listener({ messages: [user, owned, unrelated], step: 1 }, async () => ({ kind: 'enter', messages: [user, owned, unrelated] }))
    assert.equal(mixed.kind, 'enter'); assert.deepEqual(mixed.messages, [user, unrelated])
  })
  it('captures task revision at native turn start and marks a no-report failure interrupted', async () => {
    const h = harness(); await h.runtime.start(); const task = await h.runtime.delegate(h.lead, brief, signal()), child = h.agents.get(h.runtime.service.pairFor('lead').childSessionId)
    await h.emit(child.local, 'session/event', child.session, { type: 'turn/start', data: { turn: 1 } })
    await h.emit(child.local, 'session/event', child.session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'error', error: { message: 'Provider failed' } } } })
    await new Promise(done => setImmediate(done))
    assert.equal(h.runtime.service.read({ sessionId: 'lead', project: '/work' }, task.id).task.state, 'interrupted')
    assert.match(h.runtime.service.read({ sessionId: 'lead', project: '/work' }, task.id).task.error, /Provider failed/)
  })
})

it('disable retains the exact owned-notice gate while native prompt assembly is deferred', async () => {
  const h = harness(); await h.runtime.start(); await h.runtime.delegate(h.lead, brief, signal())
  const childId = h.runtime.service.pairFor('lead').childSessionId
  const notice = { id: 'deferred-settlement', role: 'user', source: { kind: 'subagent-settled', senderSessionId: childId }, content: [{ type: 'text', text: 'Owned settlement' }] }
  let claimedResolve; const claimed = new Promise(resolve => { claimedResolve = resolve })
  h.ctx.subagents.drainContinuableChildren = async () => {
    // Native send starts a driver; claim is synchronous, but assembly may still be awaiting.
    await h.emit(h.lead.local, 'agent/inbox/claimed', { agent: h.lead, message: notice, turn: 41 })
    claimedResolve()
  }
  let disposed = false
  const disposing = h.runtime.dispose().then(() => { disposed = true })
  await claimed; await new Promise(resolve => setImmediate(resolve))
  assert.equal(disposed, false)
  const gate = h.lead.local.get('agent/pre-step')[0]
  assert.equal(typeof gate, 'function')
  let downstream = false
  const result = await gate({ messages: [notice], turn: 41, step: 1 }, async () => { downstream = true; return { kind: 'enter', messages: [{ ...notice, source: { kind: 'plugin:recap' } }] } })
  assert.deepEqual(result, { kind: 'reject' }); assert.equal(downstream, false)
  await disposing; assert.equal(disposed, true); assert.equal(h.lead.local.get('agent/pre-step').length, 0)
})
it('a native turn end releases an owned claim when assembly aborts before the gate', async () => {
  const h = harness(); await h.runtime.start(); await h.runtime.delegate(h.lead, brief, signal())
  const notice = { id: 'aborted-settlement', role: 'user', source: { kind: 'subagent-settled', senderSessionId: h.runtime.service.pairFor('lead').childSessionId }, content: [] }
  h.ctx.subagents.drainContinuableChildren = async () => {}
  await h.emit(h.lead.local, 'agent/inbox/claimed', { agent: h.lead, message: notice, turn: 42 })
  let disposed = false; const disposing = h.runtime.dispose().then(() => { disposed = true })
  await new Promise(resolve => setImmediate(resolve)); assert.equal(disposed, false)
  await h.emit(h.lead.local, 'session/event', h.lead.session, { type: 'turn/end', data: { turn: 42, reason: { kind: 'aborted' } } })
  await disposing; assert.equal(disposed, true)
})
it('disable neither waits for unrelated claims nor waits for mixed-turn middleware after gate entry', async () => {
  const h = harness(); await h.runtime.start(); await h.runtime.delegate(h.lead, brief, signal())
  h.ctx.subagents.drainContinuableChildren = async () => {}
  const user = { id: 'user-input', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Unrelated work' }] }
  const notice = { id: 'mixed-settlement', role: 'user', source: { kind: 'subagent-settled', senderSessionId: h.runtime.service.pairFor('lead').childSessionId }, content: [] }
  await h.emit(h.lead.local, 'agent/inbox/claimed', { agent: h.lead, message: user, turn: 43 })
  await h.emit(h.lead.local, 'agent/inbox/claimed', { agent: h.lead, message: notice, turn: 43 })
  let downstreamResolve; const downstream = new Promise(resolve => { downstreamResolve = resolve })
  const gate = h.lead.local.get('agent/pre-step')[0]
  const step = gate({ messages: [user, notice], turn: 43, step: 1 }, () => downstream)
  await h.runtime.dispose()
  assert.equal(h.lead.local.get('agent/pre-step').length, 0)
  downstreamResolve({ kind: 'enter', messages: [user, notice] })
  assert.deepEqual(await step, { kind: 'enter', messages: [user] })
})
it('native Lead disposal settles its pending owned claims without waiting on another Agent', async () => {
  const h = harness(); await h.runtime.start(); await h.runtime.delegate(h.lead, brief, signal())
  h.ctx.subagents.drainContinuableChildren = async () => {}
  const notice = { id: 'lead-disposed-settlement', role: 'user', source: { kind: 'subagent-settled', senderSessionId: h.runtime.service.pairFor('lead').childSessionId }, content: [] }
  await h.emit(h.lead.local, 'agent/inbox/claimed', { agent: h.lead, message: notice, turn: 44 })
  const disposing = h.runtime.dispose()
  await h.emit(h.events, 'agent/disposed', { agent: h.lead })
  await disposing
})

it('disable clears queued unclaimed owned notices without waiting on unrelated Lead inference', async () => {
  const h = harness(); await h.runtime.start(); await h.runtime.delegate(h.lead, brief, signal())
  const childId = h.runtime.service.pairFor('lead').childSessionId
  h.lead.status = 'running'
  h.lead.whenIdle = async () => { throw new Error('Must not wait for unrelated Lead work') }
  h.lead.cancel = () => { throw new Error('Must not cancel unrelated Lead work') }
  const user = { id: 'queued-user', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Keep my request' }] }
  const sibling = { ...user, id: 'queued-sibling', source: { kind: 'subagent-settled', senderSessionId: 'unrelated' } }
  h.lead.inbox.nextTurn.push(user)
  h.lead.inbox.nextStep.push(sibling)
  h.ctx.subagents.drainContinuableChildren = async () => {
    // A running Lead queues steering; no claim happens until its unrelated request ends.
    h.lead.inbox.nextStep.push({ ...user, id: 'owned-settlement', source: { kind: 'subagent-settled', senderSessionId: childId } })
    h.lead.inbox.nextTurn.push({ ...user, id: 'owned-late-message', source: { kind: 'agent-message', senderSessionId: childId } })
  }
  await h.runtime.dispose()
  assert.equal(h.lead.status, 'running')
  assert.deepEqual(h.lead.inbox.nextTurn, [user]); assert.deepEqual(h.lead.inbox.nextStep, [sibling])
  assert.equal(h.lead.local.get('agent/pre-step').length, 0)
})

it('generic Lead takeover filters settlement at step two without blocking its existing user turn', async () => {
  const h = harness(); await h.runtime.start(); const task = await h.runtime.delegate(h.lead, brief, signal())
  const childId = h.runtime.service.pairFor('lead').childSessionId
  h.lead.status = 'running'
  h.lead.cancel = () => { throw new Error('An explicit takeover must not cancel its Lead turn') }
  h.ctx.subagents.drainContinuableChildren = async () => {
    h.lead.inbox.nextStep.push({ id: 'takeover-settlement', role: 'user', source: { kind: 'subagent-settled', senderSessionId: childId }, content: [] })
  }
  await h.lead.tools.get('fusion_cancel').execute({ taskId: task.id, taskRevision: task.revision }, { agent: h.lead, signal: signal() })
  assert.equal(h.runtime.service.pairFor('lead').tasks.at(-1).state, 'cancelled')
  const messages = h.lead.inbox.nextStep.splice(0), gate = h.lead.local.get('agent/pre-step')[0]
  let nextCalls = 0
  const continued = await gate({ messages, turn: 45, step: 2 }, async () => { nextCalls++; return { kind: 'enter', messages } })
  assert.deepEqual(continued, { kind: 'enter', messages: [] }); assert.equal(nextCalls, 1)
  assert.equal(h.guard(h.lead, 'write'), undefined)
  const firstStep = await gate({ messages, turn: 46, step: 1 }, async () => { nextCalls++; return { kind: 'enter', messages } })
  assert.deepEqual(firstStep, { kind: 'reject' }); assert.equal(nextCalls, 1)
  const vetoed = await gate({ messages, turn: 45, step: 2 }, async () => { nextCalls++; return { kind: 'reject' } })
  assert.deepEqual(vetoed, { kind: 'reject' }); assert.equal(nextCalls, 2)
})
