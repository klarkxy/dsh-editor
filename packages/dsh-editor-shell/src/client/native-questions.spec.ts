import { expect, it } from 'vitest'
import { pendingForSession } from './chat-conversation.ts'
import { answerQuestions } from '../adapter.ts'
import type { SessionId } from '../dsh-compat.ts'

it('answers the native question carrier with its bound identity and rejects late settlement', async () => {
  const id = 'native-session' as SessionId
  let value: unknown
  class NativeQuestion {
    kind = 'question'
    key = 'question:1'
    sessionId = id
    questions = [{ id: 'q1', question: '只改表达？', options: [{ label: '是' }] }]
    #settled = false
    async answer(answer: unknown) {
      if (this.#settled) throw new Error('already settled')
      this.#settled = true
      value = answer
    }
  }
  const native = new NativeQuestion()
  const [view] = pendingForSession(new Map([[id, native]]), id)
  expect(view?.kind).toBe('question')
  if (view?.kind !== 'question') throw new Error('missing question')
  const answer = [{ id: 'q1', selected: [], custom: '仅调整表达' }]
  expect(await answerQuestions(view, answer)).toEqual({ accepted: true })
  expect(value).toEqual({ answers: answer })
  await expect(answerQuestions(view, answer)).rejects.toThrow('already settled')
  expect(pendingForSession([native], 'another' as SessionId)).toEqual([])
})

it('keeps plan-review details and refuses a response addressed to another session', async () => {
  const id = 's1' as SessionId
  let calls = 0
  const original = { kind: 'plan-review', key: 'q2', sessionId: id,
    questions: [{ id: 'q2', question: '确认计划', detail: '方案全文', options: [{ label: '确认' }] }],
    async answer() { calls++ },
  }
  const [view] = pendingForSession([original], id)
  if (view?.kind !== 'question') throw new Error('missing review')
  expect(view.payload.questions).toBe(original.questions)
  const result = await view.respond({ ok: true, value: { sessionId: 's2' as SessionId, answer: { answers: [] } } })
  expect(result.accepted).toBe(false)
  expect(calls).toBe(0)
})
