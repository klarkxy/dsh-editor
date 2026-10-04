import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ACCENT_STORAGE_KEY, readStoredAccent } from '../client/theme.tsx'
import { designSystemStyles } from './styles.ts'

describe('official web design contracts', () => {
  it('checks token parity, contrast, isolation and scope lifecycle', () => {
    const script = fileURLToPath(new URL('../../../../scripts/check-ui-design.mjs', import.meta.url))
    const output = execFileSync(process.execPath, ['--experimental-strip-types', script], { encoding: 'utf8' })
    expect(output).toContain('13 passed')
  })
  it('defaults to blue without overwriting existing accent preferences', () => {
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
    expect(readStoredAccent(storage)).toBe('blue')
    expect(values.size).toBe(0)
    for (const accent of ['indigo', 'blue', 'teal', 'green', 'amber', 'crimson', 'violet']) {
      values.set(ACCENT_STORAGE_KEY, accent)
      expect(readStoredAccent(storage)).toBe(accent)
      expect(values.get(ACCENT_STORAGE_KEY)).toBe(accent)
    }
  })
  it('keeps one manuscript-tree entry on one line', () => {
    expect(designSystemStyles).toMatch(/\.shell \.tree \.tree-name[^{]*\{[^}]*white-space: nowrap/)
    expect(designSystemStyles).toMatch(/\.shell \.tree \.tree-name[^{]*\{[^}]*text-overflow: ellipsis/)
    // The two-line clamp stretched the row and broke the tree's rhythm; the full name
    // stays available through the row's title attribute instead.
    expect(designSystemStyles).not.toMatch(/tree-name[^{]*\{[^}]*-webkit-line-clamp/)
    expect(designSystemStyles).not.toMatch(/\.shell \.tree \.tree-row[^{]*\{[^}]*align-items: flex-start/)
  })
  it('keeps the empty-tree message on the column inset', () => {
    // It rendered with zero inline padding, so the sentence started at the panel edge
    // while the title above it started 12px further in.
    expect(designSystemStyles).toMatch(/\.shell \.tree \.tree-empty[^{]*\{[^}]*padding-inline: var\(--dsh-ui-space-3\)/)
  })
})
