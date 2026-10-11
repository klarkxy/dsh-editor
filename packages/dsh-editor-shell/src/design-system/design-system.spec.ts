import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ACCENT_STORAGE_KEY, readStoredAccent } from '../client/theme.tsx'
import { designSystemStyles } from './styles.ts'

describe('official web design contracts', () => {
  it('checks token parity, contrast, isolation and scope lifecycle', () => {
    const script = fileURLToPath(new URL('../../../../scripts/check-ui-design.mjs', import.meta.url))
    const output = execFileSync(process.execPath, ['--experimental-strip-types', script], { encoding: 'utf8' })
    expect(output).toContain('PASS native status labels meet 4.5:1 on their tinted backgrounds')
    expect(output).toMatch(/UI design checks: [1-9]\d* passed/)
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
  it('keeps the installed-plugin anchor, its ghost controls and the narrow nav reachable', () => {
    // The install highlight lasts a token-derived beat the client reads back, so
    // the class can never outlive its own animation, and reduced motion ends it.
    expect(designSystemStyles).toMatch(/\.plugins-catalog-row\.is-new[^{]*\{[^}]*animation: plugins-catalog-installed calc\(var\(--dsh-ui-duration-slow\) \* 4\)/)
    expect(designSystemStyles).toMatch(/@keyframes plugins-catalog-installed\s*\{\s*from, 30% \{/)
    expect(designSystemStyles).toMatch(/@keyframes plugins-catalog-installed\s*\{[\s\S]*?var\(--dsh-ui-accent-soft\)[\s\S]*?var\(--dsh-ui-raised\)/)
    // 配置 and 详情 are one control: readable text, no resting fill, hover fill.
    expect(designSystemStyles).toMatch(/\.plugins-catalog-action[^{]*\{[^}]*background: transparent;[^}]*color: var\(--dsh-ui-text\)/)
    expect(designSystemStyles).toMatch(/\.plugins-catalog-action:hover[^{]*\{[^}]*background: var\(--dsh-ui-hover\)/)
    expect(designSystemStyles).not.toMatch(/\.plugins-catalog-config[^-]/)
    // The author brand art fills the monogram tile rather than a second slot.
    expect(designSystemStyles).toMatch(/\.plugins-catalog-icon-image[^{]*\{[^}]*object-fit: contain/)
    // At 390px the configuration entries stack as full-width rows. They used to
    // run off a nowrap inner scroller, which reported no nav overflow while
    // leaving 子智能体 and 知乎 unreachable.
    expect(designSystemStyles).toMatch(/@media \(max-width: 760px\)[\s\S]*\.plugins-config-links[^{]*\{[^}]*flex-wrap: wrap/)
    expect(designSystemStyles).not.toMatch(/\.plugins-config-links[^{]*\{[^}]*overflow-x: auto/)
    expect(designSystemStyles).toMatch(/\.plugins-config-links \.plugins-page-link[^{]*\{[^}]*flex: 1 1 100%/)
  })
})
