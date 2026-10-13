import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DSW_MAP, DSW_PENDING } from './compat.ts'
import { DSW_VARS } from './dsw-vars.ts'
import { designSystemStyles } from './styles.ts'
import { collectStyles } from './layers.ts'
import '../app/files/files-rail.styles.ts'

/* Phase 4.2: tree row/name/empty rules moved to app/files/files-rail.styles.ts. */
const filesRailStyles = collectStyles()

describe('原稿 web design contracts', () => {
  it('checks token parity, contrast, isolation and scope lifecycle', () => {
    const script = fileURLToPath(new URL('../../../../scripts/check-ui-design.mjs', import.meta.url))
    const output = execFileSync(process.execPath, ['--experimental-strip-types', script], { encoding: 'utf8' })
    expect(output).toMatch(/UI design checks: [1-9]\d* passed/)
  })
  it('maps every scanned DSW variable or names it pending (§6)', () => {
    const unaccounted = DSW_VARS.filter((name) => !(name in DSW_MAP) && !DSW_PENDING.includes(name))
    expect(unaccounted).toEqual([])
    expect(DSW_PENDING.length).toBeGreaterThan(0)
    if (DSW_PENDING.length) console.log(`DSW pending (unclassified): ${DSW_PENDING.length}\n${DSW_PENDING.join('\n')}`)
  })
  it('keeps one manuscript-tree entry on one line', () => {
    expect(filesRailStyles).toMatch(/\.dsh-files-rail \.tree \.tree-row[^{]*\{[^}]*white-space: nowrap/)
    expect(filesRailStyles).toMatch(/\.dsh-files-rail \.tree \.tree-name[^{]*\{[^}]*overflow: hidden/)
    expect(filesRailStyles).toMatch(/\.dsh-files-rail \.tree \.tree-name[^{]*\{[^}]*text-overflow: ellipsis/)
    // The two-line clamp stretched the row and broke the tree's rhythm; the full name
    // stays available through the row's title attribute instead.
    expect(filesRailStyles + designSystemStyles).not.toMatch(/tree-name[^{]*\{[^}]*-webkit-line-clamp/)
    expect(filesRailStyles).not.toMatch(/\.dsh-files-rail \.tree \.tree-row[^{]*\{[^}]*align-items: flex-start/)
  })
  it('keeps the empty-tree message on the column inset', () => {
    // It rendered with zero inline padding, so the sentence started at the panel edge
    // while the title above it started 12px further in.
    expect(filesRailStyles).toMatch(/\.dsh-files-rail \.tree \.tree-empty[^{]*\{[^}]*padding-inline: var\(--dsh-ui-space-3\)/)
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
