import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { acceptedCandidate, actionIdentity, activityLabel, appliedReceipt, canAdopt, currentTask, isCurrentAction, needsRefresh, notifyAppliedReceipt, reconciledReceipt, taskAnchorTurn } from '../src/client-projection.ts'
import { FusionClientStore } from '../src/client-store.ts'

const task = (overrides = {}) => ({
  id: 'task-1', revision: 2, state: 'accepted', brief: { title: '一场戏' }, target: { domain: 'editor', data: {} },
  candidates: [{ id: 'c1', taskRevision: 2, revision: 1, hash: 'h1', text: '原稿', report: '', createdAt: 8 }],
  reviews: [{ candidateId: 'c1', candidateHash: 'h1', verdict: 'accept', feedback: '', createdAt: 9 }],
  reportIds: [], delivery: 'accepted', updatedAt: 20, ...overrides,
})
const pair = (profile, row) => ({ leadSessionId: 'lead', childSessionId: 'child', profile, tasks: [row] })

describe('Fusion client projection', () => {
  it('adopts only the exact current Writer revision accepted by Lead for a writing target', () => {
    const accepted = task()
    assert.equal(currentTask(pair('writing', accepted)), accepted)
    assert.equal(acceptedCandidate(accepted)?.id, 'c1')
    assert.equal(canAdopt(pair('writing', accepted), accepted), true)
    assert.equal(canAdopt(pair('generic', accepted), accepted), false)
    assert.equal(canAdopt(pair('writing', task({ reviews: [{ candidateId: 'c1', candidateHash: 'wrong', verdict: 'accept' }] })),
      task({ reviews: [{ candidateId: 'c1', candidateHash: 'wrong', verdict: 'accept' }] })), false)
    assert.equal(canAdopt(pair('writing', task({ adoption: 'applied' })), task({ adoption: 'applied' })), false)
    assert.equal(canAdopt(pair('writing', task({ application: { state: 'pending' } })), task({ application: { state: 'pending' } })), false)
  })

  it('stales author actions after a Session, review, candidate, or mount change', () => {
    const initial = task()
    const captured = actionIdentity('lead', initial, initial.candidates[0])
    assert.equal(isCurrentAction(true, captured, captured), true)
    assert.equal(isCurrentAction(false, captured, captured), false)
    assert.equal(isCurrentAction(true, captured, actionIdentity('other', initial, initial.candidates[0])), false)
    assert.equal(isCurrentAction(true, captured, actionIdentity('lead', task({ revision: 3 }), initial.candidates[0])), false)
    assert.equal(isCurrentAction(true, captured, actionIdentity('lead', initial, { ...initial.candidates[0], hash: 'new' })), false)
  })
  it('accepts only the Host receipt for the exact preview and a previously seen pending intent', () => {
    const candidate = task().candidates[0]
    const preview = { path: '章节/一.md', before: '旧', after: '新', version: 'v0', candidateId: 'c1', hash: 'h1' }
    const application = { id: 'apply-1', candidateId: 'c1', candidateHash: 'h1', path: preview.path,
      beforeVersion: 'v0', afterHash: 'h2', state: 'applied', version: 'v1' }
    const applied = task({ adoption: 'applied', application })
    assert.deepEqual(appliedReceipt(applied, task(), candidate, preview), { id: 'apply-1', path: preview.path })
    assert.equal(appliedReceipt({ ...applied, application: { ...application, path: '其他.md' } }, task(), candidate, preview), undefined)
    assert.equal(appliedReceipt({ ...applied, application: { ...application, state: 'pending' } }, task(), candidate, preview), undefined)
    const pending = { sessionId: 'lead', taskId: 'task-1', id: 'apply-1', path: preview.path,
      candidateId: 'c1', candidateHash: 'h1' }
    assert.equal(reconciledReceipt(undefined, 'lead', applied), undefined)
    assert.equal(reconciledReceipt(pending, 'other', applied), undefined)
    assert.deepEqual(reconciledReceipt(pending, 'lead', applied), { id: 'apply-1', path: preview.path })
  })

  it('does not refresh the next Session when an old apply response arrives late', async () => {
    const candidate = task().candidates[0]
    const preview = { path: '章节/一.md', before: '旧', after: '新', version: 'v0', candidateId: 'c1', hash: 'h1' }
    const applied = task({ adoption: 'applied', application: { id: 'apply-1', candidateId: 'c1', candidateHash: 'h1',
      path: preview.path, beforeVersion: 'v0', afterHash: 'h2', state: 'applied', version: 'v1' } })
    let resolve
    const pending = new Promise(done => { resolve = done })
    let selected = 'lead'
    const refreshed = []
    const work = pending.then(value => notifyAppliedReceipt({ value, task: task(), candidate, preview,
      isCurrent: () => selected === 'lead', notify: receipt => refreshed.push(receipt.path) }))
    selected = 'new-session'
    resolve(applied)
    assert.equal(await work, false)
    assert.deepEqual(refreshed, [])
  })
  it('keeps the receipt callback current when status observes this same apply first', () => {
    const original = task()
    const candidate = original.candidates[0]
    const preview = { path: '章节/一.md', before: '旧', after: '新', version: 'v0', candidateId: 'c1', hash: 'h1' }
    const applied = task({ adoption: 'applied', updatedAt: 99, application: { id: 'apply-1', candidateId: 'c1',
      candidateHash: 'h1', path: preview.path, beforeVersion: 'v0', afterHash: 'h2', state: 'applied', version: 'v1' } })
    const captured = actionIdentity('lead', original, candidate)
    const latest = actionIdentity('lead', applied, candidate)
    const refreshed = []
    assert.equal(notifyAppliedReceipt({ value: applied, task: original, candidate, preview,
      isCurrent: () => isCurrentAction(true, captured, latest), notify: receipt => refreshed.push(receipt.path) }), true)
    assert.deepEqual(refreshed, [preview.path])
    assert.equal(activityLabel('idle', 'zh'), '待命')
    assert.equal(activityLabel('running', 'zh'), '运行中')
    assert.equal(activityLabel('future-native-status', 'zh'), 'future-native-status')
  })
  it('polls ongoing work but leaves interrupted and settled tasks for explicit recovery', () => {
    assert.equal(needsRefresh(task({ state: 'working' })), true)
    assert.equal(needsRefresh(task({ state: 'interrupted', delivery: 'uncertain' })), false)
    assert.equal(needsRefresh(task({ state: 'accepted', adoption: 'pending' })), false)
    assert.equal(needsRefresh(task({ state: 'cancelled', cleanup: 'pending' })), true)
  })
  it('anchors a settled task at the last Lead turn existing when the task changed', () => {
    const entries = [
      { event: { time: 10, data: { turn: 1 } } },
      { event: { time: 19, data: { turn: 2 } } },
      { event: { time: 29, data: { turn: 3 } } },
    ]
    assert.equal(taskAnchorTurn(task(), entries), 2)
    assert.equal(taskAnchorTurn(task({ updatedAt: 31 }), entries), 3)
    assert.equal(taskAnchorTurn(task({ updatedAt: 1 }), entries), 3)
  })
})

describe('Fusion status subscription', () => {
  it('discards an old Session response after switching sessions', async () => {
    const pending = new Map()
    const rpc = { call(_channel, _endpoint, { sessionId }) {
      return new Promise(resolve => pending.set(sessionId, resolve))
    } }
    const store = new FusionClientStore({ connection: { rpc }, sessions: {} })
    const oldUpdates = []
    const stopOld = store.subscribe('old', () => oldUpdates.push(store.snapshot('old')))
    stopOld()
    const newUpdates = []
    const stopNew = store.subscribe('new', () => newUpdates.push(store.snapshot('new')))
    pending.get('old')({ ok: true, value: { available: true, profile: 'generic', configured: true, pair: pair('generic', task()) } })
    await Promise.resolve()
    assert.equal(store.snapshot('old').status, undefined)
    assert.equal(oldUpdates.length, 0)
    pending.get('new')({ ok: true, value: { available: true, profile: 'generic', configured: true } })
    await Promise.resolve()
    assert.equal(newUpdates.at(-1)?.status?.available, true)
    stopNew(); store.dispose()
  })

  it('emits one refresh per Host application receipt', () => {
    const store = new FusionClientStore({ connection: { rpc: { call: async () => ({ ok: true, value: {} }) } }, sessions: {} })
    const paths = []
    assert.equal(store.announceApplied('lead', 'apply-1', '章节/一.md', path => paths.push(path)), true)
    assert.equal(store.announceApplied('lead', 'apply-1', '章节/一.md', path => paths.push(path)), false)
    assert.equal(store.announceApplied('other', 'apply-1', '章节/二.md', path => paths.push(path)), true)
    assert.deepEqual(paths, ['章节/一.md', '章节/二.md'])
    store.dispose()
  })
  it('ignores a status read invalidated by an author action', async () => {
    const pending = []
    const store = new FusionClientStore({ connection: { rpc: { call() { return new Promise(resolve => pending.push(resolve)) } } }, sessions: {} })
    const stop = store.subscribe('lead', () => {})
    store.invalidate('lead')
    const refreshed = store.refresh('lead')
    pending[0]({ ok: true, value: { available: false, profile: 'generic', configured: false } })
    await Promise.resolve()
    pending[1]({ ok: true, value: { available: true, profile: 'writing', configured: true } })
    await refreshed
    assert.equal(store.snapshot('lead').status?.available, true)
    stop(); store.dispose()
  })
})
