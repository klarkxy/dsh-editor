import { describe, expect, it } from 'vitest'
import { workbenchMutationEndpoints } from './index.ts'

/** Exact mutation set from the previous hand-written `mutations` array in dispatchEditorFiles. */
const PREVIOUS_MUTATIONS = [
  'rules.open',
  'memory.apply',
  'memory.undo',
  'project.init',
  'project.prepareIndex',
  'project.importApply',
  'project.importCleanup',
  'snapshot.create',
  'snapshot.rollback',
  'snapshot.restoreApply',
  'snapshot.restoreCleanup',
  'structure.groupCreate',
  'directory.create',
  'file.rename',
  'file.moveManuscript',
  'archive.apply',
  'archive.restore',
  'proposal.apply',
  'entry.copy',
  'entry.move',
  'entry.delete',
  'entry.rename',
  'chapter.statusSet',
  'progress.record',
] as const

describe('workbench handler table', () => {
  it('derives the mutation set from the handler table', () => {
    expect(new Set(workbenchMutationEndpoints())).toEqual(new Set(PREVIOUS_MUTATIONS))
  })
})
