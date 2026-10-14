import { describe, expect, it } from 'vitest'
import { tokenStyles } from '../design-system/tokens.ts'
import { SHELL_GRAY_COLOR } from '../client/ui/theme-root.tsx'

describe('shell theme scope', () => {
  it('anchors neutrals on the 原稿 gray ramp for the migration period', () => {
    expect(SHELL_GRAY_COLOR).toBe('gray')
  })

  it('keeps the metric ladder the retired theme stylesheet supplied', () => {
    /* 旧主题样式表退役后，作用域内仍引用度量别名的规则从这些别名取值；
       像素值对齐旧梯级（scaling 100%）。 */
    for (const decl of [
      '--space-5: var(--dsh-ui-space-6)',
      '--space-8: 48px',
      '--font-size-3: 16px',
      '--font-weight-medium: var(--dsh-ui-weight-medium)',
      '--line-height-4: 26px',
      '--accent-9: var(--dsh-ui-accent)',
      '--gray-12: #1E2420',
    ]) expect(tokenStyles).toContain(decl)
  })
})
