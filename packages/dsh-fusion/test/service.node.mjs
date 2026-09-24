import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { FusionService, contentHash } from '../src/service.ts'
import { emptyFusionState } from '../src/contracts.ts'
import { validateState } from '../src/validation.ts'

const lead = { sessionId: 'lead', project: '/work' }
const request = () => ({ profile: 'writing', route: { provider: 'test', model: 'writer' },
  brief: { title: 'A scene', goal: 'Write the scene', context: 'Known facts', constraints: ['No reveal'], acceptance: ['Open ending'] },
  signal: new AbortController().signal })
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function setup(stored = emptyFusionState(), overrides = {}) {
  let saved = structuredClone(stored), counter = 0
  const starts = [], notifications = [], stops = []
  const store = { load: () => structuredClone(saved), save: async next => { saved = structuredClone(next) } }
  const native = {
    dispatch: async input => { starts.push(input); return { messageId: `message-${starts.length}` } },
    notify: async input => { notifications.push(input) },
    stop: async (pair, stopLead) => { stops.push({ pair, stopLead }) },
    ...overrides,
  }
  const service = new FusionService({ store, native, id: () => `id-${++counter}`, now: () => 1_000 })
  return { service, store, starts, notifications, stops, saved: () => saved }
}
function child(service) { return { sessionId: service.pairFor('lead').childSessionId, parentSessionId: 'lead', project: '/work' } }
async function report(service, task, body = 'Exact Writer prose\n第二段。') {
  return service.report(child(service), { taskId: task.id, taskRevision: task.revision, reportId: `r-${task.revision}`, kind: 'candidate', text: body, report: 'Checked', signal: request().signal })
}
async function accept(service, task) {
  const candidate = task.candidates.at(-1)
  return service.review(lead, { taskId: task.id, taskRevision: task.revision, candidateId: candidate.id, hash: candidate.hash, verdict: 'accept', feedback: '', signal: request().signal })
}
describe('Fusion business lifecycle', () => {
  it('initialization and read-only inspection never call a model', async () => {
    const { service, starts, notifications } = setup(); await service.initialized()
    assert.equal(starts.length, 0); assert.equal(notifications.length, 0); assert.deepEqual(service.snapshot().pairs, [])
  })
  it('reuses one durable child, keeps exact prose and separates review from adoption', async () => {
    const { service, starts } = setup()
    let task = await service.delegate(lead, { ...request(), target: { domain: 'editor', data: { path: 'scene.md', kind: 'create' } } })
    task = await report(service, task); const original = task.candidates[0].text
    task = await accept(service, task)
    assert.equal(task.state, 'accepted'); assert.equal(task.adoption, 'pending')
    const pair = service.pairFor('lead')
    await service.adoption('lead', task.id, task.candidates[0].id, 'applied')
    const second = await service.delegate(lead, request())
    assert.notEqual(task.id, second.id); assert.equal(starts[0].pair.childSessionId, starts[1].pair.childSessionId)
    assert.equal(starts[1].pair.established, true); assert.equal(pair.tasks[0].candidates[0].text, original)
    assert.equal(pair.tasks[0].candidates[0].hash, contentHash(original))
  })
  it('rejects parallel tasks and cannot delegate from a child', async () => {
    const { service } = setup(); await service.delegate(lead, request())
    await assert.rejects(service.delegate(lead, request()), { code: 'BUSY' })
    await assert.rejects(service.delegate(child(service), request()), { code: 'UNAUTHORIZED' })
  })
  it('rejects sibling, foreign project and fake parent reports', async () => {
    const { service } = setup(); const task = await service.delegate(lead, request())
    const input = { taskId: task.id, taskRevision: 1, reportId: 'r', kind: 'candidate', text: 'draft', signal: request().signal }
    await assert.rejects(service.report({ ...child(service), parentSessionId: 'other' }, input), { code: 'UNAUTHORIZED' })
    await assert.rejects(service.report({ ...child(service), project: '/other' }, input), { code: 'UNAUTHORIZED' })
    await assert.rejects(service.report({ ...child(service), sessionId: 'sibling' }, input), { code: 'UNAUTHORIZED' })
  })
  it('duplicates do not create a second candidate or wake the Lead twice', async () => {
    const { service, notifications } = setup(); const task = await service.delegate(lead, request())
    await report(service, task); await report(service, task)
    assert.equal(service.pairFor('lead').tasks[0].candidates.length, 1); assert.equal(notifications.length, 1)
    assert.equal(service.pairFor('lead').tasks[0].notifiedReportId, '1:r-1')
  })
  it('rejects stale or forged review hashes', async () => {
    const { service } = setup(); let task = await service.delegate(lead, request()); task = await report(service, task)
    await assert.rejects(service.review(lead, { taskId: task.id, taskRevision: 1, candidateId: task.candidates[0].id, hash: '0'.repeat(64), verdict: 'accept', feedback: '', signal: request().signal }), { code: 'STALE' })
  })
  it('revision invalidates old reports and preserves old candidate versions', async () => {
    const { service } = setup(); let task = await service.delegate(lead, request()); task = await report(service, task)
    const original = structuredClone(task.candidates[0])
    task = await service.review(lead, { taskId: task.id, taskRevision: 1, candidateId: original.id, hash: original.hash, verdict: 'revise', feedback: 'More restrained', signal: request().signal })
    assert.equal(task.revision, 2); assert.equal(task.state, 'working')
    await assert.rejects(report(service, { ...task, revision: 1 }), { code: 'STALE' })
    task = await report(service, task, 'Revised exact text')
    assert.deepEqual(task.candidates[0], original); assert.equal(task.candidates[1].revision, 2)
  })
  it('decision reports suspend business work and resume the same child', async () => {
    const { service, starts } = setup(); let task = await service.delegate(lead, request())
    task = await service.report(child(service), { taskId: task.id, taskRevision: 1, reportId: 'decision', kind: 'decision', text: 'Two constraints conflict', signal: request().signal })
    assert.equal(task.state, 'decision')
    task = await service.decide(lead, { taskId: task.id, taskRevision: 1, feedback: 'Keep the ending', signal: request().signal })
    assert.equal(task.state, 'working'); assert.equal(starts[0].pair.childSessionId, starts[1].pair.childSessionId)
  })
  it('cancellation invalidates reports before native stop finishes', async () => {
    const stop = deferred(), { service } = setup(undefined, { stop: () => stop.promise })
    const task = await service.delegate(lead, request())
    const cancelling = service.cancel(lead, task.id, 1)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(service.pairFor('lead').tasks[0].cleanup, 'pending')
    await assert.rejects(report(service, task), { code: 'STALE' })
    stop.resolve(); await cancelling
    assert.equal(service.pairFor('lead').tasks[0].cleanup, 'done')
  })
  it('late initial admission is recorded but cannot revive a cancelled task', async () => {
    const admitted = deferred(), { service, stops } = setup(undefined, { dispatch: () => admitted.promise })
    const dispatch = service.delegate(lead, request())
    await new Promise(resolve => setImmediate(resolve))
    const task = service.pairFor('lead').tasks[0]
    await service.cancel(lead, task.id, 1)
    admitted.resolve({ messageId: 'late' }); await assert.rejects(dispatch, { code: 'STALE' })
    assert.equal(service.pairFor('lead').established, true)
    assert.equal(service.pairFor('lead').tasks[0].state, 'cancelled'); assert.ok(stops.length >= 1)
  })
  it('restoring storage is passive and marks in-flight work as uncertain', async () => {
    const first = setup(); await first.service.delegate(lead, request())
    const restored = setup(first.saved()); await restored.service.initialized()
    assert.equal(restored.service.pairFor('lead').tasks[0].state, 'interrupted')
    assert.equal(restored.starts.length, 0)
  })
  it('disabling cancels owned tasks and rejects new work without deleting history', async () => {
    const { service, stops } = setup(); const task = await service.delegate(lead, request())
    await service.dispose()
    assert.equal(service.active, false); assert.equal(service.pairFor('lead').tasks[0].state, 'cancelled')
    assert.equal(stops.length, 1); await assert.rejects(report(service, task), { code: 'DISABLED' })
  })
  it('routes never silently change on a persistent child', async () => {
    const { service } = setup(); let task = await service.delegate(lead, request()); task = await report(service, task); await accept(service, task)
    await assert.rejects(service.delegate(lead, { ...request(), route: { provider: 'other', model: 'other' } }), { code: 'ROUTE_CHANGED' })
  })
  it('read returns detached values and cannot mutate the accepted content', async () => {
    const { service } = setup(); let task = await service.delegate(lead, request()); task = await report(service, task)
    const view = service.read(lead, task.id); view.candidate.text = 'forged'
    assert.notEqual(service.read(lead, task.id).candidate.text, 'forged')
    await assert.rejects(Promise.resolve().then(() => service.read({ ...lead, project: '/other' }, task.id)), { code: 'UNAUTHORIZED' })
  })
  it('failed storage keeps the previously saved state', async () => {
    const { service, store } = setup(); await service.initialized(); const before = service.snapshot()
    store.save = async () => { throw new Error('disk full') }
    await assert.rejects(service.delegate(lead, request()), /disk full/)
    assert.deepEqual(service.snapshot(), before)
  })
  it('rejects persisted candidate tampering and reviews of unknown candidates', async () => {
    const first = setup(); let task = await first.service.delegate(lead, request())
    task = await report(first.service, task); await accept(first.service, task)
    const changedText = first.saved()
    changedText.pairs[0].tasks[0].candidates[0].text = 'forged prose'
    assert.throws(() => setup(changedText), { code: 'INVALID_STATE' })
    const changedReview = first.saved()
    changedReview.pairs[0].tasks[0].reviews[0].candidateId = 'missing'
    assert.throws(() => setup(changedReview), { code: 'INVALID_STATE' })
    const changedReceipt = first.saved()
    changedReceipt.pairs[0].tasks[0].notifiedReportId = '1:missing'
    assert.throws(() => setup(changedReceipt), { code: 'INVALID_STATE' })
  })
  it('cancellation aborts a report notification still pending at the native boundary', async () => {
    const entered = deferred()
    const { service } = setup(undefined, { notify: ({ signal }) => {
      entered.resolve(signal)
      return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    } })
    const task = await service.delegate(lead, request())
    const reporting = report(service, task)
    const signal = await entered.promise
    await service.cancel(lead, task.id, task.revision)
    assert.equal(signal.aborted, true)
    await assert.rejects(reporting, { name: 'AbortError' })
    assert.equal(service.pairFor('lead').tasks[0].state, 'cancelled')
  })
  it('a caller abort after a durable report does not erase its notification', async () => {
    const entered = deferred(), release = deferred()
    const { service } = setup(undefined, { notify: async ({ signal }) => {
      entered.resolve(signal)
      await release.promise
      signal.throwIfAborted()
    } })
    const task = await service.delegate(lead, request())
    const caller = new AbortController()
    const reporting = service.report(child(service), { taskId: task.id, taskRevision: task.revision,
      reportId: 'caller-aborted', kind: 'candidate', text: 'Durable prose', signal: caller.signal })
    const nativeSignal = await entered.promise
    caller.abort()
    assert.equal(nativeSignal.aborted, false)
    release.resolve()
    assert.equal((await reporting).state, 'review')
  })
  it('aborts both old and current native notifications across revise and cancel', async () => {
    const firstEntered = deferred(), secondEntered = deferred()
    const firstRelease = deferred(), secondRelease = deferred(), signals = []
    const { service } = setup(undefined, { notify: async ({ signal }) => {
      signals.push(signal)
      if (signals.length === 1) { firstEntered.resolve(); await firstRelease.promise }
      else { secondEntered.resolve(); await secondRelease.promise }
    } })
    const original = await service.delegate(lead, request())
    const firstReport = report(service, original, 'First revision')
    await firstEntered.promise
    const candidate = service.pairFor('lead').tasks[0].candidates[0]
    const revised = await service.review(lead, { taskId: original.id, taskRevision: 1,
      candidateId: candidate.id, hash: candidate.hash, verdict: 'revise',
      feedback: 'Change the ending', signal: request().signal })
    assert.equal(signals[0].aborted, true)
    const secondReport = report(service, revised, 'Second revision')
    await secondEntered.promise
    await service.cancel(lead, original.id, revised.revision)
    assert.deepEqual(signals.map(signal => signal.aborted), [true, true])
    firstRelease.resolve(); secondRelease.resolve()
    await Promise.all([firstReport, secondReport])
    assert.equal(service.pairFor('lead').tasks[0].notifiedReportId, undefined)
  })
  it('a failed Lead notice stays uncertain on duplicate report and cold restore', async () => {
    let calls = 0
    const first = setup(undefined, { notify: async () => { calls++; throw new Error('native delivery unknown') } })
    const task = await first.service.delegate(lead, request())
    await assert.rejects(report(first.service, task), /native delivery unknown/)
    assert.equal(first.service.pairFor('lead').tasks[0].candidates.length, 1)
    await assert.rejects(report(first.service, task), { code: 'NOTIFICATION_UNCERTAIN' })
    assert.equal(calls, 1)
    const restored = setup(first.saved())
    await restored.service.initialized()
    assert.equal(restored.service.pairFor('lead').tasks[0].state, 'interrupted')
    await assert.rejects(report(restored.service, task), { code: 'NOTIFICATION_UNCERTAIN' })
    assert.equal(restored.notifications.length, 0)
  })
  it('rejects malformed persistent identity and oversized input', async () => {
    assert.throws(() => validateState({ version: 2, revision: 0, pairs: [] }), { code: 'INVALID_STATE' })
    const { service } = setup()
    await assert.rejects(service.delegate(lead, { ...request(), brief: { ...request().brief, goal: 'x'.repeat(8001) } }), { code: 'INVALID_INPUT' })
  })
})
