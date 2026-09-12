import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const editor = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'editor.tsx'), 'utf8')

describe('rewrite proposal chrome', () => {
  it('renders apply/dismiss as real actions and does not scroll the paper on each keystroke', () => {
    expect(editor).toContain('className: \'proposal-actions\'')
    expect(editor).toContain('className: \'primary-action\'')
    expect(editor).toContain('className: \'proposal-dismiss\'')
    expect(editor).toContain('selection-diff')
    expect(editor).toContain('scrollIntoView')
    expect(editor).toContain('getPaperOffset')
    expect(editor).toContain('[proposal]')
  })
})
