import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createNativeBridge, nativeActor } from '../src/native.ts'

function setup() {
  const calls = [], agents = new Map()
  const make = (id, parentSession) => {
    const agent = { id, session: { header: { id, cwd: '/work', ...(parentSession ? { parentSession } : {}) } },
      inbox: { clear: () => calls.push(['clear', id]) }, cancel: (...args) => calls.push(['cancel', id, ...args]),
      whenIdle: async () => calls.push(['idle', id]) }
    agents.set(id, agent); return agent
  }
  const lead = make('lead'), provider = { inheritsParentContext: false, prepareContinuable: () => {},
    capabilities: { agentOptions: true, persona: true, toolFilter: true } }
  const bindings = { agents: { get: id => agents.get(id) }, subagents: {
    getProvider: name => name === 'spawn' ? provider : undefined,
    startContinuable: async spec => { calls.push(['start', spec]); make(spec.childId, 'lead'); return { childId: spec.childId, messageId: 'initial' } },
    sendMessage: async (...args) => { calls.push(['message', ...args]); return 'followup' },
    interrupt: (...args) => calls.push(['interrupt', ...args]),
    drainContinuableChildren: async (...args) => calls.push(['drain', ...args]),
  } }
  const pair = { id: 'pair', leadSessionId: 'lead', childSessionId: 'writer', project: '/work', profile: 'writing',
    route: { provider: 'p', model: 'm', reasoningEffort: 'low' }, established: false, tasks: [], createdAt: 1 }
  const composition = { tools: () => ['fusion_report'], persona: () => 'Write the candidate. Report once.' }
  const bridge = createNativeBridge(bindings, composition)
  const request = { pair, task: {}, prompt: 'A bounded task, not the parent history.', signal: new AbortController().signal }
  return { calls, agents, lead, provider, bindings, pair, composition, bridge, request, make }
}
describe('native Fusion boundary', () => {
  it('starts one reserved native continuable child with model and scoped tools', async () => {
    const { bridge, request, calls, lead } = setup()
    assert.deepEqual(await bridge.dispatch(request), { messageId: 'initial' })
    const spec = calls.find(row => row[0] === 'start')[1]
    assert.equal(spec.childId, 'writer'); assert.equal(spec.request.parent, lead)
    assert.deepEqual(spec.request.agentOptions, { provider: 'p', model: 'm', reasoningEffort: 'low' })
    assert.deepEqual(spec.request.toolFilter, { allow: ['fusion_report'] }); assert.equal(spec.request.maxDepth, 1)
    assert.equal(spec.request.prompt.length, 1); assert.equal(spec.request.prompt[0].text, request.prompt)
    assert.ok(!Object.hasOwn(spec.request, 'outputSchema'))
  })
  it('later tasks use sendMessage even when the child is cold', async () => {
    const { bridge, request, pair, calls } = setup(); pair.established = true
    assert.deepEqual(await bridge.dispatch(request), { messageId: 'followup' })
    assert.equal(calls.filter(row => row[0] === 'start').length, 0)
    assert.equal(calls[0][2], 'writer')
  })
  it('rejects unsupported providers without dispatch', async () => {
    const { bridge, request, provider, calls } = setup(); provider.capabilities.toolFilter = false
    await assert.rejects(bridge.dispatch(request), { code: 'UNSUPPORTED_CAPABILITY' }); assert.equal(calls.length, 0)
  })
  it('does not silently use a history-copying provider', async () => {
    const { bridge, request, provider } = setup(); provider.inheritsParentContext = true
    await assert.rejects(bridge.dispatch(request), { code: 'CONTEXT_NOT_ISOLATED' })
  })
  it('rejects stale live Agent objects', () => {
    const { bindings, lead, agents } = setup(); agents.set('lead', { ...lead })
    assert.throws(() => nativeActor(bindings, lead), { code: 'UNAUTHORIZED' })
  })
  it('does not dispatch across a changed workspace', async () => {
    const { bridge, request, lead, calls } = setup(); lead.session.header.cwd = '/other'
    await assert.rejects(bridge.dispatch(request), { code: 'UNAUTHORIZED' }); assert.equal(calls.length, 0)
  })
  it('rejects accidental recursive child controls', async () => {
    const { bridge, request, composition } = setup(); composition.tools = () => ['fusion_report', 'fusion_delegate']
    await assert.rejects(bridge.dispatch(request), { code: 'INVALID_COMPOSITION' })
  })
  it('reports through the real native child-to-parent message channel', async () => {
    const { bridge, pair, make, calls } = setup(); const writer = make('writer', 'lead')
    await bridge.notify({ pair, task: {}, actor: { sessionId: 'writer', parentSessionId: 'lead', project: '/work' }, text: 'Report', signal: new AbortController().signal })
    assert.equal(calls[0][1], writer); assert.equal(calls[0][2], 'lead')
  })
  it('rejects a substituted child during notification', async () => {
    const { bridge, pair, make } = setup(); make('writer', 'another-parent')
    await assert.rejects(bridge.notify({ pair, task: {}, actor: { sessionId: 'writer', parentSessionId: 'lead', project: '/work' }, text: 'Report', signal: new AbortController().signal }), { code: 'UNAUTHORIZED' })
  })
  it('clears pending child work then releases only the owned child', async () => {
    const { bridge, pair, make, calls } = setup(); make('writer', 'lead'); make('other-child', 'lead')
    await bridge.stop(pair, false)
    assert.deepEqual(calls[0], ['clear', 'writer']); assert.equal(calls[1][0], 'drain')
    assert.deepEqual(calls[1][2], ['writer']); assert.ok(!calls.some(row => row[0] === 'cancel'))
  })
  it('task stop also cancels the Lead without deleting unrelated queued requests', async () => {
    const { bridge, pair, make, calls } = setup(); make('writer', 'lead')
    await bridge.stop(pair, true)
    assert.deepEqual(calls.find(row => row[0] === 'cancel'), ['cancel', 'lead', { kind: 'user' }, { keepInbox: true }])
  })
  it('a missing parent is not reported as successful ownership cleanup', async () => {
    const { bridge, pair, make, agents, calls } = setup(); make('writer', 'lead'); agents.delete('lead')
    await assert.rejects(bridge.stop(pair, false), { code: 'PARENT_UNAVAILABLE' })
    assert.ok(calls.some(row => row[0] === 'interrupt')); assert.ok(!calls.some(row => row[0] === 'drain'))
  })
  it('an already-aborted request cannot create a child', async () => {
    const { bridge, request, calls } = setup(); const controller = new AbortController(); controller.abort(); request.signal = controller.signal
    await assert.rejects(bridge.dispatch(request), { name: 'AbortError' }); assert.equal(calls.length, 0)
  })
})

describe('production native notice and composition boundaries', () => {
  it('clears inherited reasoning when the pair route intentionally uses the provider default', async () => {
    const { bridge, request, pair, calls, lead } = setup()
    pair.route = { provider: 'p', model: 'm' }; lead.options = { provider: 'p', model: 'm', reasoningEffort: 'high' }
    await bridge.dispatch(request)
    const options = calls.find(row => row[0] === 'start')[1].request.agentOptions
    assert.equal(Object.hasOwn(options, 'reasoningEffort'), true); assert.equal(options.reasoningEffort, undefined)
  })
  it('production filtering leaves report registration to the owned child creation hook', async () => {
    const { bridge, request, calls, composition } = setup(); composition.scopedReport = true
    await bridge.dispatch(request)
    assert.deepEqual(calls.find(row => row[0] === 'start')[1].request.toolFilter, { allow: [] })
  })
  it('explicit saved-report recovery can notify a live Lead without activating a cold Writer', async () => {
    const { bridge, pair, lead, calls } = setup(); lead.followup = message => calls.push(['followup', message])
    await bridge.notify({ pair, task: { id: 'task', revision: 1 }, actor: { sessionId: 'lead', project: '/work' }, text: 'Saved report', signal: new AbortController().signal })
    assert.equal(calls.length, 1); assert.equal(calls[0][0], 'followup'); assert.equal(calls[0][1].source.kind, 'plugin:@klarkxy/dsh-fusion')
  })
  it('removes structured owned notices while preserving unrelated child and user inbox entries', async () => {
    const { bridge, pair, lead, make, calls } = setup(); make('writer', 'lead')
    lead.inbox.nextTurn = [
      { id: 'owned', source: { kind: 'subagent-settled', senderSessionId: 'writer' }, content: [] },
      { id: 'other', source: { kind: 'subagent-settled', senderSessionId: 'other-child' }, content: [] },
      { id: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '[fusion:pair:fake]' }] },
    ]
    lead.inbox.nextStep = []; lead.inbox.remove = id => calls.push(['remove', id])
    await bridge.stop(pair, false)
    assert.deepEqual(calls.filter(row => row[0] === 'remove'), [['remove', 'owned']])
  })
})
