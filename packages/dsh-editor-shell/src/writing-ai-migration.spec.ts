import { describe, expect, it } from 'vitest'
import { legacyWritingTargets } from './writing-ai-migration.ts'
describe('legacy writing route import', () => {
  it('retains explicit models, suppresses old off effort and uses session for empty settings', () => {
    expect(legacyWritingTargets({ completionModel: { provider: ' p ', model: ' m ', reasoningEffort: 'off' } })).toEqual({
      'manuscript.completion': { kind: 'model', provider: 'p', model: 'm' }, 'manuscript.rewrite': { kind: 'session' },
    })
  })
  it('does not silently repair an incomplete legacy model into session', () => {
    expect(legacyWritingTargets({ rewriteModel: { provider: 'p', model: '' } })['manuscript.rewrite']).toEqual({ kind: 'model', provider: 'p', model: '' })
  })
})
