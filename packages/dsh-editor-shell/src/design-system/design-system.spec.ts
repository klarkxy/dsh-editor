import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DSW_MAP, DSW_PENDING } from './compat.ts'
import { DSW_VARS } from './dsw-vars.ts'
import { collectStyles } from './layers.ts'
import '../app/files/files-rail.styles.ts'
import '../app/settings/settings.styles.ts'

/* Phase 6a-3: 规则全部进所属 sheet；collectStyles() 即完整注册结果。 */
const shellStyles = collectStyles()

describe('原稿 web design contracts', () => {
  it('checks token parity, contrast, isolation and scope lifecycle', () => {
    const script = fileURLToPath(new URL('../../../../scripts/check-ui-design.mjs', import.meta.url))
    const output = execFileSync(process.execPath, ['--experimental-strip-types', script], { encoding: 'utf8' })
    expect(output).toMatch(/UI design checks: [1-9]\d* passed/)
  }, 30000)
  it('maps every scanned DSW variable or names it pending (§6)', () => {
    const unaccounted = DSW_VARS.filter((name) => !(name in DSW_MAP) && !DSW_PENDING.includes(name))
    expect(unaccounted).toEqual([])
    expect(DSW_PENDING.length).toBeGreaterThan(0)
    if (DSW_PENDING.length) console.log(`DSW pending (unclassified): ${DSW_PENDING.length}\n${DSW_PENDING.join('\n')}`)
  })
  it('keeps one manuscript-tree entry on one line', () => {
    expect(shellStyles).toMatch(/\.dsh-files-rail \.tree \.tree-row[^{]*\{[^}]*white-space: nowrap/)
    expect(shellStyles).toMatch(/\.dsh-files-rail \.tree \.tree-name[^{]*\{[^}]*overflow: hidden/)
    expect(shellStyles).toMatch(/\.dsh-files-rail \.tree \.tree-name[^{]*\{[^}]*text-overflow: ellipsis/)
    // The two-line clamp stretched the row and broke the tree's rhythm; the full name
    // stays available through the row's title attribute instead.
    expect(shellStyles).not.toMatch(/tree-name[^{]*\{[^}]*-webkit-line-clamp/)
    expect(shellStyles).not.toMatch(/\.dsh-files-rail \.tree \.tree-row[^{]*\{[^}]*align-items: flex-start/)
  })
  it('keeps the empty-tree message on the column inset', () => {
    // It rendered with zero inline padding, so the sentence started at the panel edge
    // while the title above it started 12px further in.
    expect(shellStyles).toMatch(/\.dsh-files-rail \.tree \.tree-empty[^{]*\{[^}]*padding-inline: var\(--dsh-ui-space-3\)/)
  })
  it('keeps the installed-plugin anchor, its ghost controls and the narrow nav reachable', () => {
    // The install highlight lasts a token-derived beat the client reads back, so
    // the class can never outlive its own animation, and reduced motion ends it.
    expect(shellStyles).toMatch(/\.plugins-catalog-row\.is-new[^{]*\{[^}]*animation: plugins-catalog-installed calc\(var\(--dsh-ui-duration-slow\) \* 4\)/)
    expect(shellStyles).toMatch(/@keyframes plugins-catalog-installed\s*\{\s*from, 30% \{/)
    expect(shellStyles).toMatch(/@keyframes plugins-catalog-installed\s*\{[\s\S]*?var\(--dsh-ui-accent-soft\)[\s\S]*?var\(--dsh-ui-raised\)/)
    // 配置 and 详情 are one control: readable text, no resting fill, hover fill.
    expect(shellStyles).toMatch(/\.plugins-catalog-action[^{]*\{[^}]*background: transparent;[^}]*color: var\(--dsh-ui-text\)/)
    expect(shellStyles).toMatch(/\.plugins-catalog-action:hover[^{]*\{[^}]*background: var\(--dsh-ui-hover\)/)
    expect(shellStyles).not.toMatch(/\.plugins-catalog-config[^-]/)
    // The author brand art fills the monogram tile rather than a second slot.
    expect(shellStyles).toMatch(/\.plugins-catalog-icon-image[^{]*\{[^}]*object-fit: contain/)
    /* 插件配置条目收在分组导航列表里（.dsh-settings-config__links），<760px
       整列收进抽屉，不存在 nowrap 横向滚动条把条目推出屏外。 */
    expect(shellStyles).toMatch(/\.dsh-settings-config__links[^{]*\{[^}]*flex-direction: column/)
    expect(shellStyles).not.toMatch(/\.dsh-settings-config__links[^{]*\{[^}]*overflow-x: auto/)
    expect(shellStyles).toMatch(/\.dsh-settings-nav-drawer[^{]*\{[^}]*overflow-y: auto/)
  })
})
