import { describe, expect, it } from 'vitest'
import { proofreadClientStyles } from './client-styles.ts'

const HOST_DARK = 'html:not([data-theme]) body[data-ds-dark-theme]'
const ROOT_INK = ':root[data-theme="ink"]'
const ROOTS = [
  '.dsh-proofread-dock',
  '.dsh-proofread-toggle',
  '.dsh-proofread-panel',
  '.dsh-ui.dsh-proofread-panel',
] as const

describe('proofread standalone theme selectors', () => {
  it('reads ordinary DSH dark and keeps the desktop ink contract', () => {
    for (const root of ROOTS) {
      expect(proofreadClientStyles).toContain(`${HOST_DARK} ${root}`)
      expect(proofreadClientStyles).toContain(`${ROOT_INK} ${root}`)
    }
    expect(proofreadClientStyles).not.toMatch(/@media\s*\(\s*prefers-color-scheme/)
  })
})
