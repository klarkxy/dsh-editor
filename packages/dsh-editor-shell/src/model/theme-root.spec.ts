import { describe, expect, it } from 'vitest'
import { tokenStyles } from '../design-system/tokens.ts'

describe('shell theme scope', () => {
  it('keeps the metric ladder the retired theme stylesheet supplied', () => {
    /* 旧主题样式表退役后，作用域内仍引用度量别名的规则从这些别名取值；
       像素值对齐旧梯级（scaling 100%）。颜色名别名已随 6a-3 一并删除。 */
    for (const decl of [
      '--space-5: var(--dsh-ui-space-6)',
      '--space-8: 48px',
      '--font-size-3: 16px',
      '--font-weight-medium: var(--dsh-ui-weight-medium)',
      '--line-height-4: 26px',
    ]) expect(tokenStyles).toContain(decl)
    for (const gone of ['--accent-9:', '--gray-12:', '--red-9:', '--color-surface:'])
      expect(tokenStyles).not.toContain(gone)
  })
})
