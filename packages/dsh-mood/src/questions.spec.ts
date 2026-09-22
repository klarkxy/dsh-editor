import { describe, expect, it } from 'vitest'
import { boundQuestions, parseAnalysis } from './analyze.ts'
import { ASK_DETAIL_OPTION, isAskAborted, applyAnswers, pendingClarifications, readinessAfterAnswers, toAskItems } from './questions.ts'

describe('analysis parse and native question identities', () => {
  it('parses JSON and caps questions at three', () => {
    const draft = parseAnalysis('```json\n{"goal":"改对白","questions":["a","b","c","d"],"deliverables":["x"]}\n```')
    expect(draft?.goal).toBe('改对白')
    expect(boundQuestions(draft?.questions ?? [], 'material')).toEqual(['a', 'b', 'c'])
  })

  it('uses the native AskUserQuestionItem shape including options', () => {
    const items = toAskItems(pendingClarifications(['范围？']))
    expect(items[0]).toMatchObject({
      id: 'q1',
      header: '澄清',
      question: '范围？',
    })
    expect(items[0]?.options).toEqual([
      { label: ASK_DETAIL_OPTION, description: '在自定义输入中写明范围、约束或验收标准' },
    ])
  })

  it('keeps mixed mild answers as disclosed assumptions', () => {
    const items = pendingClarifications(['范围？', '验收？'])
    const mixed = applyAnswers(items, { answers: [{ id: 'q1', selected: [], custom: '只改对白' }] })
    expect(mixed.map(item => item.status)).toEqual(['answered', 'skipped'])
    expect(readinessAfterAnswers(mixed, 'mild')).toBe('disclosed-assumptions')
    const all = applyAnswers(items, {
      answers: [
        { id: 'q1', selected: ['对白'], custom: undefined },
        { id: 'q2', selected: [], custom: '保持语气' },
      ],
    })
    expect(readinessAfterAnswers(all, 'mild')).toBe('user-confirmed')
  })

  it('does not treat skipped material or risk answers as disclosed assumptions', () => {
    const items = pendingClarifications(['范围？', '验收？'])
    const mixed = applyAnswers(items, { answers: [{ id: 'q1', selected: [], custom: '只改对白' }] })
    expect(readinessAfterAnswers(mixed, 'material')).toBe('pending')
    expect(readinessAfterAnswers(mixed, 'risk')).toBe('pending')
    expect(applyAnswers(items, { answers: [{ id: 'q1', selected: [ASK_DETAIL_OPTION], custom: '' }] })[0]?.status).toBe('skipped')
  })
})

it('recognizes explicit native question cancellation without treating it as a missing answerer', () => {
  expect(isAskAborted({ name: 'UserQuestionError', code: 'ASK_CANCELLED' })).toBe(true)
  expect(isAskAborted({ name: 'UserQuestionError', code: 'NO_PROVIDER' })).toBe(false)
})
