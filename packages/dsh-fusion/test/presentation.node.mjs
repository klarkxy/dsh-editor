import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { taskView, isOwnedChildNotice } from '../src/presentation.ts'
const pair = { leadSessionId: 'parent/1', childSessionId: 'child/2', profile: 'writing' }
const task = { id: 't', state: 'working', brief: { title: '写一场戏' }, candidates: [] }
describe('Fusion task presentation', () => {
  it('keeps writing and generic vocabulary separate', () => {
    assert.equal(taskView(pair, task, 'zh').status, '执笔中')
    assert.equal(taskView({ ...pair, profile: 'generic' }, task, 'zh').status, '执行中')
  })
  it('does not confuse review with author adoption', () => {
    const reviewed = { ...task, state: 'accepted', target: { domain: 'editor' } }
    assert.equal(taskView(pair, reviewed, 'zh').status, '待你采用')
    assert.equal(taskView(pair, { ...reviewed, adoption: 'applied' }, 'zh').status, '已采用')
  })
  it('generic tasks do not pretend existing file changes await adoption', () => {
    const view = taskView({ ...pair, profile: 'generic' }, { ...task, state: 'accepted' }, 'en')
    assert.equal(view.status, 'Review passed'); assert.ok(!view.status.includes('adoption'))
  })
  it('unfinished cleanup stays visible and can be retried', () => {
    const view = taskView(pair, { ...task, state: 'cancelled', cleanup: 'failed' }, 'zh')
    assert.equal(view.status, '停止未完全完成'); assert.equal(view.canStop, true)
  })
  it('routes by exact escaped parent and child ids, not labels', () => {
    const view = taskView(pair, task, 'en')
    assert.equal(view.executionAddress, 'dsh-resource://subagentchat/session/child%2F2?parent=parent%2F1&mode=continuable')
  })
  it('only exact native source identity matches an owned notice', () => {
    assert.equal(isOwnedChildNotice({ kind: 'subagent-settled', senderSessionId: 'child' }, 'child'), true)
    assert.equal(isOwnedChildNotice({ kind: 'user', senderSessionId: 'child' }, 'child'), false)
    assert.equal(isOwnedChildNotice({ kind: 'agent-message', senderSessionId: 'other' }, 'child'), false)
    assert.equal(isOwnedChildNotice('child finished', 'child'), false)
  })
})
