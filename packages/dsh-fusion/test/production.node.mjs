import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { FusionService, contentHash } from '../src/service.ts'
import { emptyFusionState } from '../src/contracts.ts'
import { validateState } from '../src/validation.ts'
import { createFusionStore, fusionStateSchema } from '../src/storage.ts'
const signal = () => new AbortController().signal
const lead = { sessionId: 'lead', project: '/work' }
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const tick = () => new Promise(resolve => setImmediate(resolve))
function harness(options = {}) {
  let saved = structuredClone(options.state ?? emptyFusionState()), id = 0, saves = 0
  const events = [], native = { dispatch: async input => { events.push(['dispatch', input]); return { messageId: `m-${events.length}` } }, notify: async input => { events.push(['notify', input]); if (options.notifyFails) throw new Error('notice failed') }, stop: async (...args) => events.push(['stop', ...args]) }
  const store = { load: () => saved, save: async state => { saves++; if (options.failSave?.(state, saves)) throw new Error('disk full'); saved = structuredClone(state) } }
  const service = new FusionService({ store, native, id: () => `id-${++id}`, ...(options.inspectAdmission ? { inspectAdmission: options.inspectAdmission } : {}) })
  const request = { profile: 'writing', route: { provider: 'p', model: 'm' }, brief: { title: 'Scene', goal: 'Edit scene', context: '', constraints: [], acceptance: [] }, target: { domain: 'editor', data: { path: 'scene.md' } }, signal: signal() }
  const actor = () => ({ sessionId: service.pairFor('lead').childSessionId, parentSessionId: 'lead', project: '/work' })
  async function candidate(profile = 'writing') {
    let task = await service.delegate(lead, { ...request, profile, ...(profile === 'generic' ? { target: undefined } : {}) })
    task = await service.report(actor(), { taskId: task.id, taskRevision: task.revision, reportId: 'r1', kind: 'candidate', text: 'Writer exact fragment', report: '', signal: signal() })
    const value = task.candidates.at(-1), action = { sessionId: 'lead', taskId: task.id, taskRevision: task.revision, candidateId: value.id, hash: value.hash }
    await service.review(lead, { ...action, verdict: 'accept', feedback: '', signal: signal() })
    return action
  }
  return { service, events, options, request, actor, candidate, saved: () => structuredClone(saved) }
}
function host(options = {}) {
  let text = options.text ?? 'Before', version = 'v1', commits = 0
  return { get text() { return text }, get commits() { return commits }, setText(value) { text = value; version = 'edited' },
    async transact(_actor, _target, candidate, signal, run) { return run({
      inspect: async () => ({ text, version }),
      prepare: async () => { options.preparing?.resolve(); if (options.prepareGate) await options.prepareGate.promise; if (options.prepareError) throw new Error(options.prepareError); return { path: 'scene.md', before: text, after: `prefix ${candidate.text} suffix`, version } },
      commit: async expected => { assert.equal(expected, version); signal.throwIfAborted(); options.committing?.resolve(); if (options.commitGate) await options.commitGate.promise; text = `prefix ${candidate.text} suffix`; version = 'v2'; commits++; if (options.afterWriteError) throw new Error('connection lost after write'); return { path: 'scene.md', version } },
    }) },
  }
}
describe('production Fusion adoption and recovery', () => {
  it('saves exact resulting file intent before commit and cannot apply twice', async () => {
    const h = harness(), action = await h.candidate(), domain = host()
    await assert.rejects(h.service.delegate(lead, h.request), { code: 'ADOPTION_PENDING' })
    const preview = await h.service.preview(lead, action, domain, signal())
    assert.equal(preview.after, 'prefix Writer exact fragment suffix')
    const result = await h.service.applyCandidate(lead, { ...action, expectedVersion: preview.version }, domain, signal())
    assert.equal(result.adoption, 'applied'); assert.equal(result.application.afterHash, contentHash(domain.text)); assert.notEqual(result.application.afterHash, action.hash)
    await assert.rejects(h.service.applyCandidate(lead, { ...action, expectedVersion: 'v2' }, domain, signal()), { code: 'ALREADY_APPLIED' })
    assert.equal(domain.commits, 1)
  })
  it('cancel accepted writing candidate dismisses adoption and permits next task; generic stays generic', async () => {
    for (const profile of ['writing', 'generic']) {
      const h = harness(), action = await h.candidate(profile)
      await h.service.cancel(lead, action.taskId, action.taskRevision)
      const task = h.service.read(lead, action.taskId).task
      assert.equal(task.adoption, profile === 'writing' ? 'dismissed' : undefined)
      await h.service.delegate(lead, { ...h.request, profile, target: undefined })
    }
  })
  it('Stop during prepare wins before any file mutation', async () => {
    const h = harness(), action = await h.candidate(), preparing = deferred(), gate = deferred(), domain = host({ preparing, prepareGate: gate })
    const applying = h.service.applyCandidate(lead, { ...action, expectedVersion: 'v1' }, domain, signal())
    await preparing.promise
    const cancelled = h.service.cancel(lead, action.taskId, action.taskRevision)
    await tick(); gate.resolve()
    await assert.rejects(applying, { name: 'AbortError' }); await cancelled
    assert.equal(domain.commits, 0); assert.equal(h.service.read(lead, action.taskId).task.adoption, 'dismissed')
  })
  it('disable during prepare wins without a file mutation', async () => {
    const h = harness(), action = await h.candidate(), preparing = deferred(), gate = deferred(), domain = host({ preparing, prepareGate: gate })
    const applying = h.service.applyCandidate(lead, { ...action, expectedVersion: 'v1' }, domain, signal())
    await preparing.promise; const disposal = h.service.dispose(); gate.resolve()
    await assert.rejects(applying, { name: 'AbortError' }); await disposal; assert.equal(domain.commits, 0)
  })
  it('a completed file write keeps its receipt even if disable wins while commit is awaiting', async () => {
    const h = harness(), action = await h.candidate(), committing = deferred(), gate = deferred(), domain = host({ committing, commitGate: gate })
    const applying = h.service.applyCandidate(lead, { ...action, expectedVersion: 'v1' }, domain, signal())
    await committing.promise
    assert.equal(h.saved().pairs[0].tasks[0].application.state, 'pending')
    const disposal = h.service.dispose(); gate.resolve()
    const result = await applying; await disposal
    assert.equal(result.adoption, 'applied'); assert.equal(h.saved().pairs[0].tasks[0].application.state, 'applied'); assert.equal(domain.commits, 1)
  })
  it('a write that wins against Stop cannot be relabelled cancelled', async () => {
    const h = harness(), action = await h.candidate(), committing = deferred(), gate = deferred(), domain = host({ committing, commitGate: gate })
    const applying = h.service.applyCandidate(lead, { ...action, expectedVersion: 'v1' }, domain, signal())
    await committing.promise; const cancelled = h.service.cancel(lead, action.taskId, action.taskRevision); gate.resolve()
    await applying; await assert.rejects(cancelled, { code: 'ALREADY_APPLIED' }); assert.equal(h.service.read(lead, action.taskId).task.adoption, 'applied')
  })
  it('cold recovery reconciles exact written result without replaying commit', async () => {
    const h = harness(), action = await h.candidate(), domain = host({ afterWriteError: true })
    await assert.rejects(h.service.applyCandidate(lead, { ...action, expectedVersion: 'v1' }, domain, signal()), /connection lost/)
    assert.equal(h.saved().pairs[0].tasks[0].application.state, 'pending')
    const restored = harness({ state: h.saved() })
    await restored.service.reconcile(lead, domain, signal())
    assert.equal(restored.service.read(lead, action.taskId).task.adoption, 'applied'); assert.equal(domain.commits, 1); assert.equal(restored.events.length, 0)
  })
  it('uncertain write with author changes becomes conflict and never replays', async () => {
    const h = harness(), action = await h.candidate(), domain = host({ afterWriteError: true })
    await assert.rejects(h.service.applyCandidate(lead, { ...action, expectedVersion: 'v1' }, domain, signal()))
    domain.setText('Author changed the destination')
    await h.service.reconcile(lead, domain, signal())
    assert.equal(h.service.read(lead, action.taskId).task.adoption, 'conflict'); assert.equal(domain.commits, 1)
    await h.service.cancel(lead, action.taskId, action.taskRevision)
    assert.equal(h.service.read(lead, action.taskId).task.adoption, 'dismissed')
  })
  it('storage failure after commit fails closed and leaves reconcilable intent', async () => {
    const h = harness(), action = await h.candidate(), domain = host()
    h.options.failSave = state => state.pairs[0]?.tasks[0]?.application?.state === 'applied'
    await assert.rejects(h.service.applyCandidate(lead, { ...action, expectedVersion: 'v1' }, domain, signal()), /disk full/)
    assert.equal(h.service.active, false); assert.equal(h.saved().pairs[0].tasks[0].application.state, 'pending')
    const restored = harness({ state: h.saved() }); await restored.service.reconcile(lead, domain, signal())
    assert.equal(restored.service.read(lead, action.taskId).task.adoption, 'applied'); assert.equal(domain.commits, 1)
  })
  it('version or dirty-draft failure is visible without changing files', async () => {
    const h = harness(), action = await h.candidate(), domain = host({ prepareError: 'Unsaved author draft' })
    await assert.rejects(h.service.applyCandidate(lead, { ...action, expectedVersion: 'v1' }, domain, signal()), /Unsaved/)
    assert.equal(h.service.read(lead, action.taskId).task.adoption, 'conflict'); assert.match(h.service.read(lead, action.taskId).task.error, /Unsaved/); assert.equal(domain.commits, 0)
  })
  it('notification recovery reuses the saved candidate and never dispatches Writer work', async () => {
    const h = harness({ notifyFails: true }), task = await h.service.delegate(lead, h.request)
    await assert.rejects(h.service.report(h.actor(), { taskId: task.id, taskRevision: 1, reportId: 'r1', kind: 'candidate', text: 'Saved exact candidate', signal: signal() }), /notice failed/)
    h.options.notifyFails = false
    const recovered = await h.service.recover(lead, task.id, 1, signal())
    assert.equal(recovered.candidates.length, 1); assert.equal(recovered.candidates[0].text, 'Saved exact candidate'); assert.equal(recovered.notifiedReportId, '1:r1')
    assert.equal(h.events.filter(row => row[0] === 'dispatch').length, 1)
    assert.equal(h.events.filter(row => row[0] === 'notify').at(-1)[1].actor.sessionId, 'lead')
  })
  it('rejects corrupted approvals, application references and duplicate pair identity', async () => {
    const h = harness(), action = await h.candidate(), domain = host()
    await h.service.applyCandidate(lead, { ...action, expectedVersion: 'v1' }, domain, signal())
    for (const corrupt of [s => { s.pairs[0].tasks[0].reviews[0].verdict = 'reject' }, s => { s.pairs[0].tasks[0].application.candidateId = 'foreign' }, s => { s.pairs[0].tasks[0].application.path = 'other.md' }, s => { s.pairs[0].createdAt = NaN }, s => { const pair = structuredClone(s.pairs[0]); pair.leadSessionId = 'other'; pair.childSessionId = 'another'; pair.tasks = []; s.pairs.push(pair) }]) {
      const state = h.saved(); corrupt(state); assert.throws(() => validateState(state)); assert.equal(fusionStateSchema.safeParse(state).success, false)
    }
    const store = createFusionStore({ get: () => ({ version: 999 }), put: async () => {} })
    assert.throws(() => store.load())
  })
  it('explicit initial admission recovery proves present or absent before dispatch', async () => {
    for (const result of ['present', 'absent']) {
      const h = harness(), task = await h.service.delegate(lead, h.request), state = h.saved()
      state.pairs[0].established = false; state.pairs[0].tasks[0].state = 'failed'; state.pairs[0].tasks[0].delivery = 'uncertain'
      let inspected = 0
      const restored = harness({ state, inspectAdmission: async () => { inspected++; return result } })
      await restored.service.decide(lead, { taskId: task.id, taskRevision: 1, feedback: 'Explicitly recover after inspection', signal: signal() })
      assert.equal(inspected, 1); assert.equal(restored.events[0][0], 'stop'); assert.equal(restored.events.find(row => row[0] === 'dispatch')[1].pair.established, result === 'present')
    }
  })
  it('an admission query failure cannot turn into proof of absence', async () => {
    const h = harness(), task = await h.service.delegate(lead, h.request), state = h.saved()
    state.pairs[0].established = false; state.pairs[0].tasks[0].state = 'failed'; state.pairs[0].tasks[0].delivery = 'uncertain'
    const restored = harness({ state, inspectAdmission: async () => { throw new Error('native query failed') } })
    await assert.rejects(restored.service.decide(lead, { taskId: task.id, taskRevision: 1, feedback: 'Recover', signal: signal() }), /native query failed/)
    assert.equal(restored.events.filter(row => row[0] === 'dispatch').length, 0)
  })
})

it('an exact empty Writer candidate can represent deletion, while empty decision requests reject', async () => {
  const h = harness(), task = await h.service.delegate(lead, h.request)
  await assert.rejects(h.service.report(h.actor(), { taskId: task.id, taskRevision: 1, reportId: 'empty-decision', kind: 'decision', text: '', signal: signal() }), { code: 'INVALID_INPUT' })
  const reported = await h.service.report(h.actor(), { taskId: task.id, taskRevision: 1, reportId: 'deletion', kind: 'candidate', text: '', report: 'Delete the selected fragment', signal: signal() })
  const candidate = reported.candidates[0]
  assert.equal(candidate.text, ''); assert.equal(candidate.hash, contentHash(''))
  const action = { sessionId: 'lead', taskId: task.id, taskRevision: 1, candidateId: candidate.id, hash: candidate.hash }
  await h.service.review(lead, { ...action, verdict: 'accept', feedback: '', signal: signal() })
  const domain = host()
  await h.service.applyCandidate(lead, { ...action, expectedVersion: 'v1' }, domain, signal())
  assert.equal(domain.text, 'prefix  suffix'); assert.equal(domain.commits, 1)
})

it('early child report and Lead acceptance do not turn a successful late admission into cancellation', async () => {
  const h = harness(), entered = deferred(), release = deferred()
  h.service['native'].dispatch = async () => { entered.resolve(); await release.promise; return { messageId: 'late-admitted' } }
  const delegation = h.service.delegate(lead, h.request)
  await entered.promise
  let task = h.service.pairFor('lead').tasks.at(-1)
  task = await h.service.report(h.actor(), { taskId: task.id, taskRevision: 1, reportId: 'fast', kind: 'candidate', text: 'Fast exact report', signal: signal() })
  const candidate = task.candidates[0]
  await h.service.review(lead, { taskId: task.id, taskRevision: 1, candidateId: candidate.id, hash: candidate.hash, verdict: 'accept', feedback: '', signal: signal() })
  release.resolve()
  const result = await delegation
  assert.equal(result.state, 'accepted'); assert.ok(result.messageIds.includes('late-admitted')); assert.equal(h.events.filter(row => row[0] === 'stop').length, 0)
})
it('early report/revise reuses the established child and old admission cannot drain the new revision', async () => {
  const h = harness(), entered = deferred(), release = deferred(), dispatches = []
  h.service['native'].dispatch = async input => { dispatches.push(input); if (dispatches.length === 1) { entered.resolve(); await release.promise }; return { messageId: `native-${input.task.revision}` } }
  const first = h.service.delegate(lead, h.request); await entered.promise
  let task = h.service.pairFor('lead').tasks.at(-1)
  task = await h.service.report(h.actor(), { taskId: task.id, taskRevision: 1, reportId: 'fast', kind: 'candidate', text: 'First candidate', signal: signal() })
  const candidate = task.candidates[0]
  const second = await h.service.review(lead, { taskId: task.id, taskRevision: 1, candidateId: candidate.id, hash: candidate.hash, verdict: 'revise', feedback: 'Revise the ending', signal: signal() })
  assert.equal(second.revision, 2); assert.equal(dispatches[1].pair.established, true)
  release.resolve(); const result = await first
  assert.equal(result.revision, 2); assert.equal(result.state, 'working'); assert.equal(h.events.filter(row => row[0] === 'stop').length, 0)
})

it('reserves bounded receipt capacity before committing a file near the store limit', async () => {
  const h = harness(), action = await h.candidate(), state = h.saved(), current = state.pairs[0].tasks[0]
  const filler = structuredClone(current)
  filler.adoption = 'applied'; filler.candidates[0].text = 'x'.repeat(200_000); filler.candidates[0].hash = contentHash(filler.candidates[0].text); filler.reviews[0].candidateHash = filler.candidates[0].hash
  state.pairs[0].tasks = Array.from({ length: 79 }, (_, i) => ({ ...structuredClone(filler), id: `filled-${i}` })).concat([current])
  state.pairs[0].tasks[0].target.data.padding = ''
  const remaining = 16_000_000 - 1_000 - JSON.stringify(state).length
  assert.ok(remaining > 0 && remaining < 190_000)
  state.pairs[0].tasks[0].target.data.padding = 'p'.repeat(remaining)
  validateState(state)
  const restored = harness({ state }), domain = host()
  await assert.rejects(restored.service.applyCandidate(lead, { ...action, expectedVersion: 'v1' }, domain, signal()), { code: 'CAPACITY' })
  assert.equal(domain.commits, 0); assert.equal(domain.text, 'Before')
  assert.equal(restored.saved().pairs[0].tasks.at(-1).application, undefined)
})
