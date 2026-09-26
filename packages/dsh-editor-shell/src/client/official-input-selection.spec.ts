import { expect, it } from 'vitest'
import { bindTextareaInsertion } from './official-input-selection.ts'
it('uses the latest visible selection and native revision, restoring only its own binding', () => {
  const original = () => ({ draftRev: 7, start: 10, end: 10 })
  const actions = { captureInsertion: original }
  let selection = { start: 2, end: 5, length: 10 }
  const off = bindTextareaInsertion(actions, () => selection)
  expect(actions.captureInsertion()).toEqual({ draftRev: 7, start: 2, end: 5 })
  selection = { start: -1, end: 20, length: 3 }
  expect(actions.captureInsertion()).toEqual({ draftRev: 7, start: 0, end: 3 })
  off()
  expect(actions.captureInsertion).toBe(original)
  const offAgain = bindTextareaInsertion(actions, () => selection)
  const next = () => ({ draftRev: 8, start: 0, end: 0 })
  actions.captureInsertion = next
  offAgain()
  expect(actions.captureInsertion).toBe(next)
})
