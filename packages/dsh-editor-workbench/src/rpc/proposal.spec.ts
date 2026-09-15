import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('V2 create dispatch flag', () => {
  it('forwards the explicit writingV2 marker instead of overwriting empty files', async () => {
    const source = await readFile(new URL('./proposal.ts', import.meta.url), 'utf8')
    expect(source).toContain('writingV2: WRITING_V2_CREATE')
    expect(source).toContain('WRITING_V2_CREATE')
    expect(source).toContain('targetVersion: proposal.targetVersion')
    expect(source).toContain('sourceVersion: proposal.sourceVersion')
    const planning = await readFile(new URL('../planning-proposals.ts', import.meta.url), 'utf8')
    expect(planning).toContain('isWritingV2Create(proposal)')
    expect(planning).not.toMatch(/isWritingV2Create\([^)]*message/)
  })
})
